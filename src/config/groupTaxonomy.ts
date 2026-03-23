/**
 * Group Taxonomy — Card Definitions for Grouped Explore Feed
 *
 * Each GroupDefinition describes a card that can appear in the feed.
 * Predicates are pure functions: (item, context) => boolean.
 *
 * To add a new card, append to GROUP_TAXONOMY with a unique `id`.
 */

import type { ScoredItem, WeatherCondition } from "../lib/scoring";
import { getDistanceInMiles } from "../utils/location";
import { RECOMMENDER_CONFIG } from "./recommenderConfig";

// ============================================================================
// Types
// ============================================================================

export type CardType = "postable_now" | "standard" | "overflow";

export type DiversityCategory =
  | "food_drink"
  | "nearby"
  | "time_based"
  | "outdoor"
  | "entertainment"
  | "audience"
  | "general";

export interface GroupingContext {
  now: Date;
  weather: WeatherCondition | null;
  userLocation: { lat: number; lng: number } | null;
  kindFilter: "all" | "event" | "activity";
}

export interface GroupDefinition {
  id: string;
  title: string;
  subtitle?: string | ((ctx: GroupingContext) => string);
  match: (item: ScoredItem, ctx: GroupingContext) => boolean;
  kindEligibility: ("all" | "event" | "activity")[];
  diversityCategory: DiversityCategory;
  basePriority: number; // lower = shown first on tie
  weatherCondition?: "raining" | "sunny" | "cold" | "hot";
  timeCondition?: { hourStart: number; hourEnd: number };
  dayCondition?: number[]; // 0=Sun, 6=Sat
  /** Tags that define this group's identity — used for IDF-based distinctiveness ranking */
  definingTags?: string[];
  /** Override minItemsPerGroup for this group (e.g., 2 for event-only groups) */
  minItems?: number;
  /** Preferred item kind — groups preferring events get event visibility boost */
  preferKind?: "event" | "activity";
}

// ============================================================================
// Predicate Helpers
// ============================================================================

export function hasTag(item: ScoredItem, ...tags: string[]): boolean {
  if (!item.tags) return false;
  const itemTags = item.tags.map((t) => t.toLowerCase());
  return tags.some((t) => itemTags.includes(t.toLowerCase()));
}

export function hasCategory(item: ScoredItem, ...categories: string[]): boolean {
  if (!item.category) return false;
  const cat = item.category.toLowerCase();
  return categories.some((c) => c.toLowerCase() === cat);
}

export function isKind(item: ScoredItem, kind: "event" | "activity"): boolean {
  return item.kind === kind;
}

export function isPriceBucket(
  item: ScoredItem,
  ...buckets: string[]
): boolean {
  return buckets.includes(item.price_bucket);
}

export function isWithinMiles(
  item: ScoredItem,
  ctx: GroupingContext,
  miles: number
): boolean {
  if (!ctx.userLocation || !item.lat || !item.lng) return false;
  const dist = getDistanceInMiles(
    ctx.userLocation.lat,
    ctx.userLocation.lng,
    item.lat,
    item.lng
  );
  return dist <= miles;
}

export function startsWithinHours(
  item: ScoredItem,
  ctx: GroupingContext,
  hours: number
): boolean {
  if (!item.starts_at) return false;
  const startsAt = new Date(item.starts_at);
  const diff = (startsAt.getTime() - ctx.now.getTime()) / (1000 * 60 * 60);
  return diff >= 0 && diff <= hours;
}

function isInProgress(item: ScoredItem, ctx: GroupingContext): boolean {
  if (!item.starts_at) return false;
  const startsAt = new Date(item.starts_at);
  const endsAt = item.ends_at
    ? new Date(item.ends_at)
    : new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
  return ctx.now >= startsAt && ctx.now <= endsAt;
}

export function isTonight(item: ScoredItem, ctx: GroupingContext): boolean {
  if (!item.starts_at) return false;
  const startsAt = new Date(item.starts_at);
  const todayEnd = new Date(ctx.now);
  todayEnd.setHours(23, 59, 59, 999);

  // Must be today
  if (startsAt > todayEnd) return false;

  // After 5pm or within 6h if already evening
  const hour = ctx.now.getHours();
  if (hour >= 17) {
    return startsAt.getTime() - ctx.now.getTime() <= 6 * 60 * 60 * 1000;
  }
  return startsAt.getHours() >= 17;
}

export function isThisWeekend(
  item: ScoredItem,
  ctx: GroupingContext
): boolean {
  if (!item.starts_at) return false;
  const startsAt = new Date(item.starts_at);
  const day = ctx.now.getDay();

  // Find next Saturday (or today if already weekend)
  const satDate = new Date(ctx.now);
  if (day === 0) {
    // Sunday — weekend is today
    satDate.setDate(satDate.getDate() - 1);
  } else if (day !== 6) {
    satDate.setDate(satDate.getDate() + (6 - day));
  }
  satDate.setHours(0, 0, 0, 0);

  const sunEnd = new Date(satDate);
  sunEnd.setDate(sunEnd.getDate() + 1);
  sunEnd.setHours(23, 59, 59, 999);

  return startsAt >= satDate && startsAt <= sunEnd;
}

export function isOpenNow(item: ScoredItem): boolean {
  return item.scoreBreakdown.openNow >= 0.9;
}

export function isWeatherAppropriate(
  item: ScoredItem,
  type: "indoor" | "outdoor"
): boolean {
  const { WEATHER } = RECOMMENDER_CONFIG;
  const itemTags = (item.tags || []).map((t) => t.toLowerCase());
  const category = (item.category || "").toLowerCase();

  if (type === "indoor") {
    return (
      itemTags.some((t) =>
        (WEATHER.INDOOR_TAGS as readonly string[]).includes(t)
      ) ||
      WEATHER.INDOOR_CATEGORIES.some((c) => c.toLowerCase() === category)
    );
  }
  return (
    itemTags.some((t) =>
      (WEATHER.OUTDOOR_TAGS as readonly string[]).includes(t)
    ) ||
    WEATHER.OUTDOOR_CATEGORIES.some((c) => c.toLowerCase() === category)
  );
}

// ============================================================================
// Diversity Caps
// ============================================================================

export const DIVERSITY_CAPS: Record<DiversityCategory, number> = {
  food_drink: 3,
  nearby: 2,
  time_based: 3,
  outdoor: 3,
  entertainment: 3,
  audience: 3,
  general: 6,
};

// ============================================================================
// 37 Group Definitions
// ============================================================================

export const GROUP_TAXONOMY: GroupDefinition[] = [
  // ── Time-based (basePriority 3-12) ──

  {
    id: "happening_now",
    title: "Happening Now",
    subtitle: "Events currently in progress",
    match: (item, ctx) => isKind(item, "event") && isInProgress(item, ctx),
    kindEligibility: ["all", "event"],
    diversityCategory: "time_based",
    basePriority: 3,
    preferKind: "event",
    minItems: 2,
  },
  {
    id: "starting_soon",
    title: "Starting Soon",
    subtitle: "Within the next 2 hours",
    match: (item, ctx) =>
      isKind(item, "event") &&
      startsWithinHours(item, ctx, 2) &&
      !isInProgress(item, ctx),
    kindEligibility: ["all", "event"],
    diversityCategory: "time_based",
    basePriority: 4,
    preferKind: "event",
    minItems: 2,
  },
  {
    id: "friends_going",
    title: "Friends Are Going",
    subtitle: "Your friends RSVP'd to these",
    match: (item) => item.scoreBreakdown.friendsGoing > 0,
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "time_based",
    basePriority: 5,
  },
  {
    id: "tonight",
    title: "Tonight",
    subtitle: "Events this evening",
    match: (item, ctx) => isTonight(item, ctx),
    kindEligibility: ["all", "event"],
    diversityCategory: "time_based",
    basePriority: 8,
    timeCondition: { hourStart: 14, hourEnd: 24 },
    preferKind: "event",
    minItems: 2,
  },
  {
    id: "this_weekend",
    title: "This Weekend",
    subtitle: (ctx) => {
      const day = ctx.now.getDay();
      if (day === 6) return "Today & tomorrow";
      if (day === 0) return "Happening today";
      return "Saturday & Sunday";
    },
    match: (item, ctx) => isThisWeekend(item, ctx),
    kindEligibility: ["all", "event"],
    diversityCategory: "time_based",
    basePriority: 12,
    dayCondition: [0, 3, 4, 5, 6], // Wed-Sun
    preferKind: "event",
    minItems: 2,
  },

  // ── Weather-conditional (basePriority 10-11) ──

  {
    id: "indoor_rainy_day",
    title: "Indoor Activities",
    subtitle: "Perfect for a rainy day",
    match: (item) => isWeatherAppropriate(item, "indoor"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "entertainment",
    basePriority: 10,
    weatherCondition: "raining",
  },
  {
    id: "outdoor_sunny",
    title: "Get Outside",
    subtitle: "Beautiful weather for it",
    match: (item) => isWeatherAppropriate(item, "outdoor"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "outdoor",
    basePriority: 10,
    weatherCondition: "sunny",
  },
  {
    id: "cozy_cold",
    title: "Cozy Spots",
    subtitle: "Warm up inside",
    match: (item) =>
      hasTag(item, "coffee", "food", "dining") ||
      hasCategory(item, "Food & Drink"),
    kindEligibility: ["all", "activity"],
    diversityCategory: "food_drink",
    basePriority: 11,
    weatherCondition: "cold",
  },

  // ── Proximity (basePriority 7-15) ──

  {
    id: "walkable",
    title: "Walking Distance",
    subtitle: "Within a mile",
    match: (item, ctx) => isWithinMiles(item, ctx, 1),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "nearby",
    basePriority: 7,
  },
  {
    id: "nearby_5mi",
    title: "Nearby",
    subtitle: "Within 5 miles",
    match: (item, ctx) =>
      isWithinMiles(item, ctx, 5) && !isWithinMiles(item, ctx, 1),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "nearby",
    basePriority: 15,
  },

  // ── Food & Drink (basePriority 20-24) ──

  {
    id: "coffee_nearby",
    title: "Coffee Spots",
    subtitle: "Cafes nearby",
    match: (item, ctx) =>
      (hasTag(item, "coffee") || hasTag(item, "food", "dining")) &&
      hasTag(item, "coffee") &&
      isWithinMiles(item, ctx, 10),
    kindEligibility: ["all", "activity"],
    diversityCategory: "food_drink",
    basePriority: 20,
    definingTags: ["coffee"],
  },
  {
    id: "dining",
    title: "Dining",
    subtitle: "Restaurants & food spots",
    match: (item) =>
      hasTag(item, "food", "dining") || hasCategory(item, "Food & Drink"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "food_drink",
    basePriority: 21,
  },
  {
    id: "bars_breweries",
    title: "Bars & Breweries",
    subtitle: "Drinks & nightlife",
    match: (item) =>
      hasTag(item, "bar", "brewery", "drinks") ||
      hasTag(item, "nightlife"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "food_drink",
    basePriority: 22,
  },
  {
    id: "free_eats",
    title: "Free Food & Drinks",
    subtitle: "Free food events",
    match: (item) =>
      (hasTag(item, "food", "dining", "drinks") ||
        hasCategory(item, "Food & Drink")) &&
      isPriceBucket(item, "free"),
    kindEligibility: ["all", "event"],
    diversityCategory: "food_drink",
    basePriority: 24,
  },

  // ── Entertainment (basePriority 18-25) ──

  {
    id: "live_music",
    title: "Live Music",
    subtitle: "Concerts & performances",
    match: (item) => hasTag(item, "live_music", "concert"),
    kindEligibility: ["all", "event"],
    diversityCategory: "entertainment",
    basePriority: 18,
    definingTags: ["live_music", "concert"],
    preferKind: "event",
    minItems: 2,
  },
  {
    id: "festivals_fairs",
    title: "Festivals & Fairs",
    subtitle: "Markets, festivals, and more",
    match: (item) => hasTag(item, "festival", "fair", "market"),
    kindEligibility: ["all", "event"],
    diversityCategory: "entertainment",
    basePriority: 19,
    definingTags: ["festival", "fair", "market"],
    preferKind: "event",
    minItems: 2,
  },
  {
    id: "arts_culture",
    title: "Arts & Culture",
    subtitle: "Museums, theaters & cultural spots",
    match: (item) =>
      hasTag(item, "museum", "theater", "cultural") ||
      hasCategory(item, "Arts & Culture"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "entertainment",
    basePriority: 23,
  },
  {
    id: "nightlife",
    title: "Nightlife",
    subtitle: "After dark",
    match: (item) =>
      hasTag(item, "nightlife") || hasCategory(item, "Nightlife"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "entertainment",
    basePriority: 25,
    timeCondition: { hourStart: 16, hourEnd: 24 },
  },

  // ── Outdoors (basePriority 26-38) ──

  {
    id: "hiking_trails",
    title: "Hiking & Trails",
    subtitle: "Get on the trail",
    match: (item) => hasTag(item, "hiking", "trail"),
    kindEligibility: ["all", "activity"],
    diversityCategory: "outdoor",
    basePriority: 26,
    definingTags: ["hiking", "trail"],
  },
  {
    id: "parks_nature",
    title: "Parks & Nature",
    subtitle: "Scenic outdoor spots",
    match: (item) =>
      (hasTag(item, "parks", "nature", "scenic") ||
        hasCategory(item, "Outdoor")) &&
      !hasTag(item, "hiking", "trail"),
    kindEligibility: ["all", "activity"],
    diversityCategory: "outdoor",
    basePriority: 28,
  },
  {
    id: "water_activities",
    title: "Water Activities",
    subtitle: "On the water",
    match: (item) => hasTag(item, "water_activity", "swimming"),
    kindEligibility: ["all", "activity"],
    diversityCategory: "outdoor",
    basePriority: 30,
    definingTags: ["water_activity", "swimming"],
  },
  {
    id: "winter_activities",
    title: "Winter Activities",
    subtitle: "Cold-weather fun",
    match: (item) =>
      hasTag(item, "skiing", "snowboarding", "ice_skating", "winter_activity"),
    kindEligibility: ["all", "activity"],
    diversityCategory: "outdoor",
    basePriority: 32,
    definingTags: ["skiing", "snowboarding", "ice_skating", "winter_activity"],
  },
  {
    id: "sports_rec",
    title: "Sports & Recreation",
    subtitle: "Stay active",
    match: (item) =>
      hasTag(item, "fitness", "social") ||
      hasCategory(item, "Sports & Recreation"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "outdoor",
    basePriority: 38,
  },

  // ── Audience (basePriority 30-33) ──

  {
    id: "family_friendly",
    title: "Family Friendly",
    subtitle: "Fun for the whole family",
    match: (item) => hasTag(item, "family_friendly", "kids"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "audience",
    basePriority: 30,
  },
  {
    id: "date_night",
    title: "Date Night",
    subtitle: "Perfect for two",
    match: (item) => hasTag(item, "date_night"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "audience",
    basePriority: 31,
    definingTags: ["date_night"],
  },
  {
    id: "solo_friendly",
    title: "Solo Friendly",
    subtitle: "Great on your own",
    match: (item) => hasTag(item, "solo_friendly"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "audience",
    basePriority: 32,
  },
  {
    id: "group_activities",
    title: "Group Activities",
    subtitle: "Bring your crew",
    match: (item) => hasTag(item, "group_activity", "social"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "audience",
    basePriority: 33,
  },

  // ── Price (basePriority 14-16) ──

  {
    id: "free_things",
    title: "Free Things to Do",
    subtitle: "No cost adventures",
    match: (item) => isPriceBucket(item, "free") || hasTag(item, "free"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "general",
    basePriority: 14,
  },
  {
    id: "budget_friendly",
    title: "Budget Friendly",
    subtitle: "Easy on the wallet",
    match: (item) =>
      isPriceBucket(item, "free", "$") || hasTag(item, "budget_friendly"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "general",
    basePriority: 16,
  },

  // ── Vibe / Mood (basePriority 34-35) ──

  {
    id: "relaxing",
    title: "Relaxing",
    subtitle: "Unwind & recharge",
    match: (item) => hasTag(item, "relaxing", "wellness"),
    kindEligibility: ["all", "activity"],
    diversityCategory: "general",
    basePriority: 34,
  },
  {
    id: "adventure",
    title: "Adventure",
    subtitle: "Get your adrenaline going",
    match: (item) => hasTag(item, "adventure", "fitness"),
    kindEligibility: ["all", "activity"],
    diversityCategory: "general",
    basePriority: 35,
  },

  // ── Special (basePriority 17-41) ──

  {
    id: "hidden_gems",
    title: "Hidden Gems",
    subtitle: "Off the beaten path",
    match: (item) => item.is_hidden_gem === true,
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "general",
    basePriority: 17,
  },
  {
    id: "local_favorites",
    title: "Local Favorites",
    subtitle: "Community picks",
    match: (item) => hasTag(item, "local_favorite"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "general",
    basePriority: 36,
  },
  {
    id: "pet_friendly",
    title: "Pet Friendly",
    subtitle: "Bring your furry friend",
    match: (item) => hasTag(item, "pet_friendly"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "general",
    basePriority: 37,
  },
  {
    id: "seasonal",
    title: "Seasonal",
    subtitle: (ctx) => {
      const month = ctx.now.getMonth();
      if (month >= 2 && month <= 4) return "Spring specials";
      if (month >= 5 && month <= 7) return "Summer fun";
      if (month >= 8 && month <= 10) return "Fall favorites";
      return "Winter wonders";
    },
    match: (item) => hasTag(item, "seasonal"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "general",
    basePriority: 38,
  },
  {
    id: "shopping",
    title: "Shopping",
    subtitle: "Browse & buy",
    match: (item) => hasTag(item, "shopping", "market"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "general",
    basePriority: 39,
  },
  {
    id: "volunteer",
    title: "Volunteer",
    subtitle: "Give back to your community",
    match: (item) => hasTag(item, "volunteer"),
    kindEligibility: ["all", "event", "activity"],
    diversityCategory: "general",
    basePriority: 41,
  },
];

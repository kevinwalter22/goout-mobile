/**
 * Deterministic Scoring Engine
 *
 * Computes recommendation scores using transparent, explainable signals.
 * No ML black boxes - all logic is visible and predictable.
 */

import { RECOMMENDER_CONFIG } from "../config/recommenderConfig";
import { getDistanceInMiles } from "../utils/location";
import type { ExploreItem, Availability } from "../types/database";

// ============================================================================
// Types
// ============================================================================

export interface ScoringContext {
  userLocation?: { lat: number; lng: number } | null;
  currentTime: Date;
  friendsGoingMap: Map<string, number>; // item_id -> friends count
  userTagAffinity: Map<string, number>; // tag -> affinity score
  /** Learned event-vs-activity preference from interaction history */
  userTypeAffinity?: { eventBias: number; activityBias: number; totalInteractions: number } | null;
  weather?: WeatherCondition | null;
  featureFlags: Map<string, boolean>;
  /** Community feedback net scores: item_id -> net_score */
  communityFeedbackMap?: Map<string, number>;
  /** IDs of explore items created by friends of the current user */
  friendCreatedItemIds?: Set<string>;
  /** Current explore toggle: "all" | "event" | "activity". Context intent + type affinity only apply to "all". */
  kindFilter?: string;
}

export interface WeatherCondition {
  isRaining: boolean;
  isSunny: boolean;
  temperature?: number;
}

export interface ScoreBreakdown {
  timeMatch: number;
  distance: number;
  openNow: number;
  friendsGoing: number;
  tagAffinity: number;
  weather: number;
  contextIntent: number;
  typeAffinity: number;
  quality: number;
  communityFeedback: number;
  freshness: number;
  friendCreated: number;
  total: number;
  /** Dev-only: which intent bucket matched */
  _intentBucket?: string;
}

export interface ScoredItem extends ExploreItem {
  recommendScore: number;
  scoreBreakdown: ScoreBreakdown;
}

// ============================================================================
// Main Scoring Functions
// ============================================================================

/**
 * Score a single explore item
 */
export function scoreItem(
  item: ExploreItem,
  context: ScoringContext
): ScoredItem {
  const { WEIGHTS, FLAGS } = RECOMMENDER_CONFIG;

  const intentResult = computeContextIntentScore(item, context);

  const breakdown: ScoreBreakdown = {
    timeMatch: computeTimeScore(item, context.currentTime),
    distance: computeDistanceScore(item, context.userLocation),
    openNow: computeOpenNowScore(item, context.currentTime),
    friendsGoing: context.featureFlags.get(FLAGS.FRIENDS_BOOST)
      ? computeFriendsScore(item, context.friendsGoingMap)
      : 0,
    tagAffinity: context.featureFlags.get(FLAGS.TAG_AFFINITY)
      ? computeTagAffinityScore(item, context.userTagAffinity)
      : 0,
    weather:
      context.featureFlags.get(FLAGS.WEATHER_BOOST) && context.weather
        ? computeWeatherScore(item, context.weather)
        : 0,
    contextIntent: intentResult.score,
    typeAffinity: context.featureFlags.get(FLAGS.TYPE_AFFINITY_LEARNING)
      ? computeTypeAffinityScore(item, context)
      : 0,
    quality: computeQualityScore(item),
    communityFeedback: context.featureFlags.get(FLAGS.COMMUNITY_FEEDBACK)
      ? computeCommunityFeedbackScore(item, context)
      : 0,
    freshness: context.featureFlags.get(FLAGS.FRESHNESS)
      ? computeFreshnessScore(item)
      : 0,
    friendCreated: context.featureFlags.get(FLAGS.FRIEND_CREATED_BOOST)
      ? computeFriendCreatedScore(item, context)
      : 0,
    total: 0,
    _intentBucket: intentResult.bucketName,
  };

  // Weighted sum
  breakdown.total =
    breakdown.timeMatch * WEIGHTS.TIME_MATCH +
    breakdown.distance * WEIGHTS.DISTANCE +
    breakdown.openNow * WEIGHTS.OPEN_NOW +
    breakdown.friendsGoing * WEIGHTS.FRIENDS_GOING +
    breakdown.tagAffinity * WEIGHTS.TAG_AFFINITY +
    breakdown.weather * WEIGHTS.WEATHER +
    breakdown.contextIntent * WEIGHTS.CONTEXT_INTENT +
    breakdown.typeAffinity * WEIGHTS.TYPE_AFFINITY +
    breakdown.quality * WEIGHTS.QUALITY +
    breakdown.communityFeedback * WEIGHTS.COMMUNITY_FEEDBACK +
    breakdown.freshness * WEIGHTS.FRESHNESS +
    breakdown.friendCreated * WEIGHTS.FRIEND_CREATED;

  return {
    ...item,
    recommendScore: breakdown.total,
    scoreBreakdown: breakdown,
  };
}

/**
 * Score and sort items by recommendation score
 */
export function scoreAndRankItems(
  items: ExploreItem[],
  context: ScoringContext
): ScoredItem[] {
  const scored = items
    .map((item) => scoreItem(item, context))
    .sort((a, b) => b.recommendScore - a.recommendScore);

  // Dev-only debug logging for top 10 items
  if (__DEV__ && RECOMMENDER_CONFIG.CONTEXT_INTENT.DEBUG && scored.length > 0) {
    const now = context.currentTime;
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    console.log(
      `\n[Scorer] ${dayNames[now.getDay()]} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")} | kind=${context.kindFilter || "all"} | Top 10:`
    );
    scored.slice(0, 10).forEach((item, i) => {
      const b = item.scoreBreakdown;
      console.log(
        `  ${i + 1}. [${b.total.toFixed(3)}] "${item.title}" ` +
          `D=${b.distance.toFixed(2)} T=${b.timeMatch.toFixed(2)} W=${b.weather.toFixed(2)} ` +
          `CI=${b.contextIntent.toFixed(2)}${b._intentBucket ? ` (${b._intentBucket})` : ""} ` +
          `TyA=${b.typeAffinity.toFixed(2)} CF=${b.communityFeedback.toFixed(2)} ` +
          `FN=${b.freshness.toFixed(2)} ` +
          `ON=${b.openNow.toFixed(2)} FR=${b.friendsGoing.toFixed(2)} TA=${b.tagAffinity.toFixed(2)}`
      );
    });
  }

  return scored;
}

/**
 * Create a default scoring context with feature flags disabled
 */
export function createDefaultContext(
  overrides: Partial<ScoringContext> = {}
): ScoringContext {
  return {
    currentTime: new Date(),
    friendsGoingMap: new Map(),
    userTagAffinity: new Map(),
    userTypeAffinity: null,
    communityFeedbackMap: new Map(),
    kindFilter: "all",
    featureFlags: new Map([
      [RECOMMENDER_CONFIG.FLAGS.WEATHER_BOOST, true],
      [RECOMMENDER_CONFIG.FLAGS.FRIENDS_BOOST, true],
      [RECOMMENDER_CONFIG.FLAGS.TAG_AFFINITY, true],
      [RECOMMENDER_CONFIG.FLAGS.TYPE_AFFINITY_LEARNING, true],
      [RECOMMENDER_CONFIG.FLAGS.LLM_RERANKER, false],
      [RECOMMENDER_CONFIG.FLAGS.COMMUNITY_FEEDBACK, true],
      [RECOMMENDER_CONFIG.FLAGS.FRESHNESS, true],
    ]),
    ...overrides,
  };
}

// ============================================================================
// Individual Score Components
// ============================================================================

/**
 * Compute time match score (0-1)
 * Higher scores for items happening soon or available now
 */
function computeTimeScore(item: ExploreItem, now: Date): number {
  const hour = now.getHours();
  const day = now.getDay();

  // Activities without starts_at: check availability_json
  if (!item.starts_at && item.availability_json) {
    const avail = item.availability_json as Availability;

    // Check day match
    if (avail.available_days && avail.available_days.length > 0) {
      const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const today = dayMap[day];
      const hasDayMatch =
        avail.available_days.includes("daily") ||
        avail.available_days.includes(today as any);
      if (!hasDayMatch) {
        return 0.2; // Not available today, low score
      }
    }

    // Check time of day match
    if (avail.best_time_of_day) {
      const { TIME_WINDOWS } = RECOMMENDER_CONFIG;
      const timeOfDay = avail.best_time_of_day.toLowerCase();

      if (timeOfDay === "morning" && (hour < 6 || hour >= 12)) {
        return 0.4; // Not optimal time
      }
      if (timeOfDay === "afternoon" && (hour < 12 || hour >= 17)) {
        return 0.4;
      }
      if (timeOfDay === "evening" && (hour < 17 || hour >= 21)) {
        return 0.4;
      }
    }

    return 1.0; // Available now
  }

  // Events with starts_at: check if starting within reasonable window
  if (item.starts_at) {
    const startsAt = new Date(item.starts_at);
    const hoursUntilStart =
      (startsAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Event already started but within grace period
    if (hoursUntilStart < 0 && hoursUntilStart > -3) {
      return 1.0; // In progress
    }
    // Starting very soon
    if (hoursUntilStart >= 0 && hoursUntilStart <= 2) {
      return 0.95; // Starting soon - highest score
    }
    // Later today
    if (hoursUntilStart > 2 && hoursUntilStart <= 6) {
      return 0.8;
    }
    // Today but later
    if (hoursUntilStart > 6 && hoursUntilStart <= 12) {
      return 0.6;
    }
    // Tomorrow
    if (hoursUntilStart > 12 && hoursUntilStart <= 24) {
      return 0.5;
    }
    // This week
    if (hoursUntilStart > 24 && hoursUntilStart <= 168) {
      return 0.35;
    }
    // Further out
    return 0.2;
  }

  // No timing info - neutral score
  return 0.5;
}

/**
 * Compute distance score (0-1)
 * Higher scores for closer items.
 * Uses exponential decay so items get penalized more steeply as distance increases.
 */
function computeDistanceScore(
  item: ExploreItem,
  userLocation?: { lat: number; lng: number } | null
): number {
  if (!userLocation || !item.lat || !item.lng) {
    return 0.3; // Low score if no location data (don't reward unknowns)
  }

  const distance = getDistanceInMiles(
    userLocation.lat,
    userLocation.lng,
    item.lat,
    item.lng
  );

  const { DISTANCE } = RECOMMENDER_CONFIG;

  if (distance <= DISTANCE.OPTIMAL_MILES) {
    return 1.0;
  }
  if (distance >= DISTANCE.MAX_MILES) {
    return 0;
  }

  // Exponential decay - items at 15mi score ~0.25, at 10mi score ~0.5
  // This penalizes far items much more aggressively than linear decay
  const normalized =
    (distance - DISTANCE.OPTIMAL_MILES) /
    (DISTANCE.MAX_MILES - DISTANCE.OPTIMAL_MILES);
  return Math.max(0, 1 - Math.pow(normalized, 0.6));
}

/**
 * Compute open now score (0-1)
 * 1.0 if currently happening/available, 0 otherwise
 */
function computeOpenNowScore(item: ExploreItem, now: Date): number {
  // Activity - check availability
  if (!item.starts_at) {
    if (item.availability_json) {
      const avail = item.availability_json as Availability;

      if (avail.available_times === "anytime") {
        return 1.0;
      }

      if (avail.available_times === "daylight") {
        const hour = now.getHours();
        return hour >= 6 && hour < 20 ? 1.0 : 0;
      }

      // Check structured times
      if (
        typeof avail.available_times === "object" &&
        avail.available_times?.start &&
        avail.available_times?.end
      ) {
        const hour = now.getHours();
        const startHour = parseInt(avail.available_times.start.split(":")[0]);
        const endHour = parseInt(avail.available_times.end.split(":")[0]);
        return hour >= startHour && hour < endHour ? 1.0 : 0;
      }
    }

    // Assume generally available for activities
    return 0.7;
  }

  // Event - check if happening now
  const startsAt = new Date(item.starts_at);
  const endsAt = item.ends_at
    ? new Date(item.ends_at)
    : new Date(startsAt.getTime() + 3 * 60 * 60 * 1000); // Default 3 hours

  if (now >= startsAt && now <= endsAt) {
    return 1.0; // In progress
  }

  return 0;
}

/**
 * Compute friends going score (0-1)
 * Higher scores when more friends are going
 */
function computeFriendsScore(
  item: ExploreItem,
  friendsGoingMap: Map<string, number>
): number {
  const count = friendsGoingMap.get(item.id) || 0;

  if (count === 0) return 0;

  const { FRIENDS } = RECOMMENDER_CONFIG;

  if (count === 1) return FRIENDS.ONE_FRIEND;
  if (count === 2) return FRIENDS.TWO_FRIENDS;
  return FRIENDS.THREE_PLUS;
}

/**
 * Compute tag affinity score (0-1)
 * Higher scores for items matching user's historical preferences
 */
function computeTagAffinityScore(
  item: ExploreItem,
  userTagAffinity: Map<string, number>
): number {
  if (!item.tags || item.tags.length === 0) return 0;
  if (userTagAffinity.size === 0) return 0;

  let totalAffinity = 0;
  let matchCount = 0;

  for (const tag of item.tags) {
    const affinity = userTagAffinity.get(tag.toLowerCase());
    if (affinity && affinity > 0) {
      totalAffinity += affinity;
      matchCount++;
    }
  }

  if (matchCount === 0) return 0;

  // Normalize to 0-1 range based on user's max affinity
  const affinityValues = Array.from(userTagAffinity.values());
  const maxAffinity = Math.max(...affinityValues);

  if (maxAffinity === 0) return 0;

  const avgAffinity = totalAffinity / matchCount;
  return Math.min(avgAffinity / maxAffinity, 1.0);
}

/**
 * Compute weather score (0-1)
 * Accounts for temperature, precipitation, and season.
 * Cold/freezing temps penalize outdoor; rain penalizes outdoor;
 * comfortable sunny weather boosts outdoor.
 */
function computeWeatherScore(
  item: ExploreItem,
  weather: WeatherCondition
): number {
  const { WEATHER } = RECOMMENDER_CONFIG;

  // Determine if item is indoor/outdoor from tags AND category
  const itemTags = (item.tags || []).map((t) => t.toLowerCase());
  const category = (item.category || "").toLowerCase();

  const isIndoorByTag = itemTags.some((t) => (WEATHER.INDOOR_TAGS as readonly string[]).includes(t));
  const isOutdoorByTag = itemTags.some((t) => (WEATHER.OUTDOOR_TAGS as readonly string[]).includes(t));
  const isOutdoorByCategory = WEATHER.OUTDOOR_CATEGORIES.some(
    (c) => c.toLowerCase() === category
  );
  const isIndoorByCategory = WEATHER.INDOOR_CATEGORIES.some(
    (c) => c.toLowerCase() === category
  );

  const isIndoor = isIndoorByTag || isIndoorByCategory;
  const isOutdoor = isOutdoorByTag || isOutdoorByCategory;

  // If item has no indoor/outdoor signal, neutral score
  if (!isIndoor && !isOutdoor) return 0.5;

  const temp = weather.temperature; // Fahrenheit

  // Temperature-based scoring (most important factor)
  if (temp !== undefined) {
    // Freezing or below: heavily penalize outdoor, boost indoor
    if (temp < WEATHER.FREEZING_F) {
      if (isOutdoor) return 0.05; // Nearly zero - nobody hikes in freezing weather
      if (isIndoor) return 1.0;
      return 0.5;
    }

    // Cold but above freezing: penalize outdoor
    if (temp < WEATHER.COLD_F) {
      if (isOutdoor) return 0.2;
      if (isIndoor) return 0.9;
      return 0.5;
    }

    // Very hot: penalize outdoor
    if (temp > WEATHER.HOT_F) {
      if (isOutdoor) return 0.3;
      if (isIndoor) return 0.9;
      return 0.5;
    }

    // Comfortable range: check rain/sun
    if (temp >= WEATHER.COMFORTABLE_LOW_F && temp <= WEATHER.COMFORTABLE_HIGH_F) {
      if (weather.isRaining) {
        if (isIndoor) return 0.9;
        if (isOutdoor) return 0.2;
        return 0.5;
      }
      if (weather.isSunny) {
        if (isOutdoor) return 1.0;
        if (isIndoor) return 0.5;
        return 0.7;
      }
      // Comfortable, overcast
      if (isOutdoor) return 0.8;
      if (isIndoor) return 0.6;
      return 0.6;
    }

    // Cool but not cold (45-55°F): slight outdoor penalty
    if (temp < WEATHER.COMFORTABLE_LOW_F) {
      if (weather.isRaining) {
        if (isIndoor) return 0.9;
        if (isOutdoor) return 0.1;
        return 0.4;
      }
      if (isOutdoor) return 0.4;
      if (isIndoor) return 0.8;
      return 0.5;
    }
  }

  // Fallback: rain/sun check without temperature
  if (weather.isRaining) {
    if (isIndoor) return 1.0;
    if (isOutdoor) return 0.2;
    return 0.5;
  }

  if (weather.isSunny) {
    if (isOutdoor) return 0.8;
    if (isIndoor) return 0.6;
    return 0.7;
  }

  return 0.5;
}

// ============================================================================
// Context Intent Scoring
// ============================================================================

interface IntentResult {
  score: number;
  bucketName?: string;
}

/**
 * Compute context intent score (0-1)
 * Biases ranking based on time-of-day and day-of-week.
 * Only active when kindFilter is "all"; returns neutral for "event"/"activity".
 *
 * Example: Friday evening -> events boosted; Sunday morning -> activities boosted.
 */
function computeContextIntentScore(
  item: ExploreItem,
  context: ScoringContext
): IntentResult {
  const { CONTEXT_INTENT } = RECOMMENDER_CONFIG;

  // Only apply intent bias on the "All" toggle
  if (context.kindFilter && context.kindFilter !== "all") {
    return { score: CONTEXT_INTENT.NEUTRAL };
  }

  const now = context.currentTime;
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours();
  const isEvent = item.kind === "event";

  // Find the first matching bucket
  for (const bucket of CONTEXT_INTENT.BUCKETS) {
    const dayMatch = (bucket.daysOfWeek as readonly number[]).includes(dayOfWeek);
    const hourMatch = hour >= bucket.hourStart && hour < bucket.hourEnd;

    if (dayMatch && hourMatch) {
      // Base score from event/activity boost
      let score: number = isEvent ? bucket.eventBoost : bucket.activityBoost;

      // Apply small tag/category bonuses
      if (bucket.tagBoosts && item.tags) {
        const itemTags = item.tags.map((t) => t.toLowerCase());
        const categoryLower = (item.category || "").toLowerCase();

        for (const [tag, bonus] of Object.entries(bucket.tagBoosts)) {
          if (itemTags.includes(tag) || categoryLower.includes(tag)) {
            score = Math.min(1.0, score + (bonus as number));
          }
        }
      }

      return { score, bucketName: bucket.name };
    }
  }

  // No bucket matched - neutral
  return { score: CONTEXT_INTENT.NEUTRAL };
}

// ============================================================================
// Type Affinity Scoring (Learned Event vs Activity Preference)
// ============================================================================

/**
 * Compute type affinity score (0-1)
 * Returns how well the item's kind matches the user's learned preference.
 * Only active when kindFilter is "all"; returns neutral for "event"/"activity" toggles.
 *
 * Example: User who engages 80% with events → eventBias=0.8, activityBias=0.2
 *          → events get 0.8, activities get max(0.2, 0.3) = 0.3
 */
function computeTypeAffinityScore(
  item: ExploreItem,
  context: ScoringContext
): number {
  const { TYPE_AFFINITY } = RECOMMENDER_CONFIG;

  // Only apply in "All" toggle
  if (context.kindFilter && context.kindFilter !== "all") {
    return 0.5;
  }

  // No affinity data = neutral
  if (!context.userTypeAffinity) {
    return 0.5;
  }

  const { eventBias, activityBias, totalInteractions } = context.userTypeAffinity;

  // Not enough data yet = neutral
  if (totalInteractions < TYPE_AFFINITY.MIN_INTERACTIONS) {
    return 0.5;
  }

  // Both at ~0.5 = balanced engagement = neutral
  if (Math.abs(eventBias - 0.5) < 0.01 && Math.abs(activityBias - 0.5) < 0.01) {
    return 0.5;
  }

  // Return the bias that matches this item's kind, with a floor
  const isEvent = item.kind === "event";
  const rawScore = isEvent ? eventBias : activityBias;
  return Math.max(rawScore, TYPE_AFFINITY.SCORE_FLOOR);
}

// ============================================================================
// Quality Scoring (Item Confidence / Relevance)
// ============================================================================

/**
 * Compute quality score (0-1) based on normalized_confidence and audience_fit.
 *
 * Confidence tiers push high-quality items up and generic POIs down.
 * Audience fit acts as a multiplier: business/tourist items get heavily
 * penalized, youth_general gets a small boost, event venues get a boost.
 */
function computeQualityScore(item: ExploreItem): number {
  const confidence = (item as any).normalized_confidence as number | null | undefined;

  let baseScore: number;
  if (confidence == null) baseScore = 0.4;
  else if (confidence >= 80) baseScore = 1.0;
  else if (confidence >= 70) baseScore = 0.8;
  else if (confidence >= 60) baseScore = 0.6;
  else if (confidence >= 50) baseScore = 0.45;
  else baseScore = 0.25;

  // Audience fit multiplier
  const audienceFit = (item as any).audience_fit as string | null | undefined;
  let audienceMultiplier = 1.0;
  switch (audienceFit) {
    case "youth_general":
      audienceMultiplier = 1.1; // Small boost
      break;
    case "family":
      audienceMultiplier = 0.95; // Slight penalty (still relevant, just not primary audience)
      break;
    case "business":
      audienceMultiplier = 0.3; // Heavy penalty — business venues aren't for "going out"
      break;
    case "tourist":
      audienceMultiplier = 0.4; // Heavy penalty — tourist traps
      break;
    case "niche":
      audienceMultiplier = 0.7; // Moderate penalty
      break;
    // "unknown" or null → neutral (1.0)
  }

  // Event venue bonus: places that host events are more discovery-worthy
  const isEventVenue = (item as any).is_event_venue as boolean | null | undefined;
  if (isEventVenue) {
    audienceMultiplier *= 1.08;
  }

  return Math.min(baseScore * audienceMultiplier, 1.0);
}

// ============================================================================
// Freshness Scoring (Kind-Aware Recency)
// ============================================================================

/**
 * Compute freshness score (0-1) based on item age.
 * Kind-aware: activities get a recency curve; events stay neutral
 * (time signals already handle event urgency via starts_at).
 */
export function computeFreshnessScore(item: ExploreItem): number {
  const { FRESHNESS } = RECOMMENDER_CONFIG;

  // Events: neutral — timeMatch + openNow already handle urgency
  if (item.kind === "event") {
    return FRESHNESS.EVENT_SCORE;
  }

  // Activities: decay curve based on created_at
  if (!item.created_at) {
    return FRESHNESS.NULL_SCORE;
  }

  const createdAt = new Date(item.created_at);
  const now = new Date();
  const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  for (const tier of FRESHNESS.ACTIVITY_TIERS) {
    if (ageDays <= tier.maxDays) {
      return tier.score;
    }
  }

  return FRESHNESS.ACTIVITY_DEFAULT;
}

// ============================================================================
// Community Feedback Scoring
// ============================================================================

/**
 * Compute community feedback score (0-1)
 * Linear interpolation from MIN_NET_SCORE→0.0 through 0→0.5 to MAX_NET_SCORE→1.0.
 * Clamped to [SCORE_FLOOR, SCORE_CEILING].
 * No feedback → 0.5 (neutral).
 */
export function computeCommunityFeedbackScore(
  item: ExploreItem,
  context: ScoringContext
): number {
  const { COMMUNITY_FEEDBACK } = RECOMMENDER_CONFIG;
  const map = context.communityFeedbackMap;

  if (!map || !map.has(item.id)) {
    return 0.5; // Neutral when no feedback
  }

  const netScore = map.get(item.id)!;

  // Linear interpolation: MIN→0.0, 0→0.5, MAX→1.0
  let normalized: number;
  if (netScore >= 0) {
    normalized = 0.5 + (netScore / COMMUNITY_FEEDBACK.MAX_NET_SCORE) * 0.5;
  } else {
    normalized = 0.5 + (netScore / Math.abs(COMMUNITY_FEEDBACK.MIN_NET_SCORE)) * 0.5;
  }

  return Math.max(
    COMMUNITY_FEEDBACK.SCORE_FLOOR,
    Math.min(COMMUNITY_FEEDBACK.SCORE_CEILING, normalized)
  );
}

// ============================================================================
// Friend Created Score
// ============================================================================

/**
 * Returns 1.0 if this item was created by a friend of the current user, 0 otherwise.
 */
export function computeFriendCreatedScore(
  item: ExploreItem,
  context: ScoringContext
): number {
  return context.friendCreatedItemIds?.has(item.id) ? 1 : 0;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current time of day string
 */
export function getTimeOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/**
 * Get day of week string
 */
export function getDayOfWeek(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

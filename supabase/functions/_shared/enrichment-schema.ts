/**
 * Enrichment Response Schema
 *
 * Defines the expected structure of LLM enrichment responses
 * and provides validation functions.
 *
 * Key concept: Items are either "events" (specific dates) or "activities"
 * (availability patterns). The AI extracts structured availability data
 * from natural language schedule descriptions.
 */

// ============================================================================
// VALID VALUES
// ============================================================================

// Valid tag values for consistency
// IMPORTANT: Must stay in sync with src/config/tagTaxonomy.ts (canonical source)
// Run `npx ts-node scripts/check_tag_sync.ts` to verify parity.
export const VALID_TAGS = [
  // ── Activity Types ──
  "outdoors",
  "indoors",
  "water_activity",
  "winter_activity",
  "hiking",
  "camping",
  "swimming",
  "skiing",
  "snowboarding",

  // ── Audience ──
  "family_friendly",
  "kids",
  "adults_only",
  "date_night",
  "solo_friendly",
  "group_activity",

  // ── Vibe ──
  "nightlife",
  "relaxing",
  "adventure",
  "cultural",
  "educational",
  "social",
  "fitness",
  "wellness",

  // ── Food & Drink ──
  "food",
  "drinks",
  "coffee",
  "dining",
  "bar",
  "brewery",

  // ── Entertainment / Events ──
  "live_music",
  "concert",
  "theater",
  "museum",
  "festival",
  "market",
  "fair",

  // ── Nature & Outdoors ──
  "nature",
  "parks",
  "scenic",
  "trail",

  // ── Venues ──
  "ice_skating",

  // ── Other ──
  "free",
  "budget_friendly",
  "local_favorite",
  "seasonal",
  "pet_friendly",
  "accessible",
  "shopping",
  "volunteer",
] as const;

export type ValidTag = (typeof VALID_TAGS)[number];

// Item types
export const VALID_ITEM_TYPES = ["event", "activity"] as const;
export type ItemType = (typeof VALID_ITEM_TYPES)[number];

// Days of week
export const VALID_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "daily"] as const;
export type DayOfWeek = (typeof VALID_DAYS)[number];

// Seasons
export const VALID_SEASONS = ["spring", "summer", "fall", "winter", "year_round"] as const;
export type Season = (typeof VALID_SEASONS)[number];

// Time of day
export const VALID_TIMES_OF_DAY = ["morning", "afternoon", "evening", "anytime"] as const;
export type TimeOfDay = (typeof VALID_TIMES_OF_DAY)[number];

// Recurrence values
export const VALID_RECURRENCE = ["none", "daily", "weekly", "monthly", "annual", "unknown"] as const;
export type ValidRecurrence = (typeof VALID_RECURRENCE)[number];

// Price buckets
export const VALID_PRICE_BUCKETS = ["free", "$", "$$", "$$$", "unknown"] as const;
export type ValidPriceBucket = (typeof VALID_PRICE_BUCKETS)[number];

// ============================================================================
// AVAILABILITY SCHEMA
// ============================================================================

export interface AvailableTimes {
  start: string; // "09:00" 24hr format
  end: string; // "17:00"
}

export interface Availability {
  type: ItemType;

  // For activities - when is it available?
  available_days?: DayOfWeek[];
  available_times?: AvailableTimes | "anytime" | "daylight";
  available_seasons?: Season[];

  // For events - when does it happen?
  next_occurrence?: string | null; // ISO 8601
  recurrence?: ValidRecurrence;

  // Common fields
  typical_duration?: string; // "2-3 hours", "full day", "multi-day"
  best_time_of_day?: TimeOfDay;

  // Quality
  confidence: number; // 0-100
  source: "ai_enrichment" | "manual" | "api";
}

// ============================================================================
// ENRICHMENT RESPONSE
// ============================================================================

// Audience fit classification
export const VALID_AUDIENCE_FITS = [
  "youth_general",  // Broadly appealing to 18-35 (bars, restaurants, parks, concerts)
  "family",         // Family-oriented (kid-friendly museums, playgrounds)
  "business",       // Business/professional (conference centers, co-working)
  "tourist",        // Primarily tourist attractions (souvenir shops, tour buses)
  "niche",          // Very specific hobby/interest
  "unknown",        // Cannot determine
] as const;
export type ValidAudienceFit = (typeof VALID_AUDIENCE_FITS)[number];

export interface EnrichmentResponse {
  hook_line?: string | null;
  tags?: string[];
  availability?: Availability;
  price_bucket?: ValidPriceBucket;
  description?: string | null;
  short_schedule?: string | null;
  suggested_category?: string | null;

  // Classification fields (v2)
  audience_fit?: ValidAudienceFit;
  is_event_venue?: boolean;

  // Legacy fields (still supported for backwards compat)
  recurrence?: ValidRecurrence;
  next_occurrence?: {
    starts_at?: string | null;
    ends_at?: string | null;
  } | null;
}

export interface ValidationResult {
  valid: boolean;
  data?: EnrichmentResponse;
  errors?: string[];
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate and sanitize enrichment response from LLM
 */
export function validateEnrichmentResponse(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { valid: false, errors: ["Response must be an object"] };
  }

  const response = raw as Record<string, unknown>;
  const result: EnrichmentResponse = {};

  // Validate hook_line
  if ("hook_line" in response) {
    if (response.hook_line === null) {
      result.hook_line = null;
    } else if (typeof response.hook_line === "string") {
      const hookLine = response.hook_line.trim();
      if (hookLine.length > 0 && hookLine.length <= 150) {
        result.hook_line = hookLine;
      } else if (hookLine.length > 150) {
        result.hook_line = hookLine.substring(0, 147) + "...";
        errors.push("hook_line truncated to 150 chars");
      }
    }
  }

  // Validate tags
  if ("tags" in response && Array.isArray(response.tags)) {
    const validTags = response.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.toLowerCase().trim().replace(/\s+/g, "_"))
      .filter((tag) => VALID_TAGS.includes(tag as ValidTag));

    result.tags = [...new Set(validTags)];

    if (result.tags.length !== response.tags.length) {
      errors.push(`Some tags were invalid and filtered out`);
    }
  }

  // Validate price_bucket
  if ("price_bucket" in response) {
    if (typeof response.price_bucket === "string") {
      const bucket = response.price_bucket.trim().toLowerCase();
      // Map common variations
      const bucketMap: Record<string, ValidPriceBucket> = {
        "free": "free",
        "$": "$",
        "$$": "$$",
        "$$$": "$$$",
        "unknown": "unknown",
        "low": "$",
        "medium": "$$",
        "high": "$$$",
      };
      const mapped = bucketMap[bucket];
      if (mapped) {
        result.price_bucket = mapped;
      } else {
        result.price_bucket = "unknown";
        errors.push(`Invalid price_bucket "${response.price_bucket}", defaulting to unknown`);
      }
    }
  }

  // Validate description
  if ("description" in response) {
    if (response.description === null) {
      result.description = null;
    } else if (typeof response.description === "string") {
      const desc = response.description.trim();
      if (desc.length > 0 && desc.length <= 300) {
        result.description = desc;
      } else if (desc.length > 300) {
        result.description = desc.substring(0, 297) + "...";
        errors.push("description truncated to 300 chars");
      }
    }
  }

  // Validate short_schedule
  if ("short_schedule" in response) {
    if (response.short_schedule === null) {
      result.short_schedule = null;
    } else if (typeof response.short_schedule === "string") {
      const sched = response.short_schedule.trim();
      if (sched.length > 0 && sched.length <= 100) {
        result.short_schedule = sched;
      } else if (sched.length > 100) {
        result.short_schedule = sched.substring(0, 97) + "...";
        errors.push("short_schedule truncated to 100 chars");
      }
    }
  }

  // Validate suggested_category
  if ("suggested_category" in response && response.suggested_category !== null) {
    if (typeof response.suggested_category === "string") {
      const VALID_CATEGORIES = [
        "Outdoor", "Nightlife", "Winter Activities",
        "Arts & Culture", "Sports & Recreation", "Food & Drink", "Anchor",
      ];
      const suggested = response.suggested_category.trim();
      // Case-insensitive match
      const matched = VALID_CATEGORIES.find(
        (c) => c.toLowerCase() === suggested.toLowerCase()
      );
      if (matched) {
        result.suggested_category = matched;
      } else {
        errors.push(`Invalid suggested_category "${suggested}", ignoring`);
      }
    }
  }

  // Validate audience_fit
  if ("audience_fit" in response && typeof response.audience_fit === "string") {
    const fit = response.audience_fit.toLowerCase().trim();
    if (VALID_AUDIENCE_FITS.includes(fit as ValidAudienceFit)) {
      result.audience_fit = fit as ValidAudienceFit;
    } else {
      result.audience_fit = "unknown";
      errors.push(`Invalid audience_fit "${response.audience_fit}", defaulting to unknown`);
    }
  }

  // Validate is_event_venue
  if ("is_event_venue" in response) {
    if (typeof response.is_event_venue === "boolean") {
      result.is_event_venue = response.is_event_venue;
    }
  }

  // Validate availability (new schema)
  if ("availability" in response && response.availability !== null) {
    const avail = response.availability as Record<string, unknown>;
    const availability: Partial<Availability> = {
      source: "ai_enrichment",
      confidence: 70, // Default confidence
    };

    // Type
    if (avail.type && VALID_ITEM_TYPES.includes(avail.type as ItemType)) {
      availability.type = avail.type as ItemType;
    } else {
      availability.type = "activity"; // Default to activity
      errors.push("Missing or invalid type, defaulting to activity");
    }

    // Available days
    if (Array.isArray(avail.available_days)) {
      const validDays = avail.available_days
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.toLowerCase().trim())
        .filter((d) => VALID_DAYS.includes(d as DayOfWeek)) as DayOfWeek[];

      if (validDays.length > 0) {
        availability.available_days = validDays;
      }
    }

    // Available times
    if (avail.available_times) {
      if (avail.available_times === "anytime" || avail.available_times === "daylight") {
        availability.available_times = avail.available_times;
      } else if (typeof avail.available_times === "object") {
        const times = avail.available_times as Record<string, unknown>;
        if (
          typeof times.start === "string" &&
          typeof times.end === "string" &&
          /^\d{2}:\d{2}$/.test(times.start) &&
          /^\d{2}:\d{2}$/.test(times.end)
        ) {
          availability.available_times = {
            start: times.start,
            end: times.end,
          };
        }
      }
    }

    // Available seasons
    if (Array.isArray(avail.available_seasons)) {
      const validSeasons = avail.available_seasons
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.toLowerCase().trim().replace("-", "_").replace(" ", "_"))
        .filter((s) => VALID_SEASONS.includes(s as Season)) as Season[];

      if (validSeasons.length > 0) {
        availability.available_seasons = validSeasons;
      }
    }

    // Next occurrence (for events)
    if (avail.next_occurrence && typeof avail.next_occurrence === "string") {
      const date = new Date(avail.next_occurrence);
      if (!isNaN(date.getTime())) {
        availability.next_occurrence = date.toISOString();
      }
    }

    // Recurrence
    if (avail.recurrence && typeof avail.recurrence === "string") {
      const recurrence = avail.recurrence.toLowerCase().trim();
      if (VALID_RECURRENCE.includes(recurrence as ValidRecurrence)) {
        availability.recurrence = recurrence as ValidRecurrence;
      }
    }

    // Typical duration
    if (avail.typical_duration && typeof avail.typical_duration === "string") {
      availability.typical_duration = avail.typical_duration.trim();
    }

    // Best time of day
    if (avail.best_time_of_day && typeof avail.best_time_of_day === "string") {
      const timeOfDay = avail.best_time_of_day.toLowerCase().trim();
      if (VALID_TIMES_OF_DAY.includes(timeOfDay as TimeOfDay)) {
        availability.best_time_of_day = timeOfDay as TimeOfDay;
      }
    }

    // Confidence
    if (typeof avail.confidence === "number") {
      availability.confidence = Math.max(0, Math.min(100, avail.confidence));
    }

    result.availability = availability as Availability;
  }

  // Legacy: Validate recurrence (for backwards compat)
  if ("recurrence" in response && typeof response.recurrence === "string" && !result.availability) {
    const recurrence = response.recurrence.toLowerCase().trim();
    if (VALID_RECURRENCE.includes(recurrence as ValidRecurrence)) {
      result.recurrence = recurrence as ValidRecurrence;
    } else {
      result.recurrence = "unknown";
    }
  }

  // Legacy: Validate next_occurrence (for backwards compat)
  if ("next_occurrence" in response && response.next_occurrence !== null && !result.availability) {
    const nextOcc = response.next_occurrence as Record<string, unknown>;
    result.next_occurrence = {};

    if (nextOcc.starts_at && typeof nextOcc.starts_at === "string") {
      const date = new Date(nextOcc.starts_at);
      if (!isNaN(date.getTime())) {
        result.next_occurrence.starts_at = date.toISOString();
      }
    }

    if (nextOcc.ends_at && typeof nextOcc.ends_at === "string") {
      const date = new Date(nextOcc.ends_at);
      if (!isNaN(date.getTime())) {
        result.next_occurrence.ends_at = date.toISOString();
      }
    }

    if (!result.next_occurrence.starts_at && !result.next_occurrence.ends_at) {
      result.next_occurrence = null;
    }
  }

  return {
    valid: true,
    data: result,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ============================================================================
// ENRICHMENT SYSTEM PROMPT (shared by both single-item and queue worker)
// ============================================================================

export const ENRICHMENT_SYSTEM_PROMPT = `You are a classification and enrichment engine for Euda, a local discovery app that helps people find things to do. Your job is to produce RICH, ACCURATE metadata so items appear in the right themed cards in the app feed.

CRITICAL: You must assign 5-10 tags per item from the allowed list. Tags drive the entire card-based UI — items with too few tags become invisible to users. Think about EVERY dimension: what type of activity is it, who is it for, what's the vibe, is it indoors or outdoors, and what's the price?

Always respond with valid JSON only, no markdown or explanation.`;

// ============================================================================
// PROMPT BUILDER
// ============================================================================

/**
 * Build the enrichment prompt for an explore item.
 *
 * The prompt is structured to produce rich, multi-dimensional tags that feed
 * into the 37 themed card groups in the explore feed.
 */
export function buildEnrichmentPrompt(item: {
  title: string;
  description?: string | null;
  hook_line?: string | null;
  category?: string | null;
  schedule_text?: string | null;
  time_text?: string | null;
  recurrence?: string | null;
  season?: string | null;
  tags?: string[];
  location_name?: string | null;
  town?: string | null;
  price_bucket?: string | null;
  kind?: string | null;
}): string {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const dayOfWeek = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][today.getDay()];

  // Determine current season
  const month = today.getMonth();
  let currentSeason = "winter";
  if (month >= 2 && month <= 4) currentSeason = "spring";
  else if (month >= 5 && month <= 7) currentSeason = "summer";
  else if (month >= 8 && month <= 10) currentSeason = "fall";

  return `Enrich this item for the Euda local discovery app.

ITEM DATA:
- Title: ${item.title}
- Category: ${item.category || "unknown"}
- Kind: ${item.kind || "unknown"}
- Description: ${item.description || "none"}
- Location: ${item.location_name || "unknown"}${item.town ? `, ${item.town}` : ""}
- Current hook_line: ${item.hook_line || "none"}
- Schedule: ${item.schedule_text || "none"}
- Time: ${item.time_text || "none"}
- Recurrence: ${item.recurrence || "unknown"}
- Season: ${item.season || "year-round"}
- Current price_bucket: ${item.price_bucket || "unknown"}
- Current tags: ${item.tags?.length ? item.tags.join(", ") : "none"}

TODAY: ${todayStr} (${dayOfWeek}), current season: ${currentSeason}

═══════════════════════════════════════════════════════════════
TAG TAXONOMY — assign 5-10 tags from ONLY these values.
Think about EVERY applicable dimension for this item.
═══════════════════════════════════════════════════════════════

SETTING (pick at least 1):
  "outdoors" — any outdoor activity, park, trail, beach, garden, sports field
  "indoors" — any indoor venue: restaurant, museum, theater, gym, shop, bar

ACTIVITY TYPE (pick all that apply):
  "hiking" — trails, hikes, walks in nature
  "camping" — campgrounds, RV parks, glamping
  "swimming" — pools, beaches, water parks, swim spots
  "water_activity" — kayaking, fishing, boating, canoeing, paddle boarding
  "winter_activity" — any cold-weather activity
  "skiing" — downhill or cross-country skiing
  "snowboarding" — snowboarding specifically
  "ice_skating" — ice rinks, frozen ponds

FOOD & DRINK (pick all that apply):
  "coffee" — coffee shops, cafes, tea houses, bakeries with coffee
  "food" — any place that serves food
  "dining" — sit-down restaurants (not fast food)
  "drinks" — places focused on beverages (bars, pubs, wine bars, juice bars)
  "bar" — bars, pubs, taverns, wine bars
  "brewery" — breweries, taprooms, cideries, distilleries

ENTERTAINMENT (pick all that apply):
  "live_music" — live bands, open mic, DJ nights, karaoke
  "concert" — ticketed music performances, symphony, orchestra
  "theater" — plays, musicals, comedy shows, improv, spoken word
  "museum" — museums, galleries, exhibitions, historical sites
  "festival" — multi-day or large-scale community celebrations
  "fair" — county fairs, carnivals, craft fairs
  "market" — farmers markets, flea markets, holiday markets, pop-ups

NATURE (pick all that apply):
  "nature" — natural settings, forests, lakes, rivers, mountains
  "parks" — public parks, gardens, playgrounds, recreation areas
  "scenic" — viewpoints, overlooks, scenic drives, photo-worthy spots
  "trail" — marked trails (hiking, biking, nature walks)

AUDIENCE — who is this best for? (pick ALL that genuinely apply):
  "family_friendly" — safe and fun for parents + kids of any age
  "kids" — specifically designed for or appealing to children
  "adults_only" — 21+, bars, clubs, wine tastings, adult content
  "date_night" — romantic, intimate, good for couples (nice restaurants, wine bars, sunset spots, shows)
  "solo_friendly" — enjoyable alone (cafes, museums, trails, bookstores)
  "group_activity" — best with a group (team sports, group tours, escape rooms)

VIBE (pick all that apply):
  "nightlife" — evening/night entertainment (bars, clubs, late-night shows)
  "relaxing" — calm, peaceful, restorative (spas, gardens, quiet cafes, scenic drives)
  "adventure" — exciting, adrenaline (rock climbing, zip lines, skydiving, mountain biking)
  "cultural" — arts, heritage, traditions, ethnic food, historical
  "educational" — learning opportunities (workshops, classes, lectures, nature centers)
  "social" — good for meeting people (meetups, group classes, community events)
  "fitness" — physical exercise (gyms, running groups, yoga, sports leagues)
  "wellness" — health-focused (spas, meditation, yoga, health food)

PRICE & VALUE:
  "free" — no cost to participate/visit (public parks, free events, free museums)
  "budget_friendly" — under $15 per person, or cheap for its category

SPECIAL ATTRIBUTES:
  "local_favorite" — well-known locally, community institution, "everyone knows this place"
  "seasonal" — only available certain times of year, or has seasonal specials
  "pet_friendly" — dogs/pets welcome
  "accessible" — wheelchair accessible, ADA compliant
  "shopping" — retail, boutiques, gift shops, bookstores
  "volunteer" — community service, cleanups, charity events

═══════════════════════════════════════════════════════════════
TAGGING EXAMPLES (to calibrate your decisions):
═══════════════════════════════════════════════════════════════

"Starbucks" → coffee, food, indoors, solo_friendly, budget_friendly
"Central Park" → outdoors, parks, nature, free, family_friendly, solo_friendly, pet_friendly, scenic
"Joe's Bar & Grill" → food, dining, bar, drinks, indoors, social, adults_only
"Sunset Yoga in the Park" → outdoors, parks, fitness, wellness, relaxing, free, solo_friendly
"Live Jazz at Blue Note" → live_music, indoors, nightlife, date_night, adults_only, cultural
"Kids Science Museum" → museum, indoors, educational, family_friendly, kids, cultural
"Farmers Market Saturday" → market, outdoors, food, shopping, family_friendly, social, free
"Cascade Mountain Trail" → hiking, trail, outdoors, nature, adventure, scenic, free, solo_friendly, fitness
"Craft Beer Festival" → festival, brewery, drinks, outdoors, social, food, adults_only
"Community Cleanup Day" → volunteer, outdoors, social, free, group_activity, family_friendly
"Board Game Night at Local Brewery" → indoors, social, group_activity, adults_only, date_night, budget_friendly
"Tuesday Trivia Night" → indoors, social, group_activity, adults_only, budget_friendly
"Escape Room Experience" → indoors, group_activity, adventure, social, adults_only
"Open Mic Night" → theater, live_music, indoors, social, adults_only, cultural
"Comedy Show at the Tap Room" → theater, indoors, social, adults_only, nightlife, cultural

═══════════════════════════════════════════════════════════════
CATEGORY VALIDATION
═══════════════════════════════════════════════════════════════

Valid categories: Outdoor, Nightlife, Winter Activities, Arts & Culture, Sports & Recreation, Food & Drink, Anchor

If the current category is wrong or "unknown", suggest the correct one in "suggested_category".
Examples of miscategorization to fix:
- A restaurant listed as "Outdoor" → should be "Food & Drink"
- A museum listed as "Anchor" → should be "Arts & Culture"
- A ski resort listed as "Outdoor" → should be "Winter Activities"
- A bar listed as "Anchor" → should be "Nightlife"

CRITICAL RULE — Classify events by ACTIVITY TYPE, not venue type:
- "Board Game Night at a Bar" → "Arts & Culture" (activity is gaming, not the bar)
- "Trivia Night at a Brewery" → "Arts & Culture" (activity is trivia, not the brewery)
- "Comedy Show at a Restaurant" → "Arts & Culture" (activity is comedy performance)
- "Yoga Class at a Hotel" → "Sports & Recreation" (activity is yoga, not hotel services)
- "Paint & Sip at a Winery" → "Arts & Culture" (activity is painting, not wine tasting)
- Use "Food & Drink" ONLY when the event IS the food/drink experience: wine tastings, cooking classes, food festivals, chef dinners, restaurant openings.
- Use "Nightlife" for bars/clubs as destinations, NOT for events that happen to be hosted at a bar.

═══════════════════════════════════════════════════════════════
AUDIENCE & VENUE CLASSIFICATION
═══════════════════════════════════════════════════════════════

AUDIENCE FIT — who is this PRIMARILY for? Pick ONE:
  "youth_general" — broadly appealing to people 18-35 looking for things to do
    (bars, restaurants, concerts, parks, hiking, breweries, coffee shops, festivals)
  "family" — specifically family-oriented, designed for parents + kids
    (children's museums, playgrounds, family restaurants, kid-friendly events)
  "business" — business/professional venues NOT relevant for going out
    (conference centers, co-working spaces, business hotels, office buildings)
  "tourist" — primarily tourist traps, not places locals actually go
    (souvenir shops, tour buses, tourist-only attractions)
  "niche" — very specialized hobby that most people wouldn't seek out
    (RC car tracks, stamp collecting clubs, specialty trade suppliers)
  "unknown" — genuinely cannot determine

IMPORTANT: Default to "youth_general" for most places. A good restaurant, bar,
park, museum, trail, or event is "youth_general" even if families also go there.
Only use "family" if it's SPECIFICALLY kid-oriented. Only use "business"/"tourist"
if it's clearly NOT a place someone would go for fun.

IS_EVENT_VENUE — does this place regularly host events/performances?
  true: bars with live music nights, concert halls, theaters, comedy clubs,
        event spaces, nightclubs with DJ nights, community centers with regular events
  false: restaurants (unless they have regular live music), parks, trails,
         shops, most activities

═══════════════════════════════════════════════════════════════
OTHER FIELDS
═══════════════════════════════════════════════════════════════

HOOK LINE: If missing or under 10 chars, write a compelling 10-20 word hook.
  Good: "Award-winning craft brews in a cozy taproom with mountain views"
  Bad: "A nice place" or "Come visit us"

PRICE BUCKET:
  "free" — public parks, trails, playgrounds, free community events, volunteer
  "$" — coffee shops, fast casual, cheap bars, budget activities (<$30)
  "$$" — sit-down restaurants, shows, attractions with admission ($30-75)
  "$$$" — upscale dining, premium concerts, exclusive experiences ($75+)
  "unknown" — genuinely cannot determine from available info

DESCRIPTION: If missing, write 1-2 concise sentences about the place/event.

SHORT SCHEDULE: If schedule_text is verbose, condense to short form.
  "Mon-Fri 8AM-5PM" or "Daily 10AM-6PM, Sun closed" or "Weekends only"

AVAILABILITY RULES:
- Most items without a specific date are ACTIVITIES (hikes, restaurants, trails)
- "Daily" means available_days: ["daily"]
- "Year-round" means available_seasons: ["year_round"]
- "Dawn to dusk" = available_times: "daylight"

VALID VALUES:
- available_days: ${VALID_DAYS.join(", ")}
- available_seasons: ${VALID_SEASONS.join(", ")}
- best_time_of_day: ${VALID_TIMES_OF_DAY.join(", ")}
- recurrence (events): ${VALID_RECURRENCE.join(", ")}
- price_bucket: ${VALID_PRICE_BUCKETS.join(", ")}
- audience_fit: ${VALID_AUDIENCE_FITS.join(", ")}

RESPOND WITH VALID JSON ONLY:
{
  "hook_line": "string or null if current one is good",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "suggested_category": "Food & Drink" (or null if current category is correct),
  "price_bucket": "free" | "$" | "$$" | "$$$" | "unknown",
  "description": "1-2 sentence description, or null if already exists",
  "short_schedule": "condensed schedule string, or null if not needed",
  "audience_fit": "youth_general" | "family" | "business" | "tourist" | "niche" | "unknown",
  "is_event_venue": true or false,
  "availability": {
    "type": "event" or "activity",
    "available_days": ["daily"],
    "available_times": "anytime" or "daylight" or {"start": "09:00", "end": "17:00"},
    "available_seasons": ["year_round"],
    "typical_duration": "2-3 hours",
    "best_time_of_day": "morning" | "afternoon" | "evening" | "anytime",
    "recurrence": "none" | "weekly" | "annual" (events only),
    "next_occurrence": "ISO8601 datetime" (events only, null for activities),
    "confidence": 85
  }
}`;
}

// ============================================================================
// PROVENANCE BUILDER
// ============================================================================

/**
 * Build per-field provenance entries for LLM-enriched fields.
 * Merges with existing provenance, only overwriting when new confidence
 * exceeds existing. Returns the full provenance object to pass to
 * apply_enrichment's p_provenance parameter.
 */
export function buildEnrichmentProvenance(
  enrichment: EnrichmentResponse,
  existingProvenance: Record<string, unknown> | null
): Record<string, unknown> {
  const now = new Date().toISOString();
  const existing = existingProvenance || {};
  const existingFields = (existing.fields || {}) as Record<string, Record<string, unknown>>;
  const newFields: Record<string, Record<string, unknown>> = { ...existingFields };

  const setField = (
    field: string,
    confidence: number,
    method = "ai_inferred"
  ) => {
    const current = existingFields[field];
    // Only overwrite if new confidence exceeds existing
    if (current && typeof current.confidence === "number" && current.confidence >= confidence) {
      return;
    }
    newFields[field] = {
      confidence,
      source_type: "ai_enrichment",
      set_at: now,
      method,
    };
  };

  // hook_line — AI always generates this
  if (enrichment.hook_line) {
    setField("hook_line", 0.70);
  }

  // tags — higher confidence with more tags
  if (enrichment.tags && enrichment.tags.length > 0) {
    setField("tags", enrichment.tags.length >= 5 ? 0.75 : 0.60);
  }

  // price_bucket — moderate AI inference
  if (enrichment.price_bucket && enrichment.price_bucket !== "unknown") {
    setField("price_bucket", 0.60);
  }

  // availability_json — use the enrichment's own confidence if available
  if (enrichment.availability) {
    const conf = typeof enrichment.availability.confidence === "number"
      ? enrichment.availability.confidence / 100
      : 0.65;
    setField("availability_json", Math.min(conf, 0.85));
  }

  // description — moderate confidence
  if (enrichment.description) {
    setField("description", 0.65);
  }

  // suggested_category — fairly reliable AI corrections
  if (enrichment.suggested_category) {
    setField("category", 0.72);
  }

  // audience_fit — AI classification
  if (enrichment.audience_fit && enrichment.audience_fit !== "unknown") {
    setField("audience_fit", 0.75);
  }

  // is_event_venue — AI detection
  if (enrichment.is_event_venue !== undefined) {
    setField("is_event_venue", 0.70);
  }

  return {
    ...existing,
    schema_version: 2,
    fields: newFields,
    confirmations: (existing.confirmations as unknown[]) || [],
  };
}

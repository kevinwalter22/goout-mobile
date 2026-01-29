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

export interface EnrichmentResponse {
  hook_line?: string | null;
  tags?: string[];
  availability?: Availability;
  price_bucket?: ValidPriceBucket;

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
// PROMPT BUILDER
// ============================================================================

/**
 * Build the enrichment prompt for an explore item
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

  return `You are enriching event/activity data for a local discovery app.

ITEM DATA:
- Title: ${item.title}
- Category: ${item.category || "unknown"}
- Description: ${item.description || "none"}
- Current hook_line: ${item.hook_line || "none"}
- Schedule: ${item.schedule_text || "none"}
- Time: ${item.time_text || "none"}
- Recurrence info: ${item.recurrence || "unknown"}
- Season: ${item.season || "year-round"}
- Current tags: ${item.tags?.length ? item.tags.join(", ") : "none"}

TODAY: ${todayStr} (${dayOfWeek}), current season: ${currentSeason}

TASK:
1. Determine if this is an EVENT (specific date/time) or ACTIVITY (ongoing, repeatable)
2. Extract structured availability from the schedule/time/season info
3. If hook_line is missing or weak, generate a compelling 10-20 word hook
4. Suggest relevant tags (be generous - assign all that apply)
5. Infer price_bucket from the title, description, and category

PRICING RULES:
- Public parks, trails, scenic overlooks, playgrounds = "free"
- Free community events, volunteer activities = "free"
- Casual restaurants, coffee shops, bars, breweries = "$"
- Mid-range dining, shows, attractions with admission = "$$"
- Upscale dining, concerts, premium experiences = "$$$"
- If unsure, use "unknown"

IMPORTANT RULES:
- Most items without a specific date are ACTIVITIES (hikes, restaurants, trails)
- "Daily" or "Any day" means available_days: ["daily"]
- "Year-round" or no season restriction means available_seasons: ["year_round"]
- "Dawn to dusk" or outdoor activities = available_times: "daylight"
- Weekly events (e.g., "Wing Night Wednesday") = type: "activity", available_days: ["wed"]
- Parse durations like "2-3 hours" into typical_duration

VALID VALUES:
- available_days: ${VALID_DAYS.join(", ")}
- available_seasons: ${VALID_SEASONS.join(", ")}
- best_time_of_day: ${VALID_TIMES_OF_DAY.join(", ")}
- recurrence (for events): ${VALID_RECURRENCE.join(", ")}
- price_bucket: ${VALID_PRICE_BUCKETS.join(", ")}
- tags: ${VALID_TAGS.join(", ")}

RESPOND WITH VALID JSON ONLY:
{
  "hook_line": "string or null if current one is good",
  "tags": ["tag1", "tag2"],
  "price_bucket": "free" or "$" or "$$" or "$$$" or "unknown",
  "availability": {
    "type": "event" or "activity",
    "available_days": ["daily"] or ["mon", "wed", "fri"] etc,
    "available_times": "anytime" or "daylight" or {"start": "09:00", "end": "17:00"},
    "available_seasons": ["year_round"] or ["summer", "fall"] etc,
    "typical_duration": "2-3 hours" or "full day" or "multi-day",
    "best_time_of_day": "morning" or "afternoon" or "evening" or "anytime",
    "recurrence": "none" or "weekly" or "annual" (for events only),
    "next_occurrence": "ISO8601 datetime" (for events only, null for activities),
    "confidence": 85
  }
}`;
}

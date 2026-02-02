/**
 * Google Places Source Adapter
 *
 * Maps Google Places API (New) Nearby Search data to explore_items schema.
 * Places are treated as "activity" kind (evergreen, not time-bound events).
 *
 * Google Places API Reference:
 * https://developers.google.com/maps/documentation/places/web-service/nearby-search
 */

import type { NormalizedEvent } from "./ticketmaster.ts";

// ============================================================================
// Type → Category mapping
// ============================================================================

const TYPE_CATEGORY_MAP: Record<string, string> = {
  // Food & Drink
  restaurant: "food",
  cafe: "food",
  bar: "food",
  bakery: "food",
  meal_delivery: "food",
  meal_takeaway: "food",

  // Sports & Recreation
  gym: "fitness",
  spa: "wellness",
  yoga_studio: "fitness",
  swimming_pool: "recreation",

  // Outdoor
  park: "outdoor",
  campground: "outdoor",
  hiking_area: "outdoor",

  // Arts & Culture
  museum: "arts",
  library: "arts",
  art_gallery: "arts",
  performing_arts_theater: "entertainment",

  // Entertainment
  movie_theater: "entertainment",
  bowling_alley: "entertainment",
  amusement_park: "entertainment",

  // Nightlife
  night_club: "nightlife",

  // Shopping
  shopping_mall: "community",
  book_store: "community",

  // Attractions
  tourist_attraction: "community",
  university: "community",
};

// ============================================================================
// Type → Tags mapping
// ============================================================================

const TYPE_TAGS_MAP: Record<string, string[]> = {
  restaurant: ["food", "dining"],
  cafe: ["coffee", "food"],
  bar: ["bar", "drinks", "nightlife"],
  bakery: ["food"],
  meal_delivery: ["food"],
  meal_takeaway: ["food"],

  gym: ["fitness", "indoors"],
  spa: ["wellness", "relaxing"],
  yoga_studio: ["fitness", "wellness"],
  swimming_pool: ["swimming", "fitness"],

  park: ["parks", "outdoors", "nature", "family_friendly"],
  campground: ["camping", "outdoors", "nature"],
  hiking_area: ["hiking", "outdoors", "nature", "trail"],

  museum: ["museum", "cultural", "educational"],
  library: ["educational", "indoors"],
  art_gallery: ["museum", "cultural"],
  performing_arts_theater: ["theater", "cultural"],

  movie_theater: ["indoors"],
  bowling_alley: ["indoors", "group_activity", "family_friendly"],
  amusement_park: ["outdoors", "family_friendly", "adventure"],

  night_club: ["nightlife", "social", "adults_only"],

  shopping_mall: ["shopping", "indoors"],
  book_store: ["shopping", "indoors"],

  tourist_attraction: ["scenic", "local_favorite"],
  university: ["educational"],
};

// ============================================================================
// Price level mapping
// ============================================================================

const PRICE_LEVEL_MAP: Record<string, "free" | "$" | "$$" | "$$$" | "unknown"> = {
  PRICE_LEVEL_FREE: "free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$",
};

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Extract category from place types, using primaryType first
 */
function mapCategory(
  primaryType: string | undefined,
  types: string[] | undefined,
): { category: string | null; sub_category: string | null } {
  // Try primaryType first
  if (primaryType && TYPE_CATEGORY_MAP[primaryType]) {
    return {
      category: TYPE_CATEGORY_MAP[primaryType],
      sub_category: primaryType.replace(/_/g, " "),
    };
  }

  // Fall back to first matching type
  if (types) {
    for (const type of types) {
      if (TYPE_CATEGORY_MAP[type]) {
        return {
          category: TYPE_CATEGORY_MAP[type],
          sub_category: type.replace(/_/g, " "),
        };
      }
    }
  }

  return { category: null, sub_category: null };
}

/**
 * Collect tags from place types
 */
function collectTags(
  primaryType: string | undefined,
  types: string[] | undefined,
  priceLevel: string | undefined,
): string[] {
  const tags = new Set<string>();

  // Add tags from primaryType
  if (primaryType && TYPE_TAGS_MAP[primaryType]) {
    for (const tag of TYPE_TAGS_MAP[primaryType]) {
      tags.add(tag);
    }
  }

  // Add tags from all types
  if (types) {
    for (const type of types) {
      if (TYPE_TAGS_MAP[type]) {
        for (const tag of TYPE_TAGS_MAP[type]) {
          tags.add(tag);
        }
      }
    }
  }

  // Add price-based tags
  if (priceLevel === "PRICE_LEVEL_FREE") {
    tags.add("free");
  } else if (
    priceLevel === "PRICE_LEVEL_INEXPENSIVE" ||
    priceLevel === "PRICE_LEVEL_MODERATE"
  ) {
    tags.add("budget_friendly");
  }

  return Array.from(tags);
}

/**
 * Extract town from formatted address
 * Google format: "123 Main St, Potsdam, NY 13676, USA"
 */
function extractTown(formattedAddress: string | undefined): string | null {
  if (!formattedAddress) return null;

  const parts = formattedAddress.split(",").map((p) => p.trim());

  // US addresses: street, city, state zip, country
  // At minimum: city, state zip, country
  if (parts.length >= 3) {
    // Second-to-last before country is "STATE ZIP"
    // Third-to-last (or second for short addresses) is city
    const cityIndex = parts.length >= 4 ? 1 : 0;
    const city = parts[cityIndex];

    // Extract state from the state+zip part
    const stateZipPart = parts.length >= 4 ? parts[2] : parts[1];
    const stateMatch = stateZipPart?.match(/^([A-Z]{2})\s/);
    const state = stateMatch ? stateMatch[1] : null;

    if (city && state) {
      return `${city}, ${state}`;
    }
    if (city) {
      return city;
    }
  }

  return null;
}

/**
 * Build schedule text from opening hours
 */
function buildScheduleText(
  openingHours: any | undefined,
): string | null {
  if (!openingHours?.weekdayDescriptions) return null;

  // weekdayDescriptions is like ["Monday: 9:00 AM – 5:00 PM", ...]
  return openingHours.weekdayDescriptions.join("; ");
}

/**
 * Determine recurrence from opening hours
 */
function inferRecurrence(openingHours: any | undefined): string | null {
  if (!openingHours?.periods) return null;

  const periods = openingHours.periods;
  if (periods.length === 0) return null;

  // If open 7 days a week
  const daysOpen = new Set(periods.map((p: any) => p.open?.day));
  if (daysOpen.size >= 7) return "daily";
  if (daysOpen.size >= 5) return "weekdays";

  return "weekly";
}

/**
 * Calculate XP value based on place type and rating
 */
function calculateXp(
  primaryType: string | undefined,
  rating: number | undefined,
  userRatingCount: number | undefined,
): number {
  let xp = 30; // Base XP for visiting any place

  // Active places get more XP
  const activePlaces = ["gym", "park", "campground", "hiking_area", "spa",
    "bowling_alley", "swimming_pool", "yoga_studio"];
  if (primaryType && activePlaces.includes(primaryType)) {
    xp += 15;
  }

  // Cultural places get a boost
  const culturalPlaces = ["museum", "library", "art_gallery", "tourist_attraction"];
  if (primaryType && culturalPlaces.includes(primaryType)) {
    xp += 10;
  }

  // Rating bonus
  if (rating && rating >= 4.5) {
    xp += 10;
  } else if (rating && rating >= 4.0) {
    xp += 5;
  }

  // Well-reviewed places (hidden gem potential)
  if (userRatingCount && userRatingCount < 50 && rating && rating >= 4.0) {
    xp += 5; // Less known but well-liked
  }

  return Math.min(xp, 75); // Cap lower than events (events max 100)
}

/**
 * Determine priority for display ordering
 */
function calculatePriority(
  primaryType: string | undefined,
  rating: number | undefined,
  userRatingCount: number | undefined,
): number {
  let priority = 40; // Base priority for activities (lower than events at 50)

  // Tourist attractions get a boost
  if (primaryType === "tourist_attraction") {
    priority += 20;
  }

  // Well-rated places
  if (rating && rating >= 4.5 && userRatingCount && userRatingCount >= 20) {
    priority += 15;
  } else if (rating && rating >= 4.0) {
    priority += 5;
  }

  // Outdoor/active places slightly boosted
  const outdoorTypes = ["park", "campground", "hiking_area"];
  if (primaryType && outdoorTypes.includes(primaryType)) {
    priority += 10;
  }

  return Math.min(priority, 80);
}

/**
 * Detect hidden gems: well-rated but few reviews
 */
function isHiddenGem(
  rating: number | undefined,
  userRatingCount: number | undefined,
): boolean {
  return (
    rating !== undefined &&
    rating >= 4.3 &&
    userRatingCount !== undefined &&
    userRatingCount > 5 &&
    userRatingCount < 30
  );
}

/**
 * Infer effort level from place type
 */
function inferEffort(
  primaryType: string | undefined,
): "low" | "medium" | "high" | "unknown" {
  const highEffort = ["gym", "hiking_area", "campground"];
  const mediumEffort = ["park", "bowling_alley", "spa", "yoga_studio",
    "swimming_pool", "amusement_park"];

  if (primaryType && highEffort.includes(primaryType)) return "high";
  if (primaryType && mediumEffort.includes(primaryType)) return "medium";
  return "low";
}

// ============================================================================
// Main normalization function
// ============================================================================

/**
 * Converts Google Places API (New) raw JSON to explore_items format.
 * Places are treated as kind="activity" (evergreen, not time-bound).
 */
export function normalizeGooglePlacesEvent(raw: any): NormalizedEvent {
  const primaryType = raw.primaryType;
  const types = raw.types as string[] | undefined;
  const { category, sub_category } = mapCategory(primaryType, types);

  const title = raw.displayName?.text || raw.primaryTypeDisplayName?.text || "Unknown Place";
  const description = raw.editorialSummary?.text || null;

  const tags = collectTags(primaryType, types, raw.priceLevel);
  const priceBucket = raw.priceLevel
    ? (PRICE_LEVEL_MAP[raw.priceLevel] || "unknown")
    : "unknown";

  const town = extractTown(raw.formattedAddress);
  const scheduleText = buildScheduleText(raw.regularOpeningHours);
  const recurrence = inferRecurrence(raw.regularOpeningHours);

  const rating = raw.rating as number | undefined;
  const userRatingCount = raw.userRatingCount as number | undefined;

  return {
    kind: "activity",
    title,
    description,
    hook_line: null, // LLM enrichment will generate this

    category,
    sub_category,

    location_name: title, // For places, the place name IS the location
    address: raw.formattedAddress || null,
    town,
    lat: raw.location?.latitude || null,
    lng: raw.location?.longitude || null,

    starts_at: null, // Activities don't have start times
    ends_at: null,
    schedule_text: scheduleText,
    time_text: null,
    recurrence,
    season: null,

    price_bucket: priceBucket,
    effort: inferEffort(primaryType),

    xp_value: calculateXp(primaryType, rating, userRatingCount),
    priority: calculatePriority(primaryType, rating, userRatingCount),
    is_anchor: primaryType === "tourist_attraction",
    is_hidden_gem: isHiddenGem(rating, userRatingCount),

    source_url: raw.googleMapsUri || raw.websiteUri || null,
    external_id: raw.id,

    tags,
  };
}

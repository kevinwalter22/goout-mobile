/**
 * Explore Item Normalization
 *
 * Normalizes inconsistent field values from various sources (curated data,
 * Ticketmaster API, etc.) into canonical values for reliable filtering.
 *
 * This runs:
 * 1. At ingestion time (before item is visible to queries)
 * 2. On-demand for existing items via repair job
 *
 * NORMALIZATION RULES:
 * - Category: Maps synonyms to canonical enum values
 * - Price: Parses various formats to canonical bucket (free, $, $$, $$$)
 * - Tags: Normalizes to controlled set, removes duplicates
 * - Town: Standardizes naming variants
 */

import type { ExploreItem } from "../types/database";
import { CANONICAL_TAGS, type CanonicalTag } from "../config/tagTaxonomy";

// Re-export so existing imports keep working
export { CANONICAL_TAGS, type CanonicalTag };

// ============================================================================
// CANONICAL VALUES
// ============================================================================

export const CANONICAL_CATEGORIES = [
  "Outdoor",
  "Nightlife",
  "Winter Activities",
  "Arts & Culture",
  "Sports & Recreation",
  "Food & Drink",
  "Anchor",
] as const;

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

export const CANONICAL_PRICE_BUCKETS = ["free", "$", "$$", "$$$", "unknown"] as const;
export type CanonicalPriceBucket = (typeof CANONICAL_PRICE_BUCKETS)[number];

// ============================================================================
// CATEGORY NORMALIZATION
// ============================================================================

const CATEGORY_SYNONYMS: Record<string, CanonicalCategory> = {
  // Outdoor
  "outdoor": "Outdoor",
  "outdoors": "Outdoor",
  "nature": "Outdoor",
  "hiking": "Outdoor",
  "parks": "Outdoor",
  "trails": "Outdoor",
  "camping": "Outdoor",
  "beach": "Outdoor",

  // Nightlife
  "nightlife": "Nightlife",
  "night life": "Nightlife",
  "bars": "Nightlife",
  "clubs": "Nightlife",
  "clubbing": "Nightlife",
  "late night": "Nightlife",

  // Winter Activities
  "winter activities": "Winter Activities",
  "winter": "Winter Activities",
  "skiing": "Winter Activities",
  "snowboarding": "Winter Activities",
  "ice skating": "Winter Activities",
  "snow sports": "Winter Activities",

  // Arts & Culture
  "arts & culture": "Arts & Culture",
  "arts and culture": "Arts & Culture",
  "arts": "Arts & Culture",
  "culture": "Arts & Culture",
  "museum": "Arts & Culture",
  "museums": "Arts & Culture",
  "gallery": "Arts & Culture",
  "galleries": "Arts & Culture",
  "theatre": "Arts & Culture",
  "theater": "Arts & Culture",
  "music": "Arts & Culture",
  "concert": "Arts & Culture",
  "concerts": "Arts & Culture",
  "live music": "Arts & Culture",
  "performance": "Arts & Culture",
  "art": "Arts & Culture",

  // Sports & Recreation
  "sports & recreation": "Sports & Recreation",
  "sports and recreation": "Sports & Recreation",
  "sports": "Sports & Recreation",
  "recreation": "Sports & Recreation",
  "fitness": "Sports & Recreation",
  "gym": "Sports & Recreation",
  "athletic": "Sports & Recreation",
  "athletics": "Sports & Recreation",
  "games": "Sports & Recreation",

  // Food & Drink
  "food & drink": "Food & Drink",
  "food and drink": "Food & Drink",
  "food": "Food & Drink",
  "drink": "Food & Drink",
  "drinks": "Food & Drink",
  "restaurant": "Food & Drink",
  "restaurants": "Food & Drink",
  "dining": "Food & Drink",
  "cafe": "Food & Drink",
  "coffee": "Food & Drink",
  "brewery": "Food & Drink",
  "winery": "Food & Drink",
  "farmers market": "Food & Drink",

  // Anchor (community anchors)
  "anchor": "Anchor",
  "community": "Anchor",
  "local": "Anchor",
  "landmark": "Anchor",
  "attraction": "Anchor",
};

/**
 * Normalize category to canonical value
 */
export function normalizeCategory(category: string | null | undefined): CanonicalCategory | null {
  if (!category) return null;

  const normalized = category.toLowerCase().trim();

  // Direct match to canonical value
  const directMatch = CANONICAL_CATEGORIES.find(
    (c) => c.toLowerCase() === normalized
  );
  if (directMatch) return directMatch;

  // Synonym lookup
  const synonym = CATEGORY_SYNONYMS[normalized];
  if (synonym) return synonym;

  // Partial match (if category contains a keyword)
  for (const [key, value] of Object.entries(CATEGORY_SYNONYMS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }

  return null; // Unknown category - needs LLM enrichment
}

// ============================================================================
// PRICE NORMALIZATION
// ============================================================================

const PRICE_SYNONYMS: Record<string, CanonicalPriceBucket> = {
  // Free
  "free": "free",
  "no cost": "free",
  "no charge": "free",
  "complimentary": "free",
  "$0": "free",
  "0": "free",
  "donation": "free", // Treat as free for filtering
  "pay what you can": "free",
  "free admission": "free",
  "free entry": "free",

  // $ (under $30)
  "$": "$",
  "cheap": "$",
  "budget": "$",
  "inexpensive": "$",
  "affordable": "$",

  // $$ ($30-75)
  "$$": "$$",
  "moderate": "$$",
  "mid-range": "$$",
  "mid range": "$$",

  // $$$ ($75+)
  "$$$": "$$$",
  "expensive": "$$$",
  "premium": "$$$",
  "luxury": "$$$",
  "high-end": "$$$",
  "high end": "$$$",
};

/**
 * Normalize price to canonical bucket
 */
export function normalizePrice(
  price: string | number | null | undefined
): CanonicalPriceBucket {
  if (price === null || price === undefined) return "unknown";

  // Handle numeric price
  if (typeof price === "number") {
    if (price === 0) return "free";
    if (price < 30) return "$";
    if (price < 75) return "$$";
    return "$$$";
  }

  const normalized = price.toLowerCase().trim();

  // Direct match
  if (CANONICAL_PRICE_BUCKETS.includes(normalized as CanonicalPriceBucket)) {
    return normalized as CanonicalPriceBucket;
  }

  // Synonym lookup
  const synonym = PRICE_SYNONYMS[normalized];
  if (synonym) return synonym;

  // Parse numeric from string (e.g., "$25", "25.00", "$25-50")
  const numericMatch = normalized.match(/\$?(\d+(?:\.\d+)?)/);
  if (numericMatch) {
    const num = parseFloat(numericMatch[1]);
    if (num === 0) return "free";
    if (num < 30) return "$";
    if (num < 75) return "$$";
    return "$$$";
  }

  return "unknown";
}

// ============================================================================
// TAG NORMALIZATION
// ============================================================================

const TAG_SYNONYMS: Record<string, CanonicalTag> = {
  // Outdoors
  "outdoor": "outdoors",
  "outside": "outdoors",
  "nature": "outdoors",
  "hike": "hiking",
  "hikes": "hiking",
  "trail": "hiking",
  "trails": "hiking",
  "camp": "camping",
  "swim": "swimming",
  "pool": "swimming",
  "ski": "skiing",
  "snowboard": "snowboarding",

  // Audience
  "family friendly": "family_friendly",
  "family-friendly": "family_friendly",
  "families": "family_friendly",
  "children": "kids",
  "child friendly": "kids",
  "21+": "adults_only",
  "adult": "adults_only",
  "date": "date_night",
  "romantic": "date_night",
  "solo": "solo_friendly",
  "group": "group_activity",
  "groups": "group_activity",

  // Vibe
  "night life": "nightlife",
  "relax": "relaxing",
  "chill": "relaxing",
  "adventurous": "adventure",
  "arts": "cultural",
  "culture": "cultural",
  "learn": "educational",
  "learning": "educational",
  "social event": "social",
  "meetup": "social",
  "workout": "fitness",
  "exercise": "fitness",
  "health": "wellness",
  "spa": "wellness",

  // Food & Drink
  "restaurant": "food",
  "eating": "food",
  "beverage": "drinks",
  "beer": "drinks",
  "wine": "drinks",
  "cocktails": "drinks",
  "cafe": "coffee",
  "coffeeshop": "coffee",
  "dinner": "dining",
  "lunch": "dining",
  "brunch": "dining",
  "pub": "bar",
  "tavern": "bar",

  // Food & Drink (cont.)
  "brew pub": "brewery",
  "brewpub": "brewery",
  "craft beer": "brewery",

  // Entertainment / Events
  "music": "live_music",
  "band": "live_music",
  "gig": "concert",
  "show": "concert",
  "theatre": "theater",
  "performing arts": "theater",
  "gallery": "museum",
  "exhibit": "museum",
  "exhibition": "museum",
  "fest": "festival",
  "fair": "fair",
  "carnival": "fair",
  "farmers market": "market",
  "flea market": "market",

  // Nature & Outdoors
  "park": "parks",
  "state park": "parks",
  "national park": "parks",
  "wilderness": "nature",
  "forest": "nature",
  "wildlife": "nature",
  "lookout": "scenic",
  "overlook": "scenic",
  "viewpoint": "scenic",
  "trailhead": "trail",
  "path": "trail",
  "walking trail": "trail",

  // Venues
  "ice rink": "ice_skating",
  "skating rink": "ice_skating",

  // Other
  "no cost": "free",
  "cheap": "budget_friendly",
  "local favorite": "local_favorite",
  "hidden gem": "local_favorite",
  "seasonal event": "seasonal",
  "holiday": "seasonal",
  "dog friendly": "pet_friendly",
  "dogs allowed": "pet_friendly",
  "wheelchair": "accessible",
  "ada": "accessible",
  "store": "shopping",
  "retail": "shopping",
  "mall": "shopping",
  "community service": "volunteer",
  "volunteering": "volunteer",
};

/**
 * Normalize tags to canonical values
 */
export function normalizeTags(tags: string[] | null | undefined): CanonicalTag[] {
  if (!tags || tags.length === 0) return [];

  const normalized: CanonicalTag[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const lowerTag = tag.toLowerCase().trim().replace(/[\s-]+/g, "_");

    // Skip if already processed
    if (seen.has(lowerTag)) continue;
    seen.add(lowerTag);

    // Direct match to canonical value
    if (CANONICAL_TAGS.includes(lowerTag as CanonicalTag)) {
      normalized.push(lowerTag as CanonicalTag);
      continue;
    }

    // Synonym lookup (try with underscores and without)
    const synonym = TAG_SYNONYMS[lowerTag] ||
      TAG_SYNONYMS[lowerTag.replace(/_/g, " ")] ||
      TAG_SYNONYMS[tag.toLowerCase().trim()];

    if (synonym && !normalized.includes(synonym)) {
      normalized.push(synonym);
    }
  }

  return normalized;
}

// ============================================================================
// TOWN NORMALIZATION
// ============================================================================

const TOWN_SYNONYMS: Record<string, string> = {
  // Common variations - add your local towns here
  "nyc": "New York City",
  "new york": "New York City",
  "manhattan": "New York City",
  "brooklyn": "Brooklyn",
  "queens": "Queens",
  "la": "Los Angeles",
  "sf": "San Francisco",
  "san fran": "San Francisco",
  "dc": "Washington DC",
  "washington d.c.": "Washington DC",
  "philly": "Philadelphia",

  // Add Potsdam-area towns
  "potsdam": "Potsdam",
  "canton": "Canton",
  "massena": "Massena",
  "ogdensburg": "Ogdensburg",
  "norwood": "Norwood",
  "madrid": "Madrid",
  "colton": "Colton",
  "parishville": "Parishville",
  "pierrepont": "Pierrepont",
};

/**
 * Normalize town name to canonical value
 */
export function normalizeTown(town: string | null | undefined): string | null {
  if (!town) return null;

  const normalized = town.toLowerCase().trim();

  // Check for synonym
  const synonym = TOWN_SYNONYMS[normalized];
  if (synonym) return synonym;

  // Title case the original
  return town
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// ============================================================================
// MAIN NORMALIZATION FUNCTION
// ============================================================================

export interface NormalizationResult {
  category: CanonicalCategory | null;
  price_bucket: CanonicalPriceBucket;
  tags: CanonicalTag[];
  town: string | null;
  needsEnrichment: boolean;
  confidence: number;
}

/**
 * Normalize an explore item's filterable fields
 *
 * @param item - The explore item (or partial item data)
 * @returns Normalized values with confidence score
 */
export function normalizeExploreItem(item: Partial<ExploreItem>): NormalizationResult {
  const category = normalizeCategory(item.category);
  const price_bucket = normalizePrice(item.price_bucket);
  const tags = normalizeTags(item.tags);
  const town = normalizeTown(item.town);

  // Calculate confidence (0-100)
  let confidence = 100;
  const issues: string[] = [];

  if (!category && item.category) {
    confidence -= 30;
    issues.push("unknown_category");
  }
  if (price_bucket === "unknown" && item.price_bucket) {
    confidence -= 20;
    issues.push("unknown_price");
  }
  if (tags.length === 0 && item.tags && item.tags.length > 0) {
    confidence -= 20;
    issues.push("tags_not_normalized");
  }

  // Flag for LLM enrichment if confidence is low
  const needsEnrichment = confidence < 70;

  return {
    category,
    price_bucket,
    tags,
    town,
    needsEnrichment,
    confidence,
  };
}

/**
 * Apply normalization to an explore item, updating fields in place
 */
export function applyNormalization(
  item: Partial<ExploreItem>
): Partial<ExploreItem> {
  const result = normalizeExploreItem(item);

  return {
    ...item,
    category: result.category || item.category,
    price_bucket: result.price_bucket,
    tags: result.tags.length > 0 ? result.tags : item.tags,
    town: result.town || item.town,
  };
}

// ============================================================================
// REPAIR JOB HELPERS
// ============================================================================

/**
 * Check if an item needs normalization repair
 */
export function needsNormalizationRepair(item: ExploreItem): boolean {
  // Check category
  if (item.category && !CANONICAL_CATEGORIES.includes(item.category as CanonicalCategory)) {
    return true;
  }

  // Check price bucket
  if (item.price_bucket && !CANONICAL_PRICE_BUCKETS.includes(item.price_bucket as CanonicalPriceBucket)) {
    return true;
  }

  // Check tags
  if (item.tags && item.tags.length > 0) {
    const hasNonCanonical = item.tags.some(
      (tag) => !CANONICAL_TAGS.includes(tag as CanonicalTag)
    );
    if (hasNonCanonical) return true;
  }

  return false;
}

/**
 * Get repair suggestions for an item
 */
export function getRepairSuggestions(item: ExploreItem): {
  field: string;
  current: string | null;
  suggested: string | null;
}[] {
  const suggestions: { field: string; current: string | null; suggested: string | null }[] = [];
  const normalized = normalizeExploreItem(item);

  if (item.category !== normalized.category) {
    suggestions.push({
      field: "category",
      current: item.category,
      suggested: normalized.category,
    });
  }

  if (item.price_bucket !== normalized.price_bucket) {
    suggestions.push({
      field: "price_bucket",
      current: item.price_bucket,
      suggested: normalized.price_bucket,
    });
  }

  if (item.town !== normalized.town) {
    suggestions.push({
      field: "town",
      current: item.town,
      suggested: normalized.town,
    });
  }

  return suggestions;
}

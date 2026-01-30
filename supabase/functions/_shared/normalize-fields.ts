/**
 * Deterministic Field Normalization (Deno Edge Function version)
 *
 * Mirrors src/lib/normalizeExploreItem.ts for server-side normalization
 * during the ingestion pipeline. Ensures consistent field values before
 * data is written to explore_items.
 *
 * Applied by normalize-raw-events after source adapter mapping.
 */

// ============================================================================
// CANONICAL VALUES
// ============================================================================

const CANONICAL_CATEGORIES = [
  "Outdoor",
  "Nightlife",
  "Winter Activities",
  "Arts & Culture",
  "Sports & Recreation",
  "Food & Drink",
  "Anchor",
] as const;

type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

const CANONICAL_PRICE_BUCKETS = ["free", "$", "$$", "$$$", "unknown"] as const;
type CanonicalPriceBucket = (typeof CANONICAL_PRICE_BUCKETS)[number];

// Must match src/config/tagTaxonomy.ts CANONICAL_TAGS exactly
const CANONICAL_TAGS = [
  "outdoors", "indoors", "water_activity", "winter_activity",
  "hiking", "camping", "swimming", "skiing", "snowboarding",
  "family_friendly", "kids", "adults_only", "date_night",
  "solo_friendly", "group_activity",
  "nightlife", "relaxing", "adventure", "cultural", "educational",
  "social", "fitness", "wellness",
  "food", "drinks", "coffee", "dining", "bar", "brewery",
  "live_music", "concert", "theater", "museum", "festival", "market", "fair",
  "nature", "parks", "scenic", "trail",
  "ice_skating",
  "free", "budget_friendly", "local_favorite", "seasonal",
  "pet_friendly", "accessible", "shopping", "volunteer",
] as const;

type CanonicalTag = (typeof CANONICAL_TAGS)[number];

// ============================================================================
// CATEGORY NORMALIZATION
// ============================================================================

const CATEGORY_SYNONYMS: Record<string, CanonicalCategory> = {
  "outdoor": "Outdoor", "outdoors": "Outdoor", "nature": "Outdoor",
  "hiking": "Outdoor", "parks": "Outdoor", "trails": "Outdoor",
  "camping": "Outdoor", "beach": "Outdoor",
  "nightlife": "Nightlife", "night life": "Nightlife", "bars": "Nightlife",
  "clubs": "Nightlife", "clubbing": "Nightlife", "late night": "Nightlife",
  "winter activities": "Winter Activities", "winter": "Winter Activities",
  "skiing": "Winter Activities", "snowboarding": "Winter Activities",
  "ice skating": "Winter Activities", "snow sports": "Winter Activities",
  "arts & culture": "Arts & Culture", "arts and culture": "Arts & Culture",
  "arts": "Arts & Culture", "culture": "Arts & Culture",
  "museum": "Arts & Culture", "museums": "Arts & Culture",
  "gallery": "Arts & Culture", "galleries": "Arts & Culture",
  "theatre": "Arts & Culture", "theater": "Arts & Culture",
  "music": "Arts & Culture", "concert": "Arts & Culture",
  "concerts": "Arts & Culture", "live music": "Arts & Culture",
  "performance": "Arts & Culture", "art": "Arts & Culture",
  "entertainment": "Arts & Culture",
  "sports & recreation": "Sports & Recreation",
  "sports and recreation": "Sports & Recreation",
  "sports": "Sports & Recreation", "recreation": "Sports & Recreation",
  "fitness": "Sports & Recreation", "gym": "Sports & Recreation",
  "athletic": "Sports & Recreation", "athletics": "Sports & Recreation",
  "wellness": "Sports & Recreation",
  "food & drink": "Food & Drink", "food and drink": "Food & Drink",
  "food": "Food & Drink", "drink": "Food & Drink", "drinks": "Food & Drink",
  "restaurant": "Food & Drink", "restaurants": "Food & Drink",
  "dining": "Food & Drink", "cafe": "Food & Drink", "coffee": "Food & Drink",
  "brewery": "Food & Drink", "winery": "Food & Drink",
  "farmers market": "Food & Drink",
  "anchor": "Anchor", "community": "Anchor", "local": "Anchor",
  "landmark": "Anchor", "attraction": "Anchor",
};

function normalizeCategory(category: string | null | undefined): CanonicalCategory | null {
  if (!category) return null;
  const normalized = category.toLowerCase().trim();

  // Direct match
  const direct = CANONICAL_CATEGORIES.find((c) => c.toLowerCase() === normalized);
  if (direct) return direct;

  // Synonym
  const synonym = CATEGORY_SYNONYMS[normalized];
  if (synonym) return synonym;

  // Partial match
  for (const [key, value] of Object.entries(CATEGORY_SYNONYMS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value;
    }
  }

  return null;
}

// ============================================================================
// PRICE NORMALIZATION
// ============================================================================

function normalizePrice(price: string | number | null | undefined): CanonicalPriceBucket {
  if (price === null || price === undefined) return "unknown";

  if (typeof price === "number") {
    if (price === 0) return "free";
    if (price < 30) return "$";
    if (price < 75) return "$$";
    return "$$$";
  }

  const normalized = price.toLowerCase().trim();
  if (CANONICAL_PRICE_BUCKETS.includes(normalized as CanonicalPriceBucket)) {
    return normalized as CanonicalPriceBucket;
  }

  const priceSynonyms: Record<string, CanonicalPriceBucket> = {
    "free": "free", "no cost": "free", "complimentary": "free",
    "$0": "free", "0": "free", "donation": "free",
    "$": "$", "cheap": "$", "budget": "$", "affordable": "$",
    "$$": "$$", "moderate": "$$", "mid-range": "$$",
    "$$$": "$$$", "expensive": "$$$", "premium": "$$$",
  };

  const syn = priceSynonyms[normalized];
  if (syn) return syn;

  const numMatch = normalized.match(/\$?(\d+(?:\.\d+)?)/);
  if (numMatch) {
    const num = parseFloat(numMatch[1]);
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
  "outdoor": "outdoors", "outside": "outdoors", "nature": "outdoors",
  "hike": "hiking", "hikes": "hiking", "trail": "hiking", "trails": "hiking",
  "camp": "camping", "swim": "swimming", "pool": "swimming",
  "ski": "skiing", "snowboard": "snowboarding",
  "family friendly": "family_friendly", "family-friendly": "family_friendly",
  "families": "family_friendly", "children": "kids",
  "21+": "adults_only", "adult": "adults_only",
  "date": "date_night", "romantic": "date_night",
  "solo": "solo_friendly", "group": "group_activity",
  "night life": "nightlife", "relax": "relaxing", "chill": "relaxing",
  "adventurous": "adventure", "arts": "cultural", "culture": "cultural",
  "learn": "educational", "learning": "educational",
  "social event": "social", "meetup": "social",
  "workout": "fitness", "exercise": "fitness",
  "health": "wellness", "spa": "wellness",
  "restaurant": "food", "eating": "food",
  "beverage": "drinks", "beer": "drinks", "wine": "drinks",
  "cocktails": "drinks", "cafe": "coffee", "coffeeshop": "coffee",
  "dinner": "dining", "lunch": "dining", "brunch": "dining",
  "pub": "bar", "tavern": "bar",
  "brew pub": "brewery", "brewpub": "brewery", "craft beer": "brewery",
  "music": "live_music", "band": "live_music",
  "gig": "concert", "show": "concert",
  "theatre": "theater", "performing arts": "theater",
  "gallery": "museum", "exhibit": "museum", "exhibition": "museum",
  "fest": "festival", "fair": "fair", "carnival": "fair",
  "farmers market": "market", "flea market": "market",
  "park": "parks", "state park": "parks",
  "wilderness": "nature", "forest": "nature", "wildlife": "nature",
  "lookout": "scenic", "overlook": "scenic",
  "trailhead": "trail", "path": "trail",
  "ice rink": "ice_skating", "skating rink": "ice_skating",
  "no cost": "free", "cheap": "budget_friendly",
  "local favorite": "local_favorite", "hidden gem": "local_favorite",
  "seasonal event": "seasonal", "holiday": "seasonal",
  "dog friendly": "pet_friendly", "dogs allowed": "pet_friendly",
  "wheelchair": "accessible", "ada": "accessible",
  "store": "shopping", "retail": "shopping",
  "community service": "volunteer", "volunteering": "volunteer",
};

function normalizeTags(tags: string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) return [];

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const lower = tag.toLowerCase().trim().replace(/[\s-]+/g, "_");
    if (seen.has(lower)) continue;
    seen.add(lower);

    if ((CANONICAL_TAGS as readonly string[]).includes(lower)) {
      normalized.push(lower);
      continue;
    }

    const syn = TAG_SYNONYMS[lower] ||
      TAG_SYNONYMS[lower.replace(/_/g, " ")] ||
      TAG_SYNONYMS[tag.toLowerCase().trim()];

    if (syn && !normalized.includes(syn)) {
      normalized.push(syn);
    }
  }

  return normalized;
}

// ============================================================================
// TOWN NORMALIZATION
// ============================================================================

const TOWN_SYNONYMS: Record<string, string> = {
  "potsdam": "Potsdam", "canton": "Canton", "massena": "Massena",
  "ogdensburg": "Ogdensburg", "norwood": "Norwood", "madrid": "Madrid",
  "colton": "Colton", "parishville": "Parishville", "pierrepont": "Pierrepont",
};

function normalizeTown(town: string | null | undefined): string | null {
  if (!town) return null;
  const normalized = town.toLowerCase().trim();
  const synonym = TOWN_SYNONYMS[normalized];
  if (synonym) return synonym;
  return town.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export interface NormalizedFields {
  category: string | null;
  price_bucket: string;
  tags: string[];
  town: string | null;
  normalized_confidence: number;
}

/**
 * Apply deterministic normalization to fields from a source adapter.
 * Returns normalized values + confidence score.
 */
export function normalizeFields(item: {
  category?: string | null;
  price_bucket?: string | null;
  tags?: string[] | null;
  town?: string | null;
}): NormalizedFields {
  const category = normalizeCategory(item.category);
  const price_bucket = normalizePrice(item.price_bucket);
  const tags = normalizeTags(item.tags);
  const town = normalizeTown(item.town);

  // Confidence scoring (mirrors migration 030 logic)
  let confidence = 100;
  if (!category && item.category) confidence -= 30;
  if (price_bucket === "unknown") confidence -= 20;
  if (tags.length === 0 && item.tags && item.tags.length > 0) confidence -= 20;

  return {
    category: category || item.category || null,
    price_bucket,
    tags: tags.length > 0 ? tags : (item.tags || []),
    town: town || item.town || null,
    normalized_confidence: Math.max(0, confidence),
  };
}

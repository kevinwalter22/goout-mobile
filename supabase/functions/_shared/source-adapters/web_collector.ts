/**
 * Web Collector Adapter
 *
 * Normalizes event candidates extracted from web pages into explore_items.
 * Candidates come from the deterministic extraction pipeline (JSON-LD, ICS, RSS, DOM).
 *
 * The raw_json structure differs from API sources:
 * - Contains extracted fields (title, starts_at, location, etc.)
 * - Includes evidence array with extraction details
 * - Has confidence score and validation status
 */

import type { NormalizedEvent } from "./ticketmaster.ts";
import { computeReviewStatus } from "../web-extractors.ts";

// ============================================================================
// Types
// ============================================================================

interface WebCollectorCandidate {
  // Required fields
  title: string;
  source_url: string;

  // Temporal
  starts_at?: string;
  ends_at?: string;
  recurrence_text?: string;

  // Location
  location_name?: string;
  address?: string;
  lat?: number;
  lng?: number;

  // Content
  description_snippet?: string;
  image_url?: string;

  // Extraction metadata
  evidence: Array<{
    field: string;
    source: string;
    value: string;
    selector?: string;
    raw_snippet?: string;
  }>;
  extraction_strategy: string;
  confidence: number;

  // Validation
  validation_errors: string[];
  is_valid: boolean;

  // Added by ingestion pipeline
  _target_name?: string;
  _target_base_url?: string;
  _target_town?: string;
  _target_venue_name?: string;
  _target_default_category?: string;
  _target_content_types?: string[];
}

// ============================================================================
// Category Mapping (based on keywords in title/description)
// ============================================================================

// ORDERING MATTERS: Object.entries() iterates in insertion order.
// Activity-type categories MUST come before venue-type categories (food, nightlife)
// to prevent venue-type bleed (e.g., "board game night at a brewery" → "food").
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  // Activity-type categories FIRST — these identify WHAT the event IS

  // Recreation (social gaming, trivia — most common venue-bleed victims)
  recreation: [
    "board game", "board games", "game night", "games night",
    "trivia night", "trivia", "pub quiz", "pub trivia",
    "escape room", "escape rooms",
    "bingo night", "bingo",
    "karaoke night", "karaoke",
    "tabletop", "dungeons & dragons", "d&d",
    "game show", "bowling", "pool",
  ],

  // Music (strong activity signal)
  music: ["concert", "live music", "band", "musician", "orchestra", "jazz", "rock", "folk"],

  // Arts & Culture
  arts: ["art", "gallery", "exhibit", "museum", "painting", "sculpture", "photography"],

  // Entertainment (performing arts — checked after gaming/music to avoid false positives)
  entertainment: ["movie", "film", "cinema", "theater", "show", "performance", "comedy", "magic"],

  // Sports & Fitness
  fitness: ["yoga", "fitness", "workout", "run", "walk", "hike", "bike", "gym"],
  sports: ["match", "tournament", "hockey", "basketball", "football", "soccer"],

  // Education
  education: ["workshop", "class", "lecture", "seminar", "talk", "learn", "training"],

  // Outdoor
  outdoor: ["outdoor", "park", "nature", "trail", "garden", "camping", "fishing"],

  // Community
  community: ["meeting", "club", "group", "volunteer", "charity", "fundraiser", "market", "fair"],

  // Venue-type categories LAST — only match if no activity-type keyword matched above.
  // A board game night at a brewery will match "recreation" before reaching these.
  nightlife: ["bar", "cocktail", "happy hour", "pub", "brewery", "wine", "beer"],
  food: ["dinner", "brunch", "lunch", "food", "tasting", "cooking", "chef", "cuisine", "restaurant"],
};

const TAG_KEYWORDS: Record<string, string[]> = {
  family_friendly: ["family", "kids", "children", "all ages", "child"],
  adults_only: ["21+", "18+", "adults only", "bar"],
  free: ["free", "no charge", "complimentary", "donation"],
  indoors: ["indoor", "inside"],
  outdoors: ["outdoor", "outside", "park"],
  live_music: ["live music", "live band", "concert"],
  food_drink: ["food", "drink", "dinner", "lunch", "brunch"],
  educational: ["workshop", "class", "learn", "lecture", "seminar"],
};

// ============================================================================
// Normalization Function
// ============================================================================

export function normalizeWebCollectorCandidate(raw: WebCollectorCandidate): NormalizedEvent {
  // Title (already validated)
  const title = raw.title.trim();

  // Combine title and description for keyword matching
  const searchText = `${title} ${raw.description_snippet || ""}`.toLowerCase();

  // Determine category (use target fallback if keyword inference returns default)
  let category = inferCategory(searchText);
  if (category === "community" && raw._target_default_category) {
    category = raw._target_default_category;
  }

  // Determine tags
  const tags = inferTags(searchText);

  // Kind: use target content_types hint, else infer from starts_at
  let kind: "event" | "activity" = raw.starts_at ? "event" : "activity";
  if (raw._target_content_types && raw._target_content_types.length === 1) {
    if (raw._target_content_types[0] === "events") kind = "event";
    else if (raw._target_content_types[0] === "activities") kind = "activity";
  }

  // Price bucket (basic inference from text)
  const priceBucket = inferPriceBucket(searchText);

  // Extract town from address, with target fallback
  const town = extractTown(raw.address) || raw._target_town || undefined;

  // Calculate priority based on confidence and recency
  const priority = calculatePriority(raw);

  // Calculate XP
  const xpValue = calculateXp(category, tags);

  // Build schedule text from recurrence
  const scheduleText = raw.recurrence_text || undefined;

  // Build external_id from source_url
  const externalId = generateExternalId(raw.source_url);

  // Build provenance audit trail
  const provenance: Record<string, any> = {
    source_url: raw.source_url,
    extraction_method: raw.extraction_strategy,
    extraction_confidence: raw.confidence,
    target_name: raw._target_name || null,
    collected_at: new Date().toISOString(),
    evidence_fields: (raw.evidence || []).map((e) => `${e.field}:${e.source}`),
    validation_warnings: raw.validation_errors || [],
  };

  // Compute review status based on quality gates
  const reviewStatus = computeReviewStatus(raw, kind);

  return {
    kind,
    title,
    description: raw.description_snippet,
    hook_line: generateHookLine(raw),
    category,
    sub_category: raw.extraction_strategy, // Store extraction strategy as sub_category for reference
    location_name: raw.location_name || raw._target_venue_name || null,
    address: raw.address,
    town,
    lat: raw.lat,
    lng: raw.lng,
    starts_at: raw.starts_at,
    ends_at: raw.ends_at,
    schedule_text: scheduleText,
    recurrence: raw.recurrence_text ? "custom" : undefined,
    season: inferSeason(raw.starts_at),
    price_bucket: priceBucket,
    effort: "low", // Web events are typically low effort
    xp_value: xpValue,
    priority,
    is_anchor: false,
    is_hidden_gem: raw.confidence < 60 && raw.is_valid, // Low confidence but valid = hidden gem
    source_url: raw.source_url,
    external_id: externalId,
    tags,

    image_url: raw.image_url || null,
    image_thumb_url: raw.image_url || null,
    image_source: raw.image_url ? "web_collector" : null,

    // Phase B: provenance + review status
    review_status: reviewStatus,
    provenance,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function inferCategory(searchText: string): string {
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }
  return "community"; // Default category
}

function inferTags(searchText: string): string[] {
  const tags: string[] = [];

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        tags.push(tag);
        break; // Only add each tag once
      }
    }
  }

  return tags;
}

function inferPriceBucket(searchText: string): "free" | "$" | "$$" | "$$$" | "unknown" {
  if (
    searchText.includes("free") ||
    searchText.includes("no charge") ||
    searchText.includes("complimentary") ||
    searchText.includes("donation")
  ) {
    return "free";
  }

  // Look for price indicators
  const priceMatch = searchText.match(/\$(\d+)/);
  if (priceMatch) {
    const price = parseInt(priceMatch[1], 10);
    if (price === 0) return "free";
    if (price <= 15) return "$";
    if (price <= 50) return "$$";
    return "$$$";
  }

  return "unknown";
}

function extractTown(address: string | undefined): string | undefined {
  if (!address) return undefined;

  // Common patterns: "City, State" or "City, ST ZIP"
  const parts = address.split(",");
  if (parts.length >= 2) {
    // Return the city part (usually second-to-last before state)
    const cityPart = parts[parts.length - 2]?.trim();
    if (cityPart && !/^\d{5}/.test(cityPart)) {
      return cityPart;
    }
  }

  return undefined;
}

function calculatePriority(candidate: WebCollectorCandidate): number {
  let priority = 30; // Base priority

  // Boost for high confidence
  if (candidate.confidence >= 80) {
    priority += 20;
  } else if (candidate.confidence >= 60) {
    priority += 10;
  }

  // Boost for having temporal info
  if (candidate.starts_at) {
    priority += 10;
  }

  // Boost for having location
  if (candidate.location_name || candidate.address) {
    priority += 5;
  }

  // Boost for JSON-LD extraction (highest quality)
  if (candidate.extraction_strategy === "jsonld") {
    priority += 10;
  } else if (candidate.extraction_strategy === "ics") {
    priority += 5;
  }

  return Math.min(priority, 80);
}

function calculateXp(category: string, tags: string[]): number {
  let xp = 25; // Base XP

  // Category bonuses
  const categoryBonus: Record<string, number> = {
    fitness: 15,
    outdoor: 15,
    education: 10,
    arts: 10,
    community: 10,
  };

  if (categoryBonus[category]) {
    xp += categoryBonus[category];
  }

  // Tag bonuses
  if (tags.includes("educational")) xp += 5;
  if (tags.includes("outdoors")) xp += 5;

  return Math.min(xp, 60);
}

function inferSeason(startsAt: string | undefined): string | undefined {
  if (!startsAt) return undefined;

  try {
    const date = new Date(startsAt);
    const month = date.getMonth();

    if (month >= 2 && month <= 4) return "spring";
    if (month >= 5 && month <= 7) return "summer";
    if (month >= 8 && month <= 10) return "fall";
    return "winter";
  } catch {
    return undefined;
  }
}

function generateHookLine(candidate: WebCollectorCandidate): string | undefined {
  // Generate a short hook line based on available info
  const parts: string[] = [];

  if (candidate.recurrence_text) {
    parts.push(candidate.recurrence_text);
  }

  if (candidate.location_name && parts.length === 0) {
    parts.push(`at ${candidate.location_name}`);
  }

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function generateExternalId(sourceUrl: string): string {
  // Create a stable external ID from the source URL
  // Use URL path + query to handle pagination/variants
  try {
    const url = new URL(sourceUrl);
    return `web:${url.hostname}${url.pathname}${url.search}`.substring(0, 255);
  } catch {
    return `web:${sourceUrl.substring(0, 250)}`;
  }
}

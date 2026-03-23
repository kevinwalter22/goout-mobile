/**
 * PredictHQ Source Adapter
 *
 * Maps PredictHQ Events API v1 data to explore_items schema.
 * Events are treated as "event" kind (time-bound).
 *
 * PredictHQ API Reference:
 * https://docs.predicthq.com/api/events/search-events
 */

import type { NormalizedEvent } from "./ticketmaster.ts";

// ============================================================================
// PHQ category → Canonical category mapping
// ============================================================================

const CATEGORY_MAP: Record<string, string> = {
  community: "arts",
  concerts: "nightlife",
  conferences: "arts",
  expos: "arts",
  festivals: "arts",
  "performing-arts": "arts",
  sports: "recreation",
  academic: "arts",
  "public-holidays": "community",
  observances: "community",
  "school-holidays": "community",
};

// ============================================================================
// PHQ category → Tags mapping
// ============================================================================

const CATEGORY_TAGS_MAP: Record<string, string[]> = {
  community: ["social", "local_favorite"],
  concerts: ["concert", "live_music"],
  conferences: ["educational", "indoors"],
  expos: ["educational", "indoors"],
  festivals: ["festival", "social", "outdoors"],
  "performing-arts": ["theater", "cultural"],
  sports: ["outdoors"],
  academic: ["educational"],
  "public-holidays": ["seasonal", "free"],
  observances: ["seasonal"],
  "school-holidays": ["family_friendly"],
};

// ============================================================================
// PHQ labels → Additional tags
// ============================================================================

const LABEL_TAGS_MAP: Record<string, string[]> = {
  // Music genres
  music: ["live_music"],
  rock: ["live_music", "concert"],
  pop: ["live_music", "concert"],
  jazz: ["live_music", "concert", "cultural"],
  classical: ["live_music", "concert", "cultural"],
  country: ["live_music", "concert"],
  "hip-hop": ["live_music", "concert"],
  electronic: ["live_music", "concert", "nightlife"],
  folk: ["live_music", "concert"],

  // Sports
  hockey: [],
  basketball: [],
  football: [],
  soccer: [],
  baseball: [],

  // Event types
  food: ["food"],
  beer: ["drinks", "brewery"],
  wine: ["drinks"],
  art: ["cultural", "museum"],
  film: ["indoors"],
  comedy: ["nightlife", "social"],
  theater: ["theater", "cultural"],
  dance: ["cultural"],
  charity: ["volunteer", "social"],
  market: ["market", "shopping"],
  outdoor: ["outdoors"],
  family: ["family_friendly"],
  holiday: ["seasonal"],
  christmas: ["seasonal", "winter_activity"],
  halloween: ["seasonal"],
  craft: ["educational"],
  wellness: ["wellness"],
  fitness: ["fitness"],
  running: ["fitness", "outdoors"],
};

// ============================================================================
// Helper functions
// ============================================================================

function collectTags(category: string, labels: string[]): string[] {
  const tags = new Set<string>();

  // Tags from PHQ category
  const categoryTags = CATEGORY_TAGS_MAP[category];
  if (categoryTags) {
    for (const tag of categoryTags) tags.add(tag);
  }

  // Tags from PHQ labels
  for (const label of labels) {
    const labelLower = label.toLowerCase();
    const mapped = LABEL_TAGS_MAP[labelLower];
    if (mapped) {
      for (const tag of mapped) tags.add(tag);
    }
  }

  // Ensure at least one setting tag
  if (!tags.has("outdoors") && !tags.has("indoors")) {
    // Default: concerts, conferences, expos are usually indoors
    const indoorCategories = new Set(["concerts", "conferences", "expos", "performing-arts"]);
    if (indoorCategories.has(category)) {
      tags.add("indoors");
    }
  }

  return Array.from(tags);
}

function extractTown(geo: any): string | null {
  const address = geo?.address;
  if (!address) return null;
  const locality = address.locality;
  const region = address.region;
  if (locality && region) return `${locality}, ${region}`;
  if (locality) return locality;

  // Try to parse from formatted_address
  const formatted = address.formatted_address;
  if (formatted) {
    const parts = formatted.split("\n");
    // Look for "City, STATE ZIP" pattern
    for (const part of parts) {
      const match = part.match(/^([^,]+),\s*([A-Z]{2})\s/);
      if (match) return `${match[1]}, ${match[2]}`;
    }
  }

  return null;
}

function calculatePriority(rank: number, localRank: number | null, attendance: number | null): number {
  // PHQ rank 0-100 → priority 30-85
  let priority = 30 + Math.floor((rank / 100) * 55);

  if (localRank && localRank > 60) priority += 10;
  else if (localRank && localRank > 30) priority += 5;

  if (attendance && attendance > 1000) priority += 5;

  return Math.min(priority, 90);
}

function calculateXp(category: string, rank: number): number {
  let xp = 50;

  const categoryBonus: Record<string, number> = {
    concerts: 20,
    festivals: 25,
    "performing-arts": 15,
    sports: 25,
    community: 10,
    conferences: 10,
    expos: 10,
  };
  xp += categoryBonus[category] || 0;

  if (rank > 70) xp += 15;
  else if (rank > 40) xp += 10;

  return Math.min(xp, 100);
}

function isAnchorEvent(
  rank: number,
  localRank: number | null,
  attendance: number | null,
  title: string,
): boolean {
  if (rank >= 70 && attendance && attendance >= 500) return true;
  if (localRank && localRank >= 80) return true;

  const lowerTitle = title.toLowerCase();
  const anchorKeywords = ["championship", "festival", "finals", "tournament", "grand"];
  if (anchorKeywords.some((k) => lowerTitle.includes(k)) && rank >= 50) return true;

  return false;
}

function inferSeason(startDate: string | null): string | null {
  if (!startDate) return null;
  try {
    const date = new Date(startDate);
    const month = date.getMonth();
    if (month >= 2 && month <= 4) return "spring";
    if (month >= 5 && month <= 7) return "summer";
    if (month >= 8 && month <= 10) return "fall";
    return "winter";
  } catch {
    return null;
  }
}

// ============================================================================
// Main normalization function
// ============================================================================

/**
 * Converts PredictHQ Events API v1 raw JSON to explore_items format.
 * Events are treated as kind="event" (time-bound).
 */
export function normalizePredictHQEvent(raw: any): NormalizedEvent {
  const phqCategory = raw.category as string || "community";
  const category = CATEGORY_MAP[phqCategory] || "community";
  const labels = (raw.labels || []) as string[];

  const tags = collectTags(phqCategory, labels);

  // Location: GeoJSON is [longitude, latitude]
  const lat = raw.geo?.geometry?.coordinates?.[1]
    || raw.location?.[1]
    || null;
  const lng = raw.geo?.geometry?.coordinates?.[0]
    || raw.location?.[0]
    || null;

  // Venue from entities
  const entities = (raw.entities || []) as Array<{
    entity_id: string;
    name: string;
    type: string;
    formatted_address?: string;
  }>;
  const venueEntity = entities.find((e) => e.type === "venue");
  const locationName = venueEntity?.name || null;

  // Address
  const address = raw.geo?.address?.formatted_address
    || venueEntity?.formatted_address
    || null;

  const town = extractTown(raw.geo);

  // Dates
  const startsAt = raw.start || raw.start_local || null;
  const endsAt = raw.end || raw.end_local || null;

  const rank = (raw.rank as number) || 0;
  const localRank = (raw.local_rank as number) || null;
  const attendance = (raw.phq_attendance as number) || null;

  const description = raw.description
    ? (raw.description as string).substring(0, 2000)
    : null;

  return {
    kind: "event",
    title: raw.title,
    description,
    hook_line: null, // LLM enrichment

    category,
    sub_category: phqCategory,

    location_name: locationName,
    address,
    town,
    lat,
    lng,

    starts_at: startsAt,
    ends_at: endsAt,
    schedule_text: null,
    time_text: null,
    recurrence: null,
    season: inferSeason(startsAt),

    price_bucket: "unknown", // PredictHQ doesn't provide pricing
    effort: "low",

    xp_value: calculateXp(phqCategory, rank),
    priority: calculatePriority(rank, localRank, attendance),
    is_anchor: isAnchorEvent(rank, localRank, attendance, raw.title),
    is_hidden_gem: false,

    source_url: null, // PredictHQ doesn't provide source URLs in search
    external_id: raw.id,

    tags,

    provenance: {
      phq_rank: rank,
      phq_local_rank: localRank,
      phq_attendance: attendance,
      phq_category: phqCategory,
      phq_labels: labels,
      phq_state: raw.state || null,
      brand_safe: raw.brand_safe ?? true,
      predicted_spend: raw.predicted_event_spend || null,
    },
  };
}

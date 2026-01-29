/**
 * Canonical Tag Taxonomy — Single Source of Truth
 *
 * ALL tag lists in this project MUST match this file exactly.
 * If you add or remove a tag here, update BOTH:
 *   1. supabase/functions/_shared/enrichment-schema.ts → VALID_TAGS
 *   2. src/lib/normalizeExploreItem.ts → (imports from this file)
 *
 * Run `npx ts-node scripts/check_tag_sync.ts` to verify parity.
 */

export const CANONICAL_TAGS = [
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

export type CanonicalTag = (typeof CANONICAL_TAGS)[number];

/** Total count for sync verification */
export const CANONICAL_TAG_COUNT = CANONICAL_TAGS.length; // 49

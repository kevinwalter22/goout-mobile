/**
 * Eventbrite Source Adapter
 *
 * Maps Eventbrite API v3 event data to explore_items schema.
 * Follows the same adapter pattern as ticketmaster.ts.
 *
 * Eventbrite API Reference:
 * https://www.eventbrite.com/platform/api#/reference/event
 */

import type { NormalizedEvent } from "./ticketmaster.ts";

// ============================================================================
// CATEGORY MAPPING
// ============================================================================

/**
 * Eventbrite category IDs → our categories
 * https://www.eventbrite.com/platform/api#/reference/categories
 */
const CATEGORY_MAP: Record<string, string> = {
  // Eventbrite category_id → our category string
  "103": "music",          // Music
  "101": "community",      // Business & Professional
  "110": "food",           // Food & Drink
  "113": "community",      // Community & Culture
  "105": "arts",           // Performing & Visual Arts
  "104": "entertainment",  // Film, Media & Entertainment
  "108": "sports",         // Sports & Fitness
  "107": "wellness",       // Health & Wellness  (→ maps to Sports & Recreation downstream)
  "102": "arts",           // Science & Technology
  "109": "community",      // Travel & Outdoor  (outdoor events)
  "111": "community",      // Charity & Causes
  "112": "community",      // Government & Politics
  "114": "arts",           // Religion & Spirituality
  "106": "community",      // Fashion & Beauty
  "115": "community",      // Home & Lifestyle
  "116": "community",      // Auto, Boat & Air
  "117": "community",      // Hobbies & Special Interest
  "199": "community",      // Other
  "120": "community",      // Seasonal & Holiday
};

/**
 * Subcategory name from Eventbrite subcategory object
 */
function mapCategory(category: any, subcategory: any): {
  category: string | null;
  sub_category: string | null;
} {
  const categoryId = category?.id?.toString() || category?.toString();
  const mapped = categoryId ? CATEGORY_MAP[categoryId] || null : null;
  const subName = subcategory?.name || subcategory?.short_name || null;
  return { category: mapped, sub_category: subName };
}

// ============================================================================
// PRICE MAPPING
// ============================================================================

function mapPriceBucket(
  isFree: boolean | undefined,
  ticketClasses: any[] | undefined
): "free" | "$" | "$$" | "$$$" | "unknown" {
  if (isFree) return "free";
  if (!ticketClasses || ticketClasses.length === 0) return "unknown";

  // Find lowest non-zero cost (in cents or major units depending on API version)
  let minCost = Infinity;
  for (const tc of ticketClasses) {
    const cost = tc.cost?.major_value
      ? parseFloat(tc.cost.major_value)
      : tc.cost?.value
        ? tc.cost.value / 100
        : null;
    if (cost !== null && cost >= 0 && cost < minCost) {
      minCost = cost;
    }
  }

  if (minCost === 0 || minCost === Infinity) return minCost === 0 ? "free" : "unknown";
  if (minCost < 30) return "$";
  if (minCost < 75) return "$$";
  return "$$$";
}

// ============================================================================
// LOCATION EXTRACTION
// ============================================================================

function extractVenue(venue: any): {
  location_name: string | null;
  address: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
} {
  if (!venue) {
    return { location_name: null, address: null, town: null, lat: null, lng: null };
  }

  const addr = venue.address || {};
  const addressParts: string[] = [];
  if (addr.address_1) addressParts.push(addr.address_1);
  if (addr.address_2) addressParts.push(addr.address_2);

  let town: string | null = null;
  if (addr.city && addr.region) {
    town = `${addr.city}, ${addr.region}`;
  } else if (addr.city) {
    town = addr.city;
  }

  return {
    location_name: venue.name || null,
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    town,
    lat: venue.latitude ? parseFloat(venue.latitude) : (addr.latitude ? parseFloat(addr.latitude) : null),
    lng: venue.longitude ? parseFloat(venue.longitude) : (addr.longitude ? parseFloat(addr.longitude) : null),
  };
}

// ============================================================================
// DATE EXTRACTION
// ============================================================================

function extractDateTime(event: any): {
  starts_at: string | null;
  ends_at: string | null;
  time_text: string | null;
} {
  // Eventbrite uses start.utc / start.local and end.utc / end.local
  const startUtc = event.start?.utc || null;
  const endUtc = event.end?.utc || null;

  let time_text: string | null = null;
  if (!startUtc) {
    time_text = "Time TBA";
  }

  return {
    starts_at: startUtc,
    ends_at: endUtc,
    time_text,
  };
}

// ============================================================================
// DESCRIPTION EXTRACTION
// ============================================================================

/**
 * Strip HTML tags from Eventbrite description
 */
function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  // Remove HTML tags, decode common entities
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000); // Cap length
}

// ============================================================================
// MAIN NORMALIZER
// ============================================================================

/**
 * Normalize an Eventbrite event into explore_items format.
 *
 * Expects the raw JSON from Eventbrite's /events/ endpoint, optionally
 * expanded with venue and ticket_classes.
 */
export function normalizeEventbriteEvent(raw: any): NormalizedEvent {
  const { category, sub_category } = mapCategory(raw.category_id, raw.subcategory);
  const venue = extractVenue(raw.venue);
  const dateTime = extractDateTime(raw);

  // Description: Eventbrite uses summary (plain text) and description.html
  const description =
    raw.summary ||
    stripHtml(raw.description?.html || raw.description?.text) ||
    null;

  // Eventbrite provides is_free directly
  const price_bucket = mapPriceBucket(raw.is_free, raw.ticket_classes);

  // Priority: online-only events get lower priority
  const isOnline = raw.online_event === true;
  const priority = isOnline ? 30 : 50;

  return {
    kind: "event",
    title: raw.name?.text || raw.name?.html || raw.name || "Untitled Event",
    description,
    hook_line: null, // LLM will generate

    category,
    sub_category,

    ...venue,

    ...dateTime,
    schedule_text: null,
    recurrence: null,
    season: null,

    price_bucket,
    effort: "low",

    xp_value: 50,
    priority,
    is_anchor: false, // Could be enhanced later with capacity checks
    is_hidden_gem: false,

    source_url: raw.url || null,
    external_id: raw.id?.toString() || "",
  };
}

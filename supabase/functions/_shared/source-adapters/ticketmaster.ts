/**
 * Ticketmaster Source Adapter
 *
 * Maps Ticketmaster Discovery API event data to explore_items schema.
 * Isolated adapter pattern makes it easy to add new sources.
 *
 * Ticketmaster API Reference:
 * https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */

export interface NormalizedEvent {
  // Core
  kind: "event" | "activity";
  title: string;
  description: string | null;
  hook_line: string | null;

  // Categorization
  category: string | null;
  sub_category: string | null;

  // Location
  location_name: string | null;
  address: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;

  // Timing
  starts_at: string | null;
  ends_at: string | null;
  schedule_text: string | null;
  time_text: string | null;
  recurrence: string | null;
  season: string | null;

  // Pricing
  price_bucket: "free" | "$" | "$$" | "$$$" | "unknown";

  // Effort
  effort: "low" | "medium" | "high" | "unknown";

  // Gamification
  xp_value: number;
  priority: number;
  is_anchor: boolean;
  is_hidden_gem: boolean;

  // Tags (optional — normalizeFields will canonicalize these)
  tags?: string[];

  // Source
  source_url: string | null;
  external_id: string;

  // Image (optional — source-provided images)
  image_url?: string | null;
  image_thumb_url?: string | null;
  image_source?: string | null;

  // Provenance + review (optional — used by web collector adapter)
  review_status?: string;
  provenance?: Record<string, any>;
}

/**
 * Map Ticketmaster genre/segment to our category system
 */
function mapCategory(
  classifications: any[] | undefined
): { category: string | null; sub_category: string | null } {
  if (!classifications || classifications.length === 0) {
    return { category: null, sub_category: null };
  }

  const primary = classifications[0];

  // Map Ticketmaster segments to our categories
  const segmentMap: Record<string, string> = {
    Music: "music",
    Sports: "sports",
    "Arts & Theatre": "arts",
    Film: "entertainment",
    Miscellaneous: "community",
    Undefined: "community",
  };

  const segment = primary.segment?.name;
  const genre = primary.genre?.name;
  const subGenre = primary.subGenre?.name;

  const category = segment ? segmentMap[segment] || segment.toLowerCase() : null;
  const sub_category = genre || subGenre || null;

  return { category, sub_category };
}

/**
 * Map Ticketmaster price ranges to our price bucket enum.
 *
 * Only marks "free" when the MAX price is also $0, preventing false
 * "free" labels on events with student/discount tiers at $0 but paid
 * general admission (e.g., college hockey).
 */
function mapPriceBucket(
  priceRanges: any[] | undefined
): "free" | "$" | "$$" | "$$$" | "unknown" {
  if (!priceRanges || priceRanges.length === 0) {
    return "unknown";
  }

  const range = priceRanges[0];
  const minPrice = typeof range.min === "number" ? range.min : null;
  const maxPrice = typeof range.max === "number" ? range.max : null;

  // Only "free" if both min and max are $0 (genuinely free event)
  if (minPrice === 0 && (maxPrice === null || maxPrice === 0)) return "free";

  // If min is $0 but max is positive → tiered pricing (not free)
  const effectivePrice = minPrice != null && minPrice > 0 ? minPrice : maxPrice ?? 0;
  if (effectivePrice === 0) return "unknown";
  if (effectivePrice < 30) return "$";
  if (effectivePrice < 75) return "$$";
  return "$$$";
}

/**
 * Extract venue information
 */
function extractVenue(embedded: any): {
  location_name: string | null;
  address: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
} {
  const venues = embedded?._embedded?.venues;
  if (!venues || venues.length === 0) {
    return {
      location_name: null,
      address: null,
      town: null,
      lat: null,
      lng: null,
    };
  }

  const venue = venues[0];
  const location = venue.location;

  // Build address from components
  const addressParts = [];
  if (venue.address?.line1) addressParts.push(venue.address.line1);
  if (venue.address?.line2) addressParts.push(venue.address.line2);

  // Get city/state
  const city = venue.city?.name;
  const state = venue.state?.stateCode || venue.state?.name;
  const postalCode = venue.postalCode;

  let town = null;
  if (city && state) {
    town = `${city}, ${state}`;
  } else if (city) {
    town = city;
  }

  if (postalCode && addressParts.length > 0) {
    addressParts.push(postalCode);
  }

  return {
    location_name: venue.name || null,
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    town,
    lat: location?.latitude ? parseFloat(location.latitude) : null,
    lng: location?.longitude ? parseFloat(location.longitude) : null,
  };
}

/**
 * Extract date/time information
 */
function extractDateTime(dates: any): {
  starts_at: string | null;
  ends_at: string | null;
  time_text: string | null;
} {
  if (!dates?.start) {
    return { starts_at: null, ends_at: null, time_text: null };
  }

  const start = dates.start;
  let starts_at: string | null = null;
  let time_text: string | null = null;

  // Ticketmaster provides dateTime in ISO format or separate date/time
  if (start.dateTime) {
    starts_at = start.dateTime;
  } else if (start.localDate) {
    // Combine date and time if available
    if (start.localTime) {
      starts_at = `${start.localDate}T${start.localTime}`;
    } else {
      starts_at = `${start.localDate}T00:00:00`;
      time_text = "Time TBA";
    }
  }

  // Check for TBA status
  if (start.timeTBA || start.noSpecificTime) {
    time_text = "Time TBA";
  }

  // End time is often not provided by Ticketmaster
  const ends_at = dates.end?.dateTime || null;

  return { starts_at, ends_at, time_text };
}

/**
 * Calculate XP value based on event type
 */
function calculateXp(event: any): number {
  // Base XP
  let xp = 50;

  // Boost for larger events (flagship venues, etc.)
  const venues = event._embedded?.venues;
  if (venues?.[0]?.upcomingEvents?._total > 100) {
    xp += 25; // Major venue
  }

  // Boost for certain categories
  const segment = event.classifications?.[0]?.segment?.name;
  if (segment === "Sports") {
    xp += 25;
  } else if (segment === "Music") {
    xp += 20;
  }

  return Math.min(xp, 100); // Cap at 100
}

/**
 * Determine if this is an anchor event (major event worth featuring)
 */
function isAnchorEvent(event: any): boolean {
  // Check for certain keywords or properties that indicate major events
  const name = event.name?.toLowerCase() || "";

  // Major artist/team indicators
  if (event.attractions?.length > 0) {
    const attraction = event.attractions[0];
    if (attraction.upcomingEvents?._total > 50) {
      return true; // Touring artist with many shows
    }
  }

  // Playoff/championship games
  if (
    name.includes("playoff") ||
    name.includes("championship") ||
    name.includes("finals")
  ) {
    return true;
  }

  return false;
}

/**
 * Main normalization function
 * Converts Ticketmaster raw JSON to explore_items format
 */
export function normalizeTicketmasterEvent(raw: any): NormalizedEvent {
  const { category, sub_category } = mapCategory(raw.classifications);
  const venue = extractVenue(raw);
  const dateTime = extractDateTime(raw.dates);

  // Build description from various text fields
  let description = raw.info || raw.pleaseNote || null;
  if (raw.pleaseNote && raw.info) {
    description = `${raw.info}\n\nNote: ${raw.pleaseNote}`;
  }

  // Select best images from Ticketmaster CDN
  const images = raw.images || [];

  // Full-size: prefer 16:9 ratio with width >= 640, then any large image
  const fullImage =
    images
      .filter((img: any) => img.ratio === "16_9" && (img.width || 0) >= 640)
      .sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0] ||
    images
      .filter((img: any) => (img.width || 0) >= 640)
      .sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0] ||
    images[0];

  // Thumbnail: prefer smaller image (200-400px wide)
  const thumbImage =
    images
      .filter((img: any) => (img.width || 0) >= 200 && (img.width || 0) <= 400)
      .sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0] ||
    fullImage;

  return {
    kind: "event",
    title: raw.name,
    description,
    hook_line: null, // Let LLM generate this

    category,
    sub_category,

    ...venue,

    ...dateTime,
    schedule_text: null,
    recurrence: null, // Single events, no recurrence
    season: null,

    price_bucket: mapPriceBucket(raw.priceRanges),
    effort: "low", // Attending events is generally low effort

    xp_value: calculateXp(raw),
    priority: isAnchorEvent(raw) ? 80 : 50,
    is_anchor: isAnchorEvent(raw),
    is_hidden_gem: false, // API events aren't hidden gems

    source_url: raw.url || null,
    external_id: raw.id,

    image_url: fullImage?.url || null,
    image_thumb_url: thumbImage?.url || fullImage?.url || null,
    image_source: fullImage?.url ? "ticketmaster" : null,
  };
}

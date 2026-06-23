/**
 * Google Places API (New) — Nearby Search + Text Search Ingestion
 *
 * Fetches local activities from Google Places API and stores raw data
 * in event_ingest_raw.
 *
 * Strategy:
 * - Phase 1: Nearby Search — one request per includedType (max 20 results each)
 * - Phase 2: Text Search — one request per keyword + up to 2 pagination pages
 * - Multi-region: supports multiple search centers with rotation
 * - Deduplication via place ID (same place may appear in multiple searches)
 * - SHA256 hash for change detection (stable sorted-key serialization)
 * - Budget guardrail: respects api_usage_counters monthly limit
 *
 * Required secrets:
 * - GOOGLE_PLACES_API_KEY: Google Cloud API key with Places API (New) enabled
 *
 * API Reference:
 * https://developers.google.com/maps/documentation/places/web-service/nearby-search
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logPipelineHealth } from "../_shared/health-log.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

const NEARBY_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.types",
  "places.formattedAddress",
  "places.location",
  "places.priceLevel",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.websiteUri",
  "places.editorialSummary",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.googleMapsUri",
  // `places.photos` was omitted; without it, place_details_cache never sees
  // photo references and cache-place-photos has nothing to fetch. Adding it
  // restores the venue image pipeline for Warwick (and every region).
  "places.photos",
].join(",");

// ============================================================================
// Config
// ============================================================================

interface Region {
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
}

interface IngestConfig {
  // Legacy single-center (still supported)
  lat?: number;
  lng?: number;
  radius_meters?: number;

  // Multi-center
  regions?: Region[];

  // Coverage
  included_types?: string[];
  keywords?: string[];
  max_pages_per_keyword?: number; // Text Search pagination (1-3)

  // Limits
  max_results_per_type?: number;
  max_total_requests?: number; // Hard ceiling per run
  delay_between_requests_ms?: number;

  dry_run?: boolean;
}

interface IngestResult {
  external_id: string;
  name: string;
  search_label: string; // "type:restaurant" or "keyword:hiking trail"
  region?: string;
  status: "inserted" | "updated" | "unchanged" | "error";
  error?: string;
}

// Expanded types list for comprehensive coverage
const DEFAULT_TYPES = [
  // Food & Drink
  "restaurant", "cafe", "bar", "bakery", "meal_takeaway",
  // Fitness & Wellness
  "gym", "spa",
  // Outdoor & Nature
  "park", "campground",
  // Arts & Culture
  "museum", "library", "art_gallery",
  // Entertainment
  "movie_theater", "bowling_alley",
  // Nightlife
  "night_club",
  // Shopping & Community
  "shopping_mall", "book_store",
  // Attractions
  "tourist_attraction",
  // Additional coverage
  "stadium",
  "performing_arts_theater",
  "amusement_park",
  "aquarium",
  "yoga_studio",
  "swimming_pool",
  "ice_skating_rink",
  "ski_resort",
  "golf_course",
  "marina",
  "historical_landmark",
  "visitor_center",
  "community_center",
];

// Text Search keywords for discovery gaps
// Includes food/drink/nightlife keywords to maximize coverage without Yelp
const DEFAULT_KEYWORDS = [
  // Outdoor & Adventure
  "hiking trail",
  "trailhead",
  "scenic overlook",
  "swimming hole",
  "canoe kayak launch",
  // Food & Drink (niche types Google Nearby Search misses)
  "brewery",
  "winery",
  "wine bar",
  "cocktail bar",
  "sports bar",
  "food truck",
  "ice cream shop",
  "brunch",
  "farm stand",
  "farmers market",
  // Nightlife & Entertainment
  "live music venue",
  "comedy club",
  "karaoke",
  // Recreation
  "disc golf",
  "mini golf",
  "escape room",
  "axe throwing",
  "rock climbing gym",
  "dance studio",
  "martial arts",
  // Wellness & Beauty
  "nail salon",
  "hair salon",
  "pilates studio",
  // Shopping
  "thrift store",
  "antique shop",
];

// Title patterns to skip — businesses not appropriate for a discovery app
const SKIP_TITLE_PATTERNS = [
  /funeral/i, /mortuary/i, /cremation/i, /cemetery/i,
  /self.storage/i, /storage.unit/i,
  /tractor.supply/i, /dollar.(tree|general)/i,
  /auto.parts/i, /tire.center/i,
  /bail.bond/i, /pawn.shop/i,
  /urgent.care/i, /medical.center/i, /\bhospital\b/i,
  /dentist/i, /orthodont/i,
  /insurance/i, /law.office/i, /attorney/i,
  /tax.prep/i, /accounting/i,
  /\bbank\b/i, /credit.union/i,
  // Hotels & lodging
  /\bhotel\b/i, /\bmotel\b/i, /\binn\b/i, /\bhostel\b/i,
  /\bresort\b/i, /suites?\b/i, /lodge\b/i,
  // Automotive
  /car.wash/i, /car.repair/i, /auto.body/i, /car.dealer/i, /tire.shop/i,
  /oil.change/i, /\bmuffler/i, /transmission/i,
  // Gas stations & convenience
  /gas.station/i, /\bshell\b/i, /\bsunoco\b/i, /\bmobil\b/i,
  /\bcumberland.farms/i, /\bstewarts?\b.*shop/i,
  // Personal services
  /hair.salon/i, /\bbarber/i, /beauty.salon/i, /nail.salon/i,
  /dry.clean/i, /laundromat/i, /laundry/i,
  // Professional & medical
  /pharmacy/i, /veterinar/i, /chiropract/i, /optometrist/i,
  /real.estate/i, /\brealty\b/i,
  // Misc non-discovery
  /post.office/i, /\bups\b.store/i, /fedex/i,
  /hardware.store/i, /lumber/i,
  /school\b/i, /preschool/i, /daycare/i,
];

// Google Places types to skip — if primaryType matches, skip the place entirely
const SKIP_PRIMARY_TYPES = new Set([
  "lodging", "hotel", "motel", "extended_stay_hotel",
  "gas_station", "electric_vehicle_charging_station",
  "car_wash", "car_repair", "car_dealer",
  "hair_salon", "beauty_salon",
  "laundry", "dry_cleaner",
  "real_estate_agency",
  "pharmacy", "drugstore",
  "veterinary_care",
  "post_office",
  "school", "preschool", "primary_school", "secondary_school",
  "convenience_store",
  "hardware_store",
]);

function shouldSkipPlace(title: string, primaryType?: string): boolean {
  if (SKIP_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return true;
  if (primaryType && SKIP_PRIMARY_TYPES.has(primaryType)) return true;
  return false;
}

const DEFAULT_REGIONS: Region[] = [
  { name: "potsdam", lat: 44.6697, lng: -74.9814, radius_m: 25000 },
  { name: "canton", lat: 44.5956, lng: -75.1690, radius_m: 25000 },
];

// ============================================================================
// Hashing
// ============================================================================

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((v) => stableStringify(v)).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      JSON.stringify(k) +
      ":" +
      stableStringify((obj as Record<string, unknown>)[k]),
  );
  return "{" + parts.join(",") + "}";
}

async function hashJson(obj: unknown): Promise<string> {
  const data = new TextEncoder().encode(stableStringify(obj));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// API Callers
// ============================================================================

async function fetchPlacesByType(
  apiKey: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  placeType: string,
): Promise<{ places: any[]; error?: string }> {
  const body = {
    includedTypes: [placeType],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMeters,
      },
    },
  };

  const response = await fetch(NEARBY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      places: [],
      error: `HTTP ${response.status}: ${errorText.substring(0, 500)}`,
    };
  }

  const data = await response.json();
  return { places: data.places || [] };
}

/**
 * Text Search with optional pagination. Returns up to maxPages * 20 results.
 * Each page costs 1 API request.
 */
async function fetchPlacesByTextSearch(
  apiKey: string,
  keyword: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  maxPages: number,
): Promise<{ places: any[]; pages_used: number; error?: string }> {
  const allPlaces: any[] = [];
  let pageToken: string | undefined;
  let pagesUsed = 0;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = {
      textQuery: keyword,
      pageSize: 20,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
    };

    if (pageToken) {
      body.pageToken = pageToken;
    }

    const response = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    pagesUsed++;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        places: allPlaces,
        pages_used: pagesUsed,
        error: `HTTP ${response.status}: ${errorText.substring(0, 500)}`,
      };
    }

    const data = await response.json();
    const places = data.places || [];
    allPlaces.push(...places);

    // Check for more pages
    if (!data.nextPageToken || places.length === 0) {
      break;
    }
    pageToken = data.nextPageToken;

    // Small delay before next page
    await new Promise((r) => setTimeout(r, 200));
  }

  return { places: allPlaces, pages_used: pagesUsed };
}

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  const corsHeaders = getCorsHeaders(req);

  const auth = requireServiceRole(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.error === "Forbidden" ? 403 : 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();

  try {
    // Parse config from request body
    let config: IngestConfig = {};
    if (req.method === "POST") {
      try {
        config = await req.json();
      } catch {
        // Empty body OK — use defaults
      }
    }

    // Resolve regions: prefer explicit regions, fall back to single lat/lng
    const regions: Region[] =
      config.regions ||
      (config.lat && config.lng
        ? [
            {
              name: "custom",
              lat: config.lat,
              lng: config.lng,
              radius_m: config.radius_meters || 25000,
            },
          ]
        : DEFAULT_REGIONS);

    const includedTypes = config.included_types || DEFAULT_TYPES;
    const keywords = config.keywords || DEFAULT_KEYWORDS;
    const maxPagesPerKeyword = Math.min(config.max_pages_per_keyword || 2, 3);
    const maxTotalRequests = config.max_total_requests || 200;
    const delayMs = config.delay_between_requests_ms ?? 200;
    const dryRun = config.dry_run || false;

    // Get API key
    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "GOOGLE_PLACES_API_KEY not configured",
          message:
            "Add GOOGLE_PLACES_API_KEY to Supabase secrets. " +
            "See docs/google_places_setup.md for instructions.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Budget check ──
    const { data: budgetRows } = await supabase.rpc("get_api_budget", {
      p_service: "google_places",
    });
    const budget = budgetRows?.[0];
    if (budget && budget.requests_remaining <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          status: "budget_exceeded",
          requests_used: budget.requests_used,
          requests_limit: budget.requests_limit,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Estimate planned requests
    const plannedNearby = regions.length * includedTypes.length;
    const plannedText = regions.length * keywords.length;
    const estimatedRequests = plannedNearby + plannedText;
    const effectiveMax = budget
      ? Math.min(maxTotalRequests, budget.requests_remaining)
      : maxTotalRequests;

    console.log(
      `Plan: ${regions.length} regions x (${includedTypes.length} types + ${keywords.length} keywords)`,
    );
    console.log(
      `Estimated requests: ${estimatedRequests}, max allowed: ${effectiveMax}`,
    );

    // Get or create Google Places source
    let sourceId: string;
    const { data: existingSource } = await supabase
      .from("event_sources")
      .select("id")
      .eq("type", "api_google_places")
      .single();

    if (existingSource) {
      sourceId = existingSource.id;
    } else {
      const { data: newSource, error: createError } = await supabase
        .from("event_sources")
        .insert({
          name: "Google Places",
          type: "api_google_places",
          is_enabled: true,
          config_json: { regions },
        })
        .select("id")
        .single();

      if (createError || !newSource) {
        throw new Error(`Failed to create source: ${createError?.message}`);
      }
      sourceId = newSource.id;
    }

    // Batch-load existing hashes
    const existingHashes = new Map<string, string>();
    {
      const { data: rows } = await supabase
        .from("event_ingest_raw")
        .select("external_id, raw_hash")
        .eq("source_id", sourceId);
      for (const row of rows || []) {
        existingHashes.set(row.external_id, row.raw_hash);
      }
      console.log(
        `Loaded ${existingHashes.size} existing hashes for change detection`,
      );
    }

    const results: IngestResult[] = [];
    const seenPlaceIds = new Set<string>();
    let totalFetched = 0;
    let totalApiCalls = 0;
    let consecutiveErrors = 0;
    let budgetExceeded = false;
    const MAX_CONSECUTIVE_ERRORS = 3;

    // ── Helper: process a batch of places ──
    async function processPlaces(
      places: any[],
      searchLabel: string,
      regionName?: string,
    ) {
      for (const place of places) {
        const externalId = place.id;
        if (!externalId) continue;
        if (seenPlaceIds.has(externalId)) continue;
        seenPlaceIds.add(externalId);

        const placeName =
          place.displayName?.text ||
          place.primaryTypeDisplayName?.text ||
          "Unknown";

        // Skip inappropriate businesses (by title or Google primary type)
        if (shouldSkipPlace(placeName, place.primaryType)) {
          results.push({
            external_id: externalId,
            name: placeName,
            search_label: searchLabel,
            region: regionName,
            status: "skipped" as any,
          });
          continue;
        }

        if (dryRun) {
          results.push({
            external_id: externalId,
            name: placeName,
            search_label: searchLabel,
            region: regionName,
            status: "unchanged",
          });
          continue;
        }

        try {
          const rawHash = await hashJson(place);
          const existingHash = existingHashes.get(externalId);

          if (existingHash === rawHash) {
            results.push({
              external_id: externalId,
              name: placeName,
              search_label: searchLabel,
              region: regionName,
              status: "unchanged",
            });
            continue;
          }

          const { error: upsertError } = await supabase
            .from("event_ingest_raw")
            .upsert(
              {
                source_id: sourceId,
                external_id: externalId,
                fetched_at: new Date().toISOString(),
                raw_json: place,
                raw_hash: rawHash,
                status: "new",
              },
              { onConflict: "source_id,external_id" },
            );

          if (upsertError) throw upsertError;

          existingHashes.set(externalId, rawHash);
          results.push({
            external_id: externalId,
            name: placeName,
            search_label: searchLabel,
            region: regionName,
            status: existingHash !== undefined ? "updated" : "inserted",
          });
        } catch (error) {
          results.push({
            external_id: externalId,
            name: placeName,
            search_label: searchLabel,
            region: regionName,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    // Helper: check if we can still make API calls
    function canContinue(): boolean {
      if (budgetExceeded) return false;
      if (totalApiCalls >= effectiveMax) {
        budgetExceeded = true;
        console.log(
          `Request ceiling reached (${totalApiCalls}/${effectiveMax})`,
        );
        return false;
      }
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(
          `Circuit breaker: ${consecutiveErrors} consecutive errors`,
        );
        return false;
      }
      return true;
    }

    // Helper: handle API errors
    function handleApiError(error: string): boolean {
      consecutiveErrors++;
      if (
        error.includes("403") ||
        error.includes("401") ||
        error.includes("429")
      ) {
        console.error(`Fatal API error: ${error.substring(0, 80)}`);
        if (error.includes("429")) budgetExceeded = true;
        return false; // stop
      }
      return true; // continue
    }

    // ════════════════════════════════════════════════════════════════════
    // Phase 1: Nearby Search — per type per region
    // ════════════════════════════════════════════════════════════════════

    console.log(
      `\n-- Phase 1: Nearby Search (${includedTypes.length} types x ${regions.length} regions) --`,
    );

    for (const region of regions) {
      if (!canContinue()) break;

      for (const placeType of includedTypes) {
        if (!canContinue()) break;

        totalApiCalls++;
        const { places, error: fetchError } = await fetchPlacesByType(
          apiKey,
          region.lat,
          region.lng,
          region.radius_m,
          placeType,
        );

        if (fetchError) {
          console.error(`  [${region.name}] ${placeType}: ${fetchError}`);
          if (!handleApiError(fetchError)) break;
          continue;
        }

        consecutiveErrors = 0;
        console.log(
          `  [${region.name}] ${placeType}: ${places.length} results`,
        );
        totalFetched += places.length;

        await processPlaces(places, `type:${placeType}`, region.name);

        // Increment budget
        await supabase.rpc("increment_api_usage", {
          p_service: "google_places",
          p_count: 1,
        });

        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // Phase 2: Text Search — per keyword per region (with pagination)
    // ════════════════════════════════════════════════════════════════════

    if (keywords.length > 0 && canContinue()) {
      console.log(
        `\n-- Phase 2: Text Search (${keywords.length} keywords x ${regions.length} regions) --`,
      );

      for (const region of regions) {
        if (!canContinue()) break;

        for (const keyword of keywords) {
          if (!canContinue()) break;

          const pagesAllowed = Math.min(
            maxPagesPerKeyword,
            effectiveMax - totalApiCalls,
          );
          if (pagesAllowed <= 0) {
            budgetExceeded = true;
            break;
          }

          const {
            places,
            pages_used,
            error: searchError,
          } = await fetchPlacesByTextSearch(
            apiKey,
            keyword,
            region.lat,
            region.lng,
            region.radius_m,
            pagesAllowed,
          );

          totalApiCalls += pages_used;

          if (searchError) {
            console.error(
              `  [${region.name}] "${keyword}": ${searchError}`,
            );
            if (!handleApiError(searchError)) break;
            continue;
          }

          consecutiveErrors = 0;
          console.log(
            `  [${region.name}] "${keyword}": ${places.length} results (${pages_used} pages)`,
          );
          totalFetched += places.length;

          await processPlaces(places, `keyword:${keyword}`, region.name);

          // Increment budget for all pages used
          await supabase.rpc("increment_api_usage", {
            p_service: "google_places",
            p_count: pages_used,
          });

          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }
    }

    // ── Update last_fetch_at ──
    if (!dryRun) {
      await supabase
        .from("event_sources")
        .update({ last_fetch_at: new Date().toISOString() })
        .eq("id", sourceId);
    }

    const durationMs = Date.now() - startTime;

    // Summary
    const inserted = results.filter((r) => r.status === "inserted").length;
    const updated = results.filter((r) => r.status === "updated").length;
    const unchanged = results.filter((r) => r.status === "unchanged").length;
    const errors = results.filter((r) => r.status === "error").length;
    const uniquePlaces = seenPlaceIds.size;

    // Get final budget status
    const { data: finalBudget } = await supabase.rpc("get_api_budget", {
      p_service: "google_places",
    });
    const budgetStatus = finalBudget?.[0];

    console.log(
      `\nIngestion complete: ${inserted} new, ${updated} updated, ` +
        `${unchanged} unchanged, ${errors} errors`,
    );
    console.log(
      `${totalApiCalls} API calls, ${totalFetched} total results, ` +
        `${uniquePlaces} unique places (${durationMs}ms)`,
    );
    if (budgetStatus) {
      console.log(
        `Budget: ${budgetStatus.requests_used}/${budgetStatus.requests_limit} ` +
          `(${budgetStatus.requests_remaining} remaining)`,
      );
    }

    // Log health
    await logPipelineHealth(supabase, {
      stage: "ingest",
      source_name: "Google Places",
      status: budgetExceeded ? "warn" : errors > 0 ? "warn" : "ok",
      items_processed: inserted + updated,
      items_failed: errors,
      duration_ms: durationMs,
      details_json: {
        api_calls: totalApiCalls,
        total_results: totalFetched,
        unique_places: uniquePlaces,
        inserted,
        updated,
        unchanged,
        errors,
        budget_exceeded: budgetExceeded,
        budget: budgetStatus || null,
        regions: regions.map((r) => r.name),
        circuit_breaker_tripped: consecutiveErrors >= MAX_CONSECUTIVE_ERRORS,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total_fetched: totalFetched,
          unique_places: uniquePlaces,
          api_calls: totalApiCalls,
          inserted,
          updated,
          unchanged,
          errors,
          duration_ms: durationMs,
          budget_exceeded: budgetExceeded,
        },
        budget: budgetStatus || null,
        config: {
          regions,
          included_types: includedTypes.length,
          keywords: keywords.length,
          max_total_requests: maxTotalRequests,
          dry_run: dryRun,
        },
        results: results.slice(0, 300),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error("Google Places ingestion error:", error);

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await logPipelineHealth(supabase, {
        stage: "ingest",
        source_name: "Google Places",
        status: "error",
        items_processed: 0,
        items_failed: 1,
        duration_ms: durationMs,
        details_json: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    } catch {
      // Health logging failure is non-fatal
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

/**
 * Google Places API (New) — Nearby Search Ingestion
 *
 * Fetches local activities (restaurants, cafes, parks, gyms, museums, etc.)
 * from Google Places API and stores raw data in event_ingest_raw.
 *
 * Strategy:
 * - One Nearby Search request per includedType for comprehensive coverage
 * - Max 20 results per type (API limit, no pagination)
 * - Deduplication via place ID (same place may appear in multiple type searches)
 * - SHA256 hash for change detection
 *
 * Required secrets:
 * - GOOGLE_PLACES_API_KEY: Google Cloud API key with Places API (New) enabled
 *
 * API Reference:
 * https://developers.google.com/maps/documentation/places/web-service/nearby-search
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logPipelineHealth } from "../_shared/health-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLACES_API_URL =
  "https://places.googleapis.com/v1/places:searchNearby";

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
].join(",");

interface IngestConfig {
  lat?: number;
  lng?: number;
  radius_meters?: number;
  included_types?: string[];
  max_results_per_type?: number;
  delay_between_requests_ms?: number;
  dry_run?: boolean;
}

interface IngestResult {
  external_id: string;
  name: string;
  type_searched: string;
  status: "inserted" | "updated" | "unchanged" | "error";
  error?: string;
}

// Default: Potsdam, NY area — evergreen activity types
const DEFAULT_CONFIG: Required<IngestConfig> = {
  lat: 44.6697,
  lng: -74.9814,
  radius_meters: 50000, // 50km (~31 miles)
  included_types: [
    "restaurant", "cafe", "bar", "bakery",
    "gym", "spa",
    "park", "campground",
    "museum", "library", "art_gallery",
    "movie_theater", "bowling_alley",
    "night_club",
    "shopping_mall", "book_store",
    "tourist_attraction",
  ],
  max_results_per_type: 20,
  delay_between_requests_ms: 200, // Be polite to the API
  dry_run: false,
};

/**
 * Compute SHA256 hash of JSON for change detection
 */
async function hashJson(obj: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetch places for a single type from Google Places API (New)
 */
async function fetchPlacesByType(
  apiKey: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  placeType: string,
  maxResults: number,
): Promise<{ places: any[]; error?: string }> {
  const body = {
    includedTypes: [placeType],
    maxResultCount: Math.min(maxResults, 20), // API max is 20
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMeters,
      },
    },
  };

  const response = await fetch(PLACES_API_URL, {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    const cfg = { ...DEFAULT_CONFIG, ...config };

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
          config_json: {
            default_lat: cfg.lat,
            default_lng: cfg.lng,
            default_radius_meters: cfg.radius_meters,
          },
        })
        .select("id")
        .single();

      if (createError || !newSource) {
        throw new Error(`Failed to create source: ${createError?.message}`);
      }
      sourceId = newSource.id;
    }

    console.log(
      `Ingesting Google Places: lat=${cfg.lat}, lng=${cfg.lng}, ` +
      `radius=${cfg.radius_meters}m, types=${cfg.included_types.length}`,
    );
    console.log(`Types: ${cfg.included_types.join(", ")}`);
    console.log(`dry_run=${cfg.dry_run}`);

    const results: IngestResult[] = [];
    const seenPlaceIds = new Set<string>();
    let totalFetched = 0;
    let totalApiCalls = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3; // Circuit breaker

    // Iterate over each included type
    for (const placeType of cfg.included_types) {
      // Circuit breaker: stop if too many consecutive API errors
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(
          `Circuit breaker: ${consecutiveErrors} consecutive API errors. ` +
          `Stopping ingestion.`,
        );
        break;
      }

      console.log(`\nFetching type: ${placeType}...`);
      totalApiCalls++;

      const { places, error: fetchError } = await fetchPlacesByType(
        apiKey,
        cfg.lat,
        cfg.lng,
        cfg.radius_meters,
        placeType,
        cfg.max_results_per_type,
      );

      if (fetchError) {
        console.error(`  Error fetching ${placeType}: ${fetchError}`);
        consecutiveErrors++;

        // Check for fatal errors (auth failures, quota exceeded)
        if (
          fetchError.includes("403") ||
          fetchError.includes("401") ||
          fetchError.includes("429")
        ) {
          console.error(
            `  Fatal API error (${fetchError.substring(0, 50)}). Stopping.`,
          );
          break;
        }

        continue;
      }

      // Reset circuit breaker on success
      consecutiveErrors = 0;

      console.log(`  Found ${places.length} places for ${placeType}`);
      totalFetched += places.length;

      // Process each place
      for (const place of places) {
        const externalId = place.id;
        if (!externalId) {
          console.warn("  Skipping place with no ID");
          continue;
        }

        // Skip if we've already processed this place in a previous type
        if (seenPlaceIds.has(externalId)) {
          continue;
        }
        seenPlaceIds.add(externalId);

        const placeName =
          place.displayName?.text || place.primaryTypeDisplayName?.text || "Unknown";

        if (cfg.dry_run) {
          results.push({
            external_id: externalId,
            name: placeName,
            type_searched: placeType,
            status: "unchanged",
          });
          continue;
        }

        try {
          const rawHash = await hashJson(place);

          // Check if this exact version already exists
          const { data: existing } = await supabase
            .from("event_ingest_raw")
            .select("id, raw_hash")
            .eq("source_id", sourceId)
            .eq("external_id", externalId)
            .single();

          if (existing && existing.raw_hash === rawHash) {
            results.push({
              external_id: externalId,
              name: placeName,
              type_searched: placeType,
              status: "unchanged",
            });
            continue;
          }

          // Upsert raw data
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
              {
                onConflict: "source_id,external_id",
              },
            );

          if (upsertError) {
            throw upsertError;
          }

          results.push({
            external_id: externalId,
            name: placeName,
            type_searched: placeType,
            status: existing ? "updated" : "inserted",
          });
        } catch (error) {
          results.push({
            external_id: externalId,
            name: placeName,
            type_searched: placeType,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Delay between API requests
      if (cfg.delay_between_requests_ms > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, cfg.delay_between_requests_ms)
        );
      }
    }

    // Update last_fetch_at on source
    if (!cfg.dry_run) {
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

    console.log(
      `\nIngestion complete: ${inserted} new, ${updated} updated, ` +
      `${unchanged} unchanged, ${errors} errors`,
    );
    console.log(
      `${totalApiCalls} API calls, ${totalFetched} total results, ` +
      `${uniquePlaces} unique places (${durationMs}ms)`,
    );

    // Log health
    await logPipelineHealth(supabase, {
      stage: "ingest",
      source_name: "Google Places",
      status: errors > 0 ? "warn" : "ok",
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
        },
        config: {
          lat: cfg.lat,
          lng: cfg.lng,
          radius_meters: cfg.radius_meters,
          included_types: cfg.included_types,
          dry_run: cfg.dry_run,
        },
        results: results.slice(0, 200), // Limit response size
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error("Google Places ingestion error:", error);

    // Try to log the error to health pipeline
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

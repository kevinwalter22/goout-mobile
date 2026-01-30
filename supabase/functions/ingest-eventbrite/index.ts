/**
 * Eventbrite API v3 Ingestion
 *
 * Fetches events from Eventbrite near a given location and stores raw data.
 * Designed for scheduled execution (daily or every 6 hours).
 *
 * Features:
 * - Configurable lat/lng, radius, and date window
 * - Idempotent — uses external_id for deduplication
 * - Stores raw JSON for debugging
 * - Auto-enqueues normalization jobs via database trigger
 *
 * Required secrets:
 * - EVENTBRITE_API_KEY: Private OAuth token from Eventbrite
 *
 * API Reference: https://www.eventbrite.com/platform/api
 *
 * Eventbrite search endpoint:
 *   GET /v3/events/search/?location.latitude=X&location.longitude=Y&location.within=Xmi
 *   Returns paginated list of public events with pagination object.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "https://deno.land/std@0.177.0/hash/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EVENTBRITE_BASE_URL = "https://www.eventbriteapi.com/v3";

interface IngestConfig {
  lat?: number;
  lng?: number;
  radius?: number; // miles
  days_ahead?: number;
  page_size?: number;
  max_pages?: number;
  dry_run?: boolean;
}

interface IngestResult {
  external_id: string;
  name: string;
  status: "inserted" | "updated" | "unchanged" | "error";
  error?: string;
}

// Default location: Potsdam, NY area
const DEFAULT_CONFIG: Required<IngestConfig> = {
  lat: 44.6697,
  lng: -74.9814,
  radius: 50,
  days_ahead: 90,
  page_size: 50,
  max_pages: 5,
  dry_run: false,
};

/**
 * Compute SHA256 hash of JSON for change detection
 */
function hashJson(obj: unknown): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(obj));
  return hash.toString();
}

/**
 * Format date for Eventbrite API (ISO 8601 without ms)
 */
function formatDateForApi(date: Date): string {
  return date.toISOString().split(".")[0] + "Z";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse config
    let config: IngestConfig = {};
    if (req.method === "POST") {
      try {
        config = await req.json();
      } catch {
        // Empty body OK
      }
    }

    const cfg = { ...DEFAULT_CONFIG, ...config };

    // Get API key
    const apiKey = Deno.env.get("EVENTBRITE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "EVENTBRITE_API_KEY not configured",
          message: "Add EVENTBRITE_API_KEY (private OAuth token) to your Supabase secrets",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get or create Eventbrite source (idempotent)
    let sourceId: string;
    const { data: existingSource } = await supabase
      .from("event_sources")
      .select("id")
      .eq("name", "Eventbrite")
      .single();

    if (existingSource) {
      sourceId = existingSource.id;
    } else {
      const { data: newSource, error: createError } = await supabase
        .from("event_sources")
        .insert({
          name: "Eventbrite",
          type: "api_eventbrite",
          is_enabled: true,
          config_json: {
            default_lat: cfg.lat,
            default_lng: cfg.lng,
            default_radius: cfg.radius,
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
      `Ingesting Eventbrite events: lat=${cfg.lat}, lng=${cfg.lng}, radius=${cfg.radius}mi`
    );
    console.log(`Looking ahead ${cfg.days_ahead} days, dry_run=${cfg.dry_run}`);

    // Build date range
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + cfg.days_ahead);

    const results: IngestResult[] = [];
    let totalFetched = 0;
    let page = 1; // Eventbrite pages are 1-indexed

    // Fetch pages of events
    while (page <= cfg.max_pages) {
      const params = new URLSearchParams({
        "location.latitude": cfg.lat.toString(),
        "location.longitude": cfg.lng.toString(),
        "location.within": `${cfg.radius}mi`,
        "start_date.range_start": formatDateForApi(startDate),
        "start_date.range_end": formatDateForApi(endDate),
        "page": page.toString(),
        "page_size": cfg.page_size.toString(),
        "expand": "venue,ticket_classes,category,subcategory",
        "status": "live",
      });

      console.log(`Fetching page ${page}...`);

      const response = await fetch(
        `${EVENTBRITE_BASE_URL}/events/search/?${params}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        // 401 = bad token, 429 = rate limited
        if (response.status === 429) {
          console.warn("Eventbrite rate limit hit, stopping pagination");
          break;
        }
        throw new Error(
          `Eventbrite API error: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();

      // Check if we have events
      const events = data.events || [];
      if (events.length === 0) {
        console.log(`No more events on page ${page}`);
        break;
      }

      totalFetched += events.length;
      console.log(`Processing ${events.length} events from page ${page}...`);

      // Process each event
      for (const event of events) {
        const externalId = event.id?.toString();
        if (!externalId) continue;

        const rawHash = hashJson(event);

        if (cfg.dry_run) {
          results.push({
            external_id: externalId,
            name: event.name?.text || "Untitled",
            status: "unchanged",
          });
          continue;
        }

        try {
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
              name: event.name?.text || "Untitled",
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
                raw_json: event,
                raw_hash: rawHash,
                status: "new",
              },
              {
                onConflict: "source_id,external_id",
              }
            );

          if (upsertError) {
            throw upsertError;
          }

          results.push({
            external_id: externalId,
            name: event.name?.text || "Untitled",
            status: existing ? "updated" : "inserted",
          });
        } catch (error) {
          results.push({
            external_id: externalId,
            name: event.name?.text || "Untitled",
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Check pagination
      const pagination = data.pagination;
      if (!pagination || !pagination.has_more_items) {
        console.log(`No more pages (total pages: ${pagination?.page_count || page})`);
        break;
      }

      page++;

      // Rate limit: be conservative (Eventbrite has stricter limits than TM)
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Update last_fetch_at on source
    if (!cfg.dry_run) {
      await supabase
        .from("event_sources")
        .update({ last_fetch_at: new Date().toISOString() })
        .eq("id", sourceId);
    }

    // Summary
    const inserted = results.filter((r) => r.status === "inserted").length;
    const updated = results.filter((r) => r.status === "updated").length;
    const unchanged = results.filter((r) => r.status === "unchanged").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(
      `\nIngestion complete: ${inserted} new, ${updated} updated, ${unchanged} unchanged, ${errors} errors`
    );

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total_fetched: totalFetched,
          pages_processed: page,
          inserted,
          updated,
          unchanged,
          errors,
        },
        config: {
          lat: cfg.lat,
          lng: cfg.lng,
          radius: cfg.radius,
          days_ahead: cfg.days_ahead,
          dry_run: cfg.dry_run,
        },
        results: results.slice(0, 100), // Limit response size
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Ingestion error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

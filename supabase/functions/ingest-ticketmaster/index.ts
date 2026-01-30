/**
 * Ticketmaster Discovery API Ingestion
 *
 * Fetches events from Ticketmaster near a given location and stores raw data.
 * Designed for scheduled execution (daily or every 6 hours).
 *
 * Features:
 * - Configurable lat/lng, radius, and date window
 * - Idempotent - uses external_id for deduplication
 * - Stores raw JSON for debugging
 * - Auto-enqueues normalization jobs via database trigger
 *
 * Required secrets:
 * - TICKETMASTER_API_KEY: Your Ticketmaster Discovery API key
 *
 * API Reference: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TICKETMASTER_BASE_URL =
  "https://app.ticketmaster.com/discovery/v2/events.json";

interface IngestConfig {
  lat?: number;
  lng?: number;
  radius?: number; // miles
  radius_unit?: "miles" | "km";
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
  radius_unit: "miles",
  days_ahead: 90,
  page_size: 50,
  max_pages: 5,
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
 * Format date for Ticketmaster API (ISO 8601 with Z)
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
    const apiKey = Deno.env.get("TICKETMASTER_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "TICKETMASTER_API_KEY not configured",
          message: "Add TICKETMASTER_API_KEY to your Supabase secrets",
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

    // Get or create Ticketmaster source
    let sourceId: string;
    const { data: existingSource } = await supabase
      .from("event_sources")
      .select("id")
      .eq("name", "Ticketmaster")
      .single();

    if (existingSource) {
      sourceId = existingSource.id;
    } else {
      const { data: newSource, error: createError } = await supabase
        .from("event_sources")
        .insert({
          name: "Ticketmaster",
          type: "api_ticketmaster",
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
      `Ingesting Ticketmaster events: lat=${cfg.lat}, lng=${cfg.lng}, radius=${cfg.radius}${cfg.radius_unit}`
    );
    console.log(`Looking ahead ${cfg.days_ahead} days, dry_run=${cfg.dry_run}`);

    // Build date range
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + cfg.days_ahead);

    const results: IngestResult[] = [];
    let totalFetched = 0;
    let page = 0;

    // Fetch pages of events
    while (page < cfg.max_pages) {
      const params = new URLSearchParams({
        apikey: apiKey,
        latlong: `${cfg.lat},${cfg.lng}`,
        radius: cfg.radius.toString(),
        unit: cfg.radius_unit,
        startDateTime: formatDateForApi(startDate),
        endDateTime: formatDateForApi(endDate),
        size: cfg.page_size.toString(),
        page: page.toString(),
        sort: "date,asc",
      });

      console.log(`Fetching page ${page + 1}...`);

      const response = await fetch(`${TICKETMASTER_BASE_URL}?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Ticketmaster API error: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();

      // Check if we have events
      if (!data._embedded?.events || data._embedded.events.length === 0) {
        console.log(`No more events on page ${page + 1}`);
        break;
      }

      const events = data._embedded.events;
      totalFetched += events.length;

      console.log(`Processing ${events.length} events from page ${page + 1}...`);

      // Process each event
      for (const event of events) {
        const externalId = event.id;
        const rawHash = await hashJson(event);

        if (cfg.dry_run) {
          results.push({
            external_id: externalId,
            name: event.name,
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
            // No change
            results.push({
              external_id: externalId,
              name: event.name,
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
            name: event.name,
            status: existing ? "updated" : "inserted",
          });
        } catch (error) {
          results.push({
            external_id: externalId,
            name: event.name,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Check if there are more pages
      const totalPages = data.page?.totalPages || 1;
      if (page + 1 >= totalPages) {
        console.log(`Reached last page (${totalPages} total)`);
        break;
      }

      page++;

      // Rate limit: 5 requests per second for Discovery API
      await new Promise((resolve) => setTimeout(resolve, 250));
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
          pages_processed: page + 1,
          inserted,
          updated,
          unchanged,
          errors,
        },
        config: {
          lat: cfg.lat,
          lng: cfg.lng,
          radius: cfg.radius,
          radius_unit: cfg.radius_unit,
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

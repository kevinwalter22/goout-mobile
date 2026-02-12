/**
 * Ticketmaster Ingestion Script
 *
 * Fetches events from Ticketmaster Discovery API and stores in Supabase.
 * Run with: npx tsx scripts/ingest_ticketmaster.ts
 *
 * Options:
 *   --dry-run    Preview without saving to database
 *   --radius=N   Search radius in miles (default: 50)
 *   --days=N     Days ahead to search (default: 90)
 */

import * as path from "path";
import * as crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ticketmasterApiKey = process.env.TICKETMASTER_API_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!ticketmasterApiKey) {
  console.error("Missing TICKETMASTER_API_KEY in .env.local");
  console.error("Add: TICKETMASTER_API_KEY=your_key_here");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const TICKETMASTER_BASE_URL = "https://app.ticketmaster.com/discovery/v2/events.json";

// Default config - Potsdam, NY area
const DEFAULT_CONFIG = {
  lat: 44.6697,
  lng: -74.9814,
  radius: 50,
  radiusUnit: "miles" as const,
  daysAhead: 90,
  pageSize: 50,
  maxPages: 5,
};

interface IngestResult {
  externalId: string;
  name: string;
  status: "inserted" | "updated" | "unchanged" | "error";
  error?: string;
}

function hashJson(obj: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function formatDateForApi(date: Date): string {
  return date.toISOString().split(".")[0] + "Z";
}

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const radiusArg = args.find(a => a.startsWith("--radius="));
  const daysArg = args.find(a => a.startsWith("--days="));

  const config = {
    ...DEFAULT_CONFIG,
    radius: radiusArg ? parseInt(radiusArg.split("=")[1]) : DEFAULT_CONFIG.radius,
    daysAhead: daysArg ? parseInt(daysArg.split("=")[1]) : DEFAULT_CONFIG.daysAhead,
  };

  console.log("=".repeat(60));
  console.log("Ticketmaster Event Ingestion");
  console.log("=".repeat(60));
  console.log(`Location: ${config.lat}, ${config.lng}`);
  console.log(`Radius: ${config.radius} ${config.radiusUnit}`);
  console.log(`Days ahead: ${config.daysAhead}`);
  console.log(`Dry run: ${dryRun}`);
  console.log("");

  // Get or create Ticketmaster source
  let sourceId: string;

  const { data: existingSource } = await supabase
    .from("event_sources")
    .select("id")
    .eq("name", "Ticketmaster")
    .single();

  if (existingSource) {
    sourceId = existingSource.id;
    console.log(`Using existing source: ${sourceId}`);
  } else {
    console.log("Creating Ticketmaster source...");
    const { data: newSource, error: createError } = await supabase
      .from("event_sources")
      .insert({
        name: "Ticketmaster",
        type: "api_ticketmaster",
        is_enabled: true,
        config_json: {
          default_lat: config.lat,
          default_lng: config.lng,
          default_radius: config.radius,
        },
      })
      .select("id")
      .single();

    if (createError || !newSource) {
      console.error("Failed to create source:", createError?.message);
      process.exit(1);
    }
    sourceId = newSource.id;
    console.log(`Created source: ${sourceId}`);
  }

  // Build date range
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + config.daysAhead);

  const results: IngestResult[] = [];
  let totalFetched = 0;
  let page = 0;

  console.log("\nFetching events from Ticketmaster...\n");

  // Fetch pages of events
  while (page < config.maxPages) {
    const params = new URLSearchParams({
      apikey: ticketmasterApiKey,
      latlong: `${config.lat},${config.lng}`,
      radius: config.radius.toString(),
      unit: config.radiusUnit,
      startDateTime: formatDateForApi(startDate),
      endDateTime: formatDateForApi(endDate),
      size: config.pageSize.toString(),
      page: page.toString(),
      sort: "date,asc",
    });

    console.log(`Fetching page ${page + 1}...`);

    const response = await fetch(`${TICKETMASTER_BASE_URL}?${params}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error: ${response.status} - ${errorText}`);
      break;
    }

    const data = await response.json();

    if (!data._embedded?.events || data._embedded.events.length === 0) {
      console.log(`No more events on page ${page + 1}`);
      break;
    }

    const events = data._embedded.events;
    totalFetched += events.length;

    console.log(`Processing ${events.length} events...`);

    for (const event of events) {
      const externalId = event.id;
      const rawHash = hashJson(event);

      if (dryRun) {
        const venue = event._embedded?.venues?.[0];
        console.log(`  [DRY RUN] ${event.name}`);
        console.log(`            Venue: ${venue?.name || "Unknown"}`);
        console.log(`            Date: ${event.dates?.start?.localDate || "TBD"}`);
        results.push({ externalId, name: event.name, status: "unchanged" });
        continue;
      }

      try {
        // Check if exists and unchanged
        const { data: existing } = await supabase
          .from("event_ingest_raw")
          .select("id, raw_hash")
          .eq("source_id", sourceId)
          .eq("external_id", externalId)
          .single();

        if (existing && existing.raw_hash === rawHash) {
          results.push({ externalId, name: event.name, status: "unchanged" });
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
            { onConflict: "source_id,external_id" }
          );

        if (upsertError) throw upsertError;

        const status = existing ? "updated" : "inserted";
        console.log(`  ✓ ${status}: ${event.name}`);
        results.push({ externalId, name: event.name, status });
      } catch (error) {
        console.log(`  ✗ Error: ${event.name}`);
        results.push({
          externalId,
          name: event.name,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Check for more pages
    const totalPages = data.page?.totalPages || 1;
    if (page + 1 >= totalPages) {
      console.log(`Reached last page (${totalPages} total)`);
      break;
    }

    page++;

    // Rate limit delay
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  // Update last_fetch_at
  if (!dryRun) {
    await supabase
      .from("event_sources")
      .update({ last_fetch_at: new Date().toISOString() })
      .eq("id", sourceId);
  }

  // Summary
  const inserted = results.filter(r => r.status === "inserted").length;
  const updated = results.filter(r => r.status === "updated").length;
  const unchanged = results.filter(r => r.status === "unchanged").length;
  const errors = results.filter(r => r.status === "error").length;

  console.log("\n" + "=".repeat(60));
  console.log("INGESTION REPORT");
  console.log("=".repeat(60));
  console.log(`Total fetched:  ${totalFetched}`);
  console.log(`Pages processed: ${page + 1}`);
  console.log(`Inserted:       ${inserted}`);
  console.log(`Updated:        ${updated}`);
  console.log(`Unchanged:      ${unchanged}`);
  console.log(`Errors:         ${errors}`);
  console.log("=".repeat(60));

  if (inserted > 0 || updated > 0) {
    console.log("\n✓ Events stored in event_ingest_raw table");
    console.log("  Run normalization to convert to explore_items:");
    console.log("  npx tsx scripts/normalize_events.ts");
  }
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

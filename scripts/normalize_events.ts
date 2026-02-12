/**
 * Event Normalization Script
 *
 * Processes raw events from event_ingest_raw and normalizes them to explore_items.
 * Run with: npx tsx scripts/normalize_events.ts
 *
 * Options:
 *   --dry-run     Preview without saving
 *   --max=N       Maximum items to process (default: 100)
 *   --source=NAME Filter by source name
 */

import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ============================================================================
// TICKETMASTER ADAPTER
// ============================================================================

interface NormalizedEvent {
  kind: "event" | "activity";
  title: string;
  description: string | null;
  hook_line: string | null;
  category: string | null;
  sub_category: string | null;
  location_name: string | null;
  address: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
  starts_at: string | null;
  ends_at: string | null;
  schedule_text: string | null;
  time_text: string | null;
  recurrence: string | null;
  season: string | null;
  price_bucket: "free" | "$" | "$$" | "$$$" | "unknown";
  effort: "low" | "medium" | "high" | "unknown";
  xp_value: number;
  priority: number;
  is_anchor: boolean;
  is_hidden_gem: boolean;
  source_url: string | null;
  external_id: string;
}

function mapTicketmasterCategory(classifications: any[]): { category: string | null; sub_category: string | null } {
  if (!classifications || classifications.length === 0) {
    return { category: null, sub_category: null };
  }

  const primary = classifications[0];
  const segmentMap: Record<string, string> = {
    Music: "music",
    Sports: "sports",
    "Arts & Theatre": "arts",
    Film: "entertainment",
    Miscellaneous: "community",
  };

  const segment = primary.segment?.name;
  const genre = primary.genre?.name;

  return {
    category: segment ? segmentMap[segment] || segment.toLowerCase() : null,
    sub_category: genre || null,
  };
}

function mapTicketmasterPrice(priceRanges: any[]): "free" | "$" | "$$" | "$$$" | "unknown" {
  if (!priceRanges || priceRanges.length === 0) return "unknown";

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

function extractTicketmasterVenue(raw: any) {
  const venues = raw._embedded?.venues;
  if (!venues || venues.length === 0) {
    return { location_name: null, address: null, town: null, lat: null, lng: null };
  }

  const venue = venues[0];
  const location = venue.location;
  const city = venue.city?.name;
  const state = venue.state?.stateCode || venue.state?.name;

  return {
    location_name: venue.name || null,
    address: venue.address?.line1 || null,
    town: city && state ? `${city}, ${state}` : city || null,
    lat: location?.latitude ? parseFloat(location.latitude) : null,
    lng: location?.longitude ? parseFloat(location.longitude) : null,
  };
}

function normalizeTicketmasterEvent(raw: any): NormalizedEvent {
  const { category, sub_category } = mapTicketmasterCategory(raw.classifications);
  const venue = extractTicketmasterVenue(raw);

  let starts_at: string | null = null;
  let time_text: string | null = null;
  const dates = raw.dates;

  if (dates?.start?.dateTime) {
    starts_at = dates.start.dateTime;
  } else if (dates?.start?.localDate) {
    starts_at = dates.start.localTime
      ? `${dates.start.localDate}T${dates.start.localTime}`
      : `${dates.start.localDate}T00:00:00`;
    if (!dates.start.localTime) time_text = "Time TBA";
  }

  if (dates?.start?.timeTBA || dates?.start?.noSpecificTime) {
    time_text = "Time TBA";
  }

  const isAnchor =
    raw.name?.toLowerCase().includes("playoff") ||
    raw.name?.toLowerCase().includes("championship") ||
    (raw.attractions?.[0]?.upcomingEvents?._total || 0) > 50;

  return {
    kind: "event",
    title: raw.name,
    description: raw.info || raw.pleaseNote || null,
    hook_line: null,
    category,
    sub_category,
    ...venue,
    starts_at,
    ends_at: dates?.end?.dateTime || null,
    schedule_text: null,
    time_text,
    recurrence: null,
    season: null,
    price_bucket: mapTicketmasterPrice(raw.priceRanges),
    effort: "low",
    xp_value: 50,
    priority: isAnchor ? 80 : 50,
    is_anchor: isAnchor,
    is_hidden_gem: false,
    source_url: raw.url || null,
    external_id: raw.id,
  };
}

// Adapter registry
const ADAPTERS: Record<string, (raw: any) => NormalizedEvent> = {
  api_ticketmaster: normalizeTicketmasterEvent,
};

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const maxArg = args.find(a => a.startsWith("--max="));
  const sourceArg = args.find(a => a.startsWith("--source="));

  const maxItems = maxArg ? parseInt(maxArg.split("=")[1]) : 100;
  const filterSource = sourceArg ? sourceArg.split("=")[1] : null;

  console.log("=".repeat(60));
  console.log("Event Normalization");
  console.log("=".repeat(60));
  console.log(`Max items: ${maxItems}`);
  console.log(`Source filter: ${filterSource || "all"}`);
  console.log(`Dry run: ${dryRun}`);
  console.log("");

  // Fetch raw items that need normalization
  let query = supabase
    .from("event_ingest_raw")
    .select(`
      id,
      source_id,
      external_id,
      raw_json,
      event_sources!inner (
        id,
        name,
        type
      )
    `)
    .eq("status", "new")
    .limit(maxItems);

  if (filterSource) {
    query = query.eq("event_sources.name", filterSource);
  }

  const { data: rawItems, error: fetchError } = await query;

  if (fetchError) {
    console.error("Failed to fetch raw items:", fetchError.message);
    process.exit(1);
  }

  if (!rawItems || rawItems.length === 0) {
    console.log("No items to normalize. All raw items have been processed.");
    return;
  }

  console.log(`Found ${rawItems.length} items to normalize\n`);

  let normalized = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const source = item.event_sources as any;
    const sourceType = source.type;

    console.log(`[${i + 1}/${rawItems.length}] Processing: ${item.raw_json?.name || item.external_id}`);

    // Check for adapter
    const adapter = ADAPTERS[sourceType];
    if (!adapter) {
      console.log(`  ⏭ Skipped - no adapter for ${sourceType}`);
      skipped++;

      if (!dryRun) {
        await supabase
          .from("event_ingest_raw")
          .update({ status: "skipped", last_error: "No adapter available" })
          .eq("id", item.id);
      }
      continue;
    }

    try {
      // Normalize
      const normalizedItem = adapter(item.raw_json);

      if (dryRun) {
        console.log(`  [DRY RUN] Would create:`);
        console.log(`    Title: ${normalizedItem.title}`);
        console.log(`    Category: ${normalizedItem.category}`);
        console.log(`    Location: ${normalizedItem.location_name}, ${normalizedItem.town}`);
        console.log(`    Starts: ${normalizedItem.starts_at}`);
        console.log(`    Price: ${normalizedItem.price_bucket}`);
        normalized++;
        continue;
      }

      // Upsert to explore_items
      const { data: upserted, error: upsertError } = await supabase
        .from("explore_items")
        .upsert(
          {
            source_id: item.source_id,
            external_id: item.external_id,
            ...normalizedItem,
          },
          { onConflict: "source_id,external_id" }
        )
        .select("id")
        .single();

      if (upsertError) throw upsertError;

      // Mark raw as normalized
      await supabase
        .from("event_ingest_raw")
        .update({ status: "normalized", last_error: null })
        .eq("id", item.id);

      // Queue for LLM enrichment
      if (upserted && !normalizedItem.hook_line) {
        await supabase.rpc("queue_for_enrichment", {
          p_explore_item_id: upserted.id,
          p_priority: normalizedItem.is_anchor ? 80 : 50,
        });
      }

      console.log(`  ✓ Normalized: ${normalizedItem.title}`);
      normalized++;
    } catch (error) {
      console.log(`  ✗ Error: ${error instanceof Error ? error.message : "Unknown"}`);
      errors++;

      if (!dryRun) {
        await supabase
          .from("event_ingest_raw")
          .update({
            status: "failed",
            last_error: error instanceof Error ? error.message : "Unknown error",
          })
          .eq("id", item.id);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("NORMALIZATION REPORT");
  console.log("=".repeat(60));
  console.log(`Processed:  ${rawItems.length}`);
  console.log(`Normalized: ${normalized}`);
  console.log(`Skipped:    ${skipped}`);
  console.log(`Errors:     ${errors}`);
  console.log("=".repeat(60));

  if (normalized > 0 && !dryRun) {
    console.log("\n✓ Events normalized to explore_items table");
    console.log("  They are now visible in the app!");
    console.log("\n  Optional: Run LLM enrichment for better hook_lines:");
    console.log("  npx tsx scripts/run_enrichment.ts");
  }
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

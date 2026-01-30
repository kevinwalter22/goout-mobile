/**
 * Backfill Enrichment Queue
 *
 * Enqueues all explore_items that are missing normalized_confidence,
 * tags, hook_line, or availability_json for LLM enrichment.
 *
 * Usage: npx tsx scripts/backfill_enrichment.ts [--dry-run]
 *
 * Requires .env.local with:
 *   EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const isDryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`Backfill enrichment queue${isDryRun ? " (DRY RUN)" : ""}`);

  // Find items needing enrichment
  const { data: items, error } = await supabase
    .from("explore_items")
    .select("id, title, normalized_confidence, hook_line, tags, availability_json, llm_enriched_at")
    .or(
      "normalized_confidence.is.null," +
      "tags.is.null," +
      "hook_line.is.null," +
      "availability_json.is.null"
    )
    .gte("priority", 0)
    .order("normalized_confidence", { ascending: true, nullsFirst: true });

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  console.log(`Found ${items?.length || 0} items needing enrichment\n`);

  if (!items || items.length === 0) {
    console.log("Nothing to enqueue.");
    process.exit(0);
  }

  // Show breakdown
  const missingConfidence = items.filter(i => i.normalized_confidence === null).length;
  const missingTags = items.filter(i => !i.tags || i.tags.length === 0).length;
  const missingHookLine = items.filter(i => !i.hook_line).length;
  const missingAvailability = items.filter(i => !i.availability_json).length;

  console.log("Breakdown:");
  console.log(`  Missing confidence:    ${missingConfidence}`);
  console.log(`  Missing tags:          ${missingTags}`);
  console.log(`  Missing hook_line:     ${missingHookLine}`);
  console.log(`  Missing availability:  ${missingAvailability}`);
  console.log();

  if (isDryRun) {
    console.log("DRY RUN — no changes made.");
    items.slice(0, 10).forEach(i => {
      console.log(`  ${i.id} — ${i.title} (confidence: ${i.normalized_confidence ?? "NULL"})`);
    });
    if (items.length > 10) {
      console.log(`  ... and ${items.length - 10} more`);
    }
    process.exit(0);
  }

  // Enqueue each item
  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items) {
    const priority = item.normalized_confidence === null ? 20 : 10;

    const { error: queueError } = await supabase.rpc("queue_for_enrichment", {
      p_explore_item_id: item.id,
      p_priority: priority,
    });

    if (queueError) {
      if (queueError.message?.includes("duplicate") || queueError.message?.includes("conflict")) {
        skipped++;
      } else {
        console.error(`  Error queuing ${item.id}: ${queueError.message}`);
        errors++;
      }
    } else {
      enqueued++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Enqueued: ${enqueued}`);
  console.log(`  Skipped (already queued): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`\nRun the enrichment queue worker to process these items.`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

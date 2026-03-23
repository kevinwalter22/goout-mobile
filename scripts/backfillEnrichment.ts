/**
 * Backfill Enrichment Script
 *
 * Queues existing explore items for re-enrichment with the upgraded v2 prompt
 * that adds audience_fit, is_event_venue, and enrichment_version.
 *
 * Usage:
 *   npx tsx scripts/backfillEnrichment.ts [--dry-run] [--limit N] [--version-below N]
 *
 * Options:
 *   --dry-run         Print what would be queued without actually queueing
 *   --limit N         Max items to queue (default: 500)
 *   --version-below N Only re-enrich items with enrichment_version < N (default: 2)
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load env
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 500;
  const versionIdx = args.indexOf("--version-below");
  const versionBelow = versionIdx >= 0 ? parseInt(args[versionIdx + 1], 10) : 2;

  console.log(`Backfill enrichment: limit=${limit}, version_below=${versionBelow}, dry_run=${dryRun}`);

  // Find items that need re-enrichment
  const { data: items, error } = await supabase
    .from("explore_items")
    .select("id, title, enrichment_version, normalized_confidence, audience_fit")
    .is("deleted_at", null)
    .eq("is_duplicate", false)
    .lt("enrichment_version", versionBelow)
    .gte("priority", 0)
    .order("normalized_confidence", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log("No items need re-enrichment.");
    return;
  }

  console.log(`Found ${items.length} items needing enrichment (version < ${versionBelow})`);

  // Show breakdown
  const byVersion = new Map<number, number>();
  const byAudience = new Map<string, number>();
  for (const item of items) {
    const v = item.enrichment_version ?? 0;
    byVersion.set(v, (byVersion.get(v) || 0) + 1);
    const a = item.audience_fit ?? "unknown";
    byAudience.set(a, (byAudience.get(a) || 0) + 1);
  }
  console.log("\nBy enrichment_version:", Object.fromEntries(byVersion));
  console.log("By audience_fit:", Object.fromEntries(byAudience));

  if (dryRun) {
    console.log("\n[DRY RUN] Would queue these items:");
    for (const item of items.slice(0, 20)) {
      console.log(`  - ${item.title} (conf=${item.normalized_confidence}, v=${item.enrichment_version})`);
    }
    if (items.length > 20) {
      console.log(`  ... and ${items.length - 20} more`);
    }
    return;
  }

  // Queue items for re-enrichment
  let queued = 0;
  let errors = 0;

  for (const item of items) {
    // Higher priority for high-confidence items (they matter most)
    const priority = Math.min(90, Math.max(10, item.normalized_confidence ?? 50));

    const { error: queueError } = await supabase.rpc("queue_for_enrichment", {
      p_explore_item_id: item.id,
      p_priority: priority,
    });

    if (queueError) {
      console.error(`  Failed to queue ${item.title}: ${queueError.message}`);
      errors++;
    } else {
      queued++;
    }

    // Small delay to avoid overwhelming the DB
    if (queued % 50 === 0) {
      console.log(`  Queued ${queued}/${items.length}...`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log(`\nDone: ${queued} queued, ${errors} errors`);
  console.log("Run the enrichment worker to process the queue:");
  console.log("  curl -X POST $SUPABASE_URL/functions/v1/run-enrichment-queue \\");
  console.log("    -H 'Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY' \\");
  console.log('    -d \'{"max_items": 50}\'');
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

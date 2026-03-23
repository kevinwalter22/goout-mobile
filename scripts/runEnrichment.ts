/**
 * Queue items for re-enrichment and then run the enrichment worker.
 *
 * Usage:  npx tsx scripts/runEnrichment.ts [max_items]
 * Example: npx tsx scripts/runEnrichment.ts 5     (test batch)
 *          npx tsx scripts/runEnrichment.ts 500   (full sweep)
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const maxItems = parseInt(process.argv[2] || "5", 10);

async function main() {
  const supabase = createClient(url!, key!);

  // Step 1: Queue items for re-enrichment
  console.log(`Step 1: Queuing up to ${maxItems} items for re-enrichment...`);
  const { data: queueResult, error: queueError } = await supabase.rpc(
    "queue_all_for_reenrichment",
    { p_max_items: maxItems }
  );

  if (queueError) {
    console.error("Queue error:", queueError);
    process.exit(1);
  }

  const itemsQueued = queueResult?.[0]?.items_queued ?? 0;
  console.log(`  Queued ${itemsQueued} items`);

  if (itemsQueued === 0) {
    console.log("No items to enrich. Done.");
    return;
  }

  // Step 2: Run the enrichment worker
  console.log(`\nStep 2: Running enrichment worker (max_items=${maxItems})...`);
  const { data, error } = await supabase.functions.invoke("run-enrichment-queue", {
    body: { max_items: maxItems },
  });

  if (error) {
    console.error("Worker error:", error);
    process.exit(1);
  }

  console.log("\nResult:", JSON.stringify(data, null, 2));
}

main();

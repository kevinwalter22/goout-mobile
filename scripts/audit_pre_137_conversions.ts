// Backfill audit: count post_at_event rows in engagement_log that were
// inserted by the migration-136 trigger BEFORE the migration-137 stricter
// gate landed. If any exist, they're conversion signals against unverified
// posts — they shouldn't train the ranker. Decision is small-cardinality
// dependent.
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Does engagement_log even exist (was 136 applied)?
  const { count, error } = await supabase
    .from("engagement_log")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "post_at_event");

  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      console.log("engagement_log table does not exist — migration 136 has not been applied yet.");
      console.log("No backfill needed: when Kevin applies 136 and 137 together, the strict trigger ships from row zero.");
      return;
    }
    throw error;
  }

  console.log(`post_at_event rows currently in engagement_log: ${count}`);

  if (count === 0) {
    console.log("No pre-137 conversion rows. Nothing to backfill.");
    return;
  }

  console.log("\nSample (first 10):");
  const { data: sample } = await supabase
    .from("engagement_log")
    .select("id, occurred_at, user_id, explore_item_id, post_id, funnel_chain")
    .eq("event_type", "post_at_event")
    .order("occurred_at", { ascending: false })
    .limit(10);
  for (const r of sample || []) {
    console.log(`  ${r.id} | ${r.occurred_at} | post=${r.post_id?.slice(0, 8)} | item=${r.explore_item_id?.slice(0, 8)}`);
  }

  console.log("\nRecommendation:");
  console.log("  If count <= 5: leave them (negligible noise; document as legacy).");
  console.log("  If count > 5: soft-delete (we don't soft-delete engagement_log; consider purging post_at_event rows older than the 137 apply timestamp).");
}

main().catch((e) => { console.error(e); process.exit(1); });

// Phase P-A: prioritize + jumpstart enrichment for Portland venues, then verify.
// Data-plane/operational. Uses max_items:10 so it stays under the edge 150s
// limit even on the un-patched prod runner.
// Run: npx tsx scripts/portland_enrich_jumpstart.ts
import * as dotenv from "dotenv"; import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const b = { latMin: 43.45, latMax: 43.95, lngMin: -70.55, lngMax: -69.95 };
const DRIVE_RUNS = 15;

async function portlandNeedingHook() {
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await s.from("explore_items").select("id, hook_line")
      .gte("lat", b.latMin).lte("lat", b.latMax).gte("lng", b.lngMin).lte("lng", b.lngMax)
      .is("deleted_at", null).range(off, off + 999);
    if (!data?.length) break; out.push(...data); if (data.length < 1000) break;
  }
  return out;
}

(async () => {
  const all = await portlandNeedingHook();
  const need = all.filter((r) => !r.hook_line || r.hook_line.length < 10);
  console.log(`Portland items: ${all.length}; with hook_line: ${all.length - need.length}; needing: ${need.length}`);

  console.log("Enqueueing Portland items at priority 100...");
  let enq = 0;
  for (const r of need) {
    const { error } = await s.rpc("queue_for_enrichment", { p_explore_item_id: r.id, p_priority: 100 });
    if (!error) enq++;
  }
  console.log(`Enqueued/bumped ${enq}/${need.length}`);

  console.log(`\nDriving run-enrichment-queue x${DRIVE_RUNS} (max_items:10)...`);
  let enriched = 0;
  for (let i = 0; i < DRIVE_RUNS; i++) {
    const { data, error } = await s.functions.invoke("run-enrichment-queue", { body: { max_items: 10 } });
    if (error) { console.log(`  run ${i + 1}: ERR ${error.message}`); continue; }
    const sum: any = (data as any)?.summary || {};
    enriched += sum.enriched || 0;
    console.log(`  run ${i + 1}: enriched=${sum.enriched} skipped=${sum.skipped} failed=${sum.failed} processed=${sum.processed}`);
  }

  const after = await portlandNeedingHook();
  const withHook = after.filter((r) => r.hook_line && r.hook_line.length >= 10).length;
  console.log(`\nPortland hook_line coverage now: ${withHook}/${after.length} (${(100 * withHook / after.length).toFixed(0)}%)  [+ cron continues Portland-first]`);
})();

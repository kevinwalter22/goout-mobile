// One-off cleanup for the Warwick launch polish session:
//   1. Soft-delete past events (starts_at < NOW() - 3h, kind=event).
//      Migration 134 will hide them going forward, but they pollute the DB
//      and may resurface if the filter is ever relaxed.
//   2. Soft-delete Web-Collector-sourced events with null lat/lng. These
//      can never satisfy the distance gate (which now enforces a 50mi cap
//      when the user has a location) and the source doesn't backfill coords,
//      so they're permanently invisible. Cleaner to drop them than keep
//      filtering them every query.
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  console.log("# Step 1 — soft-delete past events (kind=event, starts_at < NOW - 3h)");
  const { data: pastEvents, error: e1 } = await supabase
    .from("explore_items")
    .select("id, title, starts_at")
    .eq("kind", "event")
    .lt("starts_at", cutoff)
    .is("deleted_at", null);
  if (e1) throw e1;
  console.log(`  found ${pastEvents?.length || 0} past events to soft-delete`);
  for (const r of (pastEvents || []).slice(0, 5)) {
    console.log(`    sample: ${r.title?.slice(0, 60)} | starts=${r.starts_at}`);
  }
  const ids1 = (pastEvents || []).map((r) => r.id);
  let deleted1 = 0;
  const CHUNK = 200;
  for (let i = 0; i < ids1.length; i += CHUNK) {
    const chunk = ids1.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("explore_items")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", chunk);
    if (!error) deleted1 += chunk.length;
  }
  console.log(`  soft-deleted ${deleted1} past events`);

  console.log("\n# Step 2 — soft-delete Web-Collector events with null lat/lng");
  const { data: srcs } = await supabase.from("event_sources").select("id, name");
  const wcId = srcs?.find((s) => s.name === "Web Collector")?.id;
  if (!wcId) { throw new Error("Web Collector source not found"); }
  const { data: orphans, error: e2 } = await supabase
    .from("explore_items")
    .select("id, title")
    .eq("source_id", wcId)
    .is("lat", null)
    .is("deleted_at", null);
  if (e2) throw e2;
  console.log(`  found ${orphans?.length || 0} Web-Collector rows with null lat`);
  for (const r of (orphans || []).slice(0, 5)) {
    console.log(`    sample: ${r.title?.slice(0, 60)}`);
  }
  const ids2 = (orphans || []).map((r) => r.id);
  let deleted2 = 0;
  for (let i = 0; i < ids2.length; i += CHUNK) {
    const chunk = ids2.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("explore_items")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", chunk);
    if (!error) deleted2 += chunk.length;
  }
  console.log(`  soft-deleted ${deleted2} orphan-coord rows`);

  console.log("\nTotal soft-deleted this run:", deleted1 + deleted2);
}

main().catch((e) => { console.error(e); process.exit(1); });

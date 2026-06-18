// Sanity check: what's actually in event_sources, event_ingest_raw, and
// explore_items right now? Helps explain why the venue-coord backfill found
// zero rows.
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log("# event_sources rows");
  const { data: srcs } = await supabase
    .from("event_sources")
    .select("id, name, type")
    .order("name");
  for (const s of srcs || []) {
    const { count } = await supabase
      .from("explore_items")
      .select("id", { count: "exact", head: true })
      .eq("source_id", s.id);
    const { count: rawCount } = await supabase
      .from("event_ingest_raw")
      .select("id", { count: "exact", head: true })
      .eq("source_id", s.id);
    console.log(`  ${s.name.padEnd(40)} type=${(s.type || "").padEnd(20)} explore=${count} raw=${rawCount}`);
  }

  console.log("\n# explore_items with kind='event' AND lat IS NULL");
  const { count: nullLatEvents } = await supabase
    .from("explore_items")
    .select("id", { count: "exact", head: true })
    .eq("kind", "event")
    .is("lat", null)
    .is("deleted_at", null);
  console.log(`  ${nullLatEvents} rows`);

  // What sources do those null-lat events come from?
  const { data: nullSrc } = await supabase
    .from("explore_items")
    .select("source_id, source_url, title")
    .eq("kind", "event")
    .is("lat", null)
    .is("deleted_at", null)
    .limit(20);
  console.log("\n# Sample null-lat events:");
  for (const r of nullSrc || []) {
    console.log(`  src=${r.source_id?.slice(0, 8)} | ${(r.title || "").slice(0, 50)} | url=${r.source_url?.slice(0, 60)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

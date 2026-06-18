// Issue 3: Ticketmaster warwick-40mi partition was at radius=40, which from
// Warwick (41.2545, -74.359) reaches Manhattan (lower Manhattan is ~38mi south).
// Birdland Jazz Club at 40.76 lat sits 39mi from Warwick — within the radius.
//
// User's spec said "40mi max" with the assumption that excludes NYC; geometry
// disagrees. Tightening to 35mi excludes Manhattan + most of Brooklyn while
// keeping Bergen County NJ + Sussex/Orange NY coverage.
//
// Also: soft-delete the existing Ticketmaster rows inside the NYC bbox so the
// user stops seeing them immediately. The cleanup is bounded by lat/lng (NYC
// metro proper: ~40.5-40.95 lat, -74.3 to -73.7 lng).
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log("# Step 1 — tighten warwick-40mi Ticketmaster partition radius 40 → 35");
  const { data: parts } = await supabase
    .from("fetch_partitions")
    .select("id, partition_label, config_json")
    .eq("partition_label", "warwick-40mi");
  for (const p of parts || []) {
    const cfg = { ...(p.config_json as any), radius: 35 };
    const { error } = await supabase
      .from("fetch_partitions")
      .update({ config_json: cfg })
      .eq("id", p.id);
    console.log(`  ${p.partition_label} | error=${error?.message || "ok"} | new radius=${cfg.radius}`);
  }

  console.log("\n# Step 2 — soft-delete existing Ticketmaster rows inside NYC bbox");
  const { data: srcs } = await supabase.from("event_sources").select("id, name");
  const tmId = srcs?.find((s) => s.name === "Ticketmaster")?.id;
  if (!tmId) throw new Error("Ticketmaster source not found");

  // NYC bbox: 40.5 to 40.95 lat (lower Manhattan to upper Bronx),
  //           -74.3 to -73.7 lng (Jersey City to Queens border)
  const { data: nycRows, error } = await supabase
    .from("explore_items")
    .select("id, title, location_name, lat, lng")
    .eq("source_id", tmId)
    .gte("lat", 40.5).lte("lat", 40.95)
    .gte("lng", -74.3).lte("lng", -73.7)
    .is("deleted_at", null);
  if (error) throw error;
  console.log(`  found ${nycRows?.length || 0} NYC-bbox Ticketmaster rows`);
  for (const r of (nycRows || []).slice(0, 10)) {
    console.log(`    ${r.title?.slice(0, 60).padEnd(60)} | venue=${r.location_name}`);
  }

  const ids = (nycRows || []).map((r) => r.id);
  let deleted = 0;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error: e2 } = await supabase
      .from("explore_items")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", chunk);
    if (!e2) deleted += chunk.length;
  }
  console.log(`  soft-deleted ${deleted} NYC rows`);
}

main().catch((e) => { console.error(e); process.exit(1); });

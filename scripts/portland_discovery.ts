// Diagnostic-only Portland, ME discovery. No mutations.
// Reports: explore_items in Portland bbox (25mi + 15mi), collector_targets for
// Maine, fetch_partitions for Portland/Maine, event_sources, Eventbrite state.
//
// Run: npx tsx scripts/portland_discovery.ts
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.SUPABASE_URL!;
const supabase = createClient(SUPA_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
console.log("Project host:", new URL(SUPA_URL).hostname.split(".")[0]); // ref only, no secret

const LAT = 43.6591, LNG = -70.2568;
function bbox(radiusMiles: number) {
  const d = radiusMiles / 69;
  return {
    latMin: LAT - d, latMax: LAT + d,
    lngMin: LNG - d / Math.cos((LAT * Math.PI) / 180),
    lngMax: LNG + d / Math.cos((LAT * Math.PI) / 180),
  };
}

async function countBbox(r: number) {
  const b = bbox(r);
  const { count } = await supabase.from("explore_items").select("id", { count: "exact", head: true })
    .gte("lat", b.latMin).lte("lat", b.latMax).gte("lng", b.lngMin).lte("lng", b.lngMax).is("deleted_at", null);
  return { count: count ?? 0, b };
}

async function fetchBbox(r: number, select: string) {
  const b = bbox(r);
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from("explore_items").select(select)
      .gte("lat", b.latMin).lte("lat", b.latMax).gte("lng", b.lngMin).lte("lng", b.lngMax)
      .is("deleted_at", null).range(off, off + 999);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  console.log("\n=== PORTLAND, ME DISCOVERY ===");
  for (const r of [15, 25]) {
    const { count, b } = await countBbox(r);
    console.log(`\n[${r}mi] items in bbox: ${count}  (lat ${b.latMin.toFixed(3)}..${b.latMax.toFixed(3)}, lng ${b.lngMin.toFixed(3)}..${b.lngMax.toFixed(3)})`);
  }

  const items = await fetchBbox(25, "id, source_id, kind, category, sub_category, town, image_url, starts_at, recurrence, source_url");
  console.log(`\nFetched ${items.length} rows (25mi) for breakdown.`);
  if (items.length) {
    const srcIds = Array.from(new Set(items.map(r => r.source_id).filter(Boolean)));
    const { data: sources } = await supabase.from("event_sources").select("id, name, type").in("id", srcIds);
    const sById: Record<string, any> = {};
    for (const s of (sources as any[]) || []) sById[s.id] = s;
    const tally = (key: (r: any) => string) => {
      const m: Record<string, number> = {};
      for (const r of items) { const k = key(r); m[k] = (m[k] || 0) + 1; }
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    console.log("\n-- by source type --");
    for (const [k, v] of tally(r => sById[r.source_id]?.type || "(null)")) console.log(`  ${k}: ${v}`);
    console.log("\n-- by kind --");
    for (const [k, v] of tally(r => r.kind || "(null)")) console.log(`  ${k}: ${v}`);
    console.log("\n-- by town (top 20) --");
    for (const [k, v] of tally(r => r.town || "(null)").slice(0, 20)) console.log(`  ${k}: ${v}`);
    console.log("\n-- by category (top 12) --");
    for (const [k, v] of tally(r => r.category || "(null)").slice(0, 12)) console.log(`  ${k}: ${v}`);
  }

  // collector_targets for Maine
  console.log("\n=== collector_targets (Maine-ish) ===");
  const maineTowns = ["Portland", "South Portland", "Westbrook", "Falmouth", "Scarborough", "Cape Elizabeth", "Yarmouth", "Freeport", "Brunswick", "Saco", "Biddeford", "Old Orchard Beach", "Gorham", "Windham"];
  const { data: ct } = await (supabase as any).from("collector_targets")
    .select("name, base_url, town, is_enabled, source_type, last_run_at, total_items_collected").in("town", maineTowns);
  console.log(`Maine-town collector_targets: ${ct?.length ?? 0}`);
  for (const t of (ct as any[]) || []) console.log(`  [${t.is_enabled ? "ON" : "off"}] ${t.town} | ${t.name} | ${t.base_url}`);

  // grand total collector_targets by town
  const { data: allCt } = await (supabase as any).from("collector_targets").select("town, is_enabled");
  const townTally: Record<string, { on: number; off: number }> = {};
  for (const t of (allCt as any[]) || []) {
    const k = t.town || "(null)";
    townTally[k] = townTally[k] || { on: 0, off: 0 };
    if (t.is_enabled) townTally[k].on++; else townTally[k].off++;
  }
  console.log(`\n-- ALL collector_targets by town (total ${allCt?.length ?? 0}) --`);
  for (const [k, v] of Object.entries(townTally).sort((a, b) => (b[1].on + b[1].off) - (a[1].on + a[1].off)))
    console.log(`  ${k}: on=${v.on} off=${v.off}`);

  // fetch_partitions
  console.log("\n=== fetch_partitions (all) ===");
  const { data: fp } = await (supabase as any).from("fetch_partitions")
    .select("partition_label, source_id, is_enabled, last_fetched_at");
  const fpSrcIds = Array.from(new Set(((fp as any[]) || []).map(p => p.source_id).filter(Boolean)));
  const { data: fpSrc } = await supabase.from("event_sources").select("id, name, type").in("id", fpSrcIds);
  const fpById: Record<string, any> = {};
  for (const s of (fpSrc as any[]) || []) fpById[s.id] = s;
  for (const p of ((fp as any[]) || []).sort((a, b) => a.partition_label.localeCompare(b.partition_label)))
    console.log(`  [${p.is_enabled ? "ON" : "off"}] ${p.partition_label.padEnd(24)} | ${(fpById[p.source_id]?.name || "?")}`);

  // event_sources
  console.log("\n=== event_sources ===");
  const { data: es } = await supabase.from("event_sources").select("name, type, is_active").order("type");
  for (const s of (es as any[]) || []) console.log(`  [${s.is_active ? "active" : "INACTIVE"}] ${(s.type || "?").padEnd(20)} | ${s.name}`);
}

main().catch(e => { console.error(e?.message || e); process.exit(1); });

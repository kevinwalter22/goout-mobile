// Diagnostic-only Warwick catalog audit.
// Reports counts of explore_items, collector_targets, and fetch_partitions
// scoped to the Warwick bbox. No mutations.
//
// Run: npx tsx scripts/warwick_catalog_audit.ts
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const WARWICK_LAT = 41.2545;
const WARWICK_LNG = -74.359;
const RADIUS_MILES = 25;
const RADIUS_DEG = RADIUS_MILES / 69;
const LAT_MIN = WARWICK_LAT - RADIUS_DEG;
const LAT_MAX = WARWICK_LAT + RADIUS_DEG;
const LNG_MIN = WARWICK_LNG - RADIUS_DEG / Math.cos((WARWICK_LAT * Math.PI) / 180);
const LNG_MAX = WARWICK_LNG + RADIUS_DEG / Math.cos((WARWICK_LAT * Math.PI) / 180);

async function paginatedFetch(select: string) {
  const out: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("explore_items")
      .select(select)
      .gte("lat", LAT_MIN).lte("lat", LAT_MAX)
      .gte("lng", LNG_MIN).lte("lng", LNG_MAX)
      .is("deleted_at", null)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}

async function section2() {
  console.log("\n=== SECTION 2: Warwick Catalog Inventory ===");
  console.log(`Bbox: lat [${LAT_MIN.toFixed(4)}, ${LAT_MAX.toFixed(4)}], lng [${LNG_MIN.toFixed(4)}, ${LNG_MAX.toFixed(4)}] (~${RADIUS_MILES}mi from Warwick center)`);

  const { count: total } = await supabase
    .from("explore_items")
    .select("id", { count: "exact", head: true })
    .gte("lat", LAT_MIN).lte("lat", LAT_MAX)
    .gte("lng", LNG_MIN).lte("lng", LNG_MAX)
    .is("deleted_at", null);
  console.log(`Total live items in Warwick bbox: ${total ?? 0}\n`);

  const items = await paginatedFetch(
    "id, source_id, kind, category, sub_category, image_url, starts_at, schedule_text, recurrence, town, source_url, provenance, last_refreshed_at, deleted_at"
  );
  console.log(`Fetched ${items.length} rows for tally.\n`);

  // Lookup source_id -> source name/type from event_sources
  const sourceIds = Array.from(new Set(items.map((r) => r.source_id).filter(Boolean)));
  const { data: sources } = await supabase.from("event_sources").select("id, name, type").in("id", sourceIds);
  const srcById: Record<string, { name: string; type: string }> = {};
  for (const s of (sources as any[]) || []) srcById[s.id] = { name: s.name, type: s.type };

  const bySourceType: Record<string, number> = {};
  const bySourceName: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const bySub: Record<string, number> = {};
  const byTown: Record<string, number> = {};
  let withImage = 0, withoutImage = 0, withStarts = 0, withoutStarts = 0, withSchedule = 0, withRecurrence = 0;
  for (const r of items) {
    const sInfo = r.source_id ? srcById[r.source_id] : null;
    const sType = sInfo?.type || "(unknown/null)";
    const sName = sInfo?.name || "(unknown/null)";
    bySourceType[sType] = (bySourceType[sType] || 0) + 1;
    bySourceName[sName] = (bySourceName[sName] || 0) + 1;
    byKind[r.kind || "(null)"] = (byKind[r.kind || "(null)"] || 0) + 1;
    byCategory[r.category || "(null)"] = (byCategory[r.category || "(null)"] || 0) + 1;
    bySub[r.sub_category || "(null)"] = (bySub[r.sub_category || "(null)"] || 0) + 1;
    byTown[r.town || "(null)"] = (byTown[r.town || "(null)"] || 0) + 1;
    if (r.image_url) withImage++; else withoutImage++;
    if (r.starts_at) withStarts++; else withoutStarts++;
    if (r.schedule_text) withSchedule++;
    if (r.recurrence) withRecurrence++;
  }

  console.log("-- By source TYPE --");
  for (const [k, v] of Object.entries(bySourceType).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  console.log("\n-- By source NAME (top 20) --");
  for (const [k, v] of Object.entries(bySourceName).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${k}: ${v}`);

  console.log("\n-- By kind --");
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  console.log("\n-- By category (top 15) --");
  for (const [k, v] of Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k}: ${v}`);

  console.log("\n-- By sub_category (top 30) --");
  for (const [k, v] of Object.entries(bySub).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${k}: ${v}`);

  console.log("\n-- By town (top 15) --");
  for (const [k, v] of Object.entries(byTown).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k}: ${v}`);

  console.log("\n-- Image coverage --");
  console.log(`  has_image: ${withImage} (${((withImage / items.length) * 100).toFixed(1)}%)`);
  console.log(`  no_image:  ${withoutImage} (${((withoutImage / items.length) * 100).toFixed(1)}%)`);

  console.log("\n-- Time coverage --");
  console.log(`  has starts_at:    ${withStarts} (${((withStarts / items.length) * 100).toFixed(1)}%)`);
  console.log(`  no starts_at:     ${withoutStarts}`);
  console.log(`  has schedule_text:${withSchedule}`);
  console.log(`  has recurrence:   ${withRecurrence}`);

  // Civic-space candidates among Google Places venues (sub_category includes these)
  console.log("\n-- Google Places venues in civic/community sub_categories --");
  const civicSubs = ["park", "community_center", "town_hall", "city_hall", "fairground", "library", "civic_center", "performing_arts_theater"];
  const gp = items.filter((r) => {
    const s = r.source_id ? srcById[r.source_id]?.type : null;
    return s === "api_google_places";
  });
  console.log(`  total Google Places venues in bbox: ${gp.length}`);
  const civicTally: Record<string, number> = {};
  for (const r of gp) {
    const sub = (r.sub_category || "").toLowerCase();
    for (const c of civicSubs) {
      if (sub.includes(c)) civicTally[c] = (civicTally[c] || 0) + 1;
    }
  }
  for (const [k, v] of Object.entries(civicTally)) console.log(`    ${k}: ${v}`);
}

async function section3a() {
  console.log("\n=== SECTION 3a: collector_targets (Warwick area) ===");
  const towns = ["Warwick", "Goshen", "Middletown", "Sugar Loaf", "New Windsor", "Bethel", "Vernon", "Hamburg", "Florida", "Greenwood Lake", "Chester"];
  const { data: targets, error } = await (supabase as any)
    .from("collector_targets")
    .select("id, name, base_url, town, default_category, source_type, is_enabled, circuit_breaker, last_run_at, last_run_pages_fetched, last_run_items_found, last_run_errors, total_items_collected, consecutive_errors, site_config")
    .in("town", towns);
  if (error) {
    console.error(error);
    return;
  }
  if (!targets || targets.length === 0) {
    console.log("(no rows returned — check if migration 127 was applied)");
    return;
  }
  console.log(`Total collector_targets in Warwick area towns: ${targets.length}`);
  const enabled = targets.filter((t: any) => t.is_enabled);
  console.log(`  enabled:  ${enabled.length}`);
  console.log(`  disabled: ${targets.length - enabled.length}\n`);

  console.log("-- Per-target status --");
  for (const t of targets.sort((a: any, b: any) => (a.town || "").localeCompare(b.town || "") || a.name.localeCompare(b.name))) {
    const lastRun = t.last_run_at ? new Date(t.last_run_at).toISOString().slice(0, 16) : "never";
    console.log(`  ${t.is_enabled ? "[ON ]" : "[off]"} ${t.town?.padEnd(15)} | ${t.name.padEnd(40)} | ${(t.source_type || "?").padEnd(8)} | last=${lastRun} | items=${(t.last_run_items_found ?? 0).toString().padStart(3)} | total=${(t.total_items_collected ?? 0).toString().padStart(4)} | err=${t.consecutive_errors ?? 0} | breaker=${t.circuit_breaker}`);
  }
}

async function section3b() {
  console.log("\n=== SECTION 3b: fetch_partitions (warwick-*) ===");
  const { data: parts, error } = await (supabase as any)
    .from("fetch_partitions")
    .select("partition_label, source_id, is_enabled, priority, last_fetched_at, last_result, last_error, fetch_interval_minutes, consecutive_errors")
    .ilike("partition_label", "warwick%");
  if (error) {
    console.error(error);
    return;
  }
  if (!parts || parts.length === 0) {
    console.log("(no warwick-* partitions found)");
    return;
  }
  // also fetch source names
  const sourceIds = Array.from(new Set(parts.map((p: any) => p.source_id).filter(Boolean)));
  const { data: sources } = await supabase.from("event_sources").select("id, name, type").in("id", sourceIds);
  const srcById: Record<string, { name: string; type: string }> = {};
  for (const s of (sources as any[]) || []) srcById[s.id] = { name: s.name, type: s.type };

  console.log(`Total warwick-* partitions: ${parts.length}\n`);
  for (const p of parts as any[]) {
    const lastFetch = p.last_fetched_at ? new Date(p.last_fetched_at).toISOString().slice(0, 16) : "never";
    const r = p.last_result || {};
    const itemsKey = Object.keys(r).find((k) => k.includes("inserted") || k.includes("found")) || "";
    const itemCount = itemsKey ? r[itemsKey] : "?";
    const src = srcById[p.source_id];
    console.log(`  [${p.is_enabled ? "ON" : "off"}] ${p.partition_label.padEnd(22)} | ${(src?.name || "?").padEnd(18)} | last=${lastFetch} | last_items=${itemCount} | err=${p.consecutive_errors}`);
    if (p.last_error) console.log(`        err: ${p.last_error.slice(0, 120)}`);
  }
}

async function main() {
  await section2();
  await section3a();
  await section3b();
}

main().catch((e) => { console.error(e); process.exit(1); });

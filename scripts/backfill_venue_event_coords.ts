/**
 * One-off backfill: copy lat/lng/address from parent venue (explore_items)
 * down to venue-website-extracted child events that have null coordinates.
 *
 * Surgical join — no fuzzy title matching:
 *   event_ingest_raw.external_id = `${parent_explore_item_id}::${source_url}::${title}` (truncated to 200)
 *   explore_items (child events) have source_url stored verbatim
 *
 * So we:
 *   1. Pull every event_ingest_raw row whose source = "Auto-Discovered Venue"
 *   2. Parse external_id → [parent_explore_item_id, source_url, ...]
 *      and read raw_json.source_url as a cross-check (matches what
 *      normalize-raw-events writes to explore_items.source_url verbatim)
 *   3. Resolve parent_id → (lat, lng, address)
 *   4. UPDATE explore_items WHERE source_id = synthetic AND lat IS NULL
 *      AND source_url IN the resolved set
 *
 * Truncation note: external_id is substring(0, 200). When a long title pushes
 * past 200 chars, the title segment is cut off but the parent_id::source_url::
 * prefix survives, so the join key is intact.
 */
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(URL, KEY);

async function main() {
  console.log("# Step 1 — locate synthetic source_id");
  const { data: src, error: srcErr } = await supabase
    .from("event_sources")
    .select("id, name")
    .eq("name", "Auto-Discovered Venue")
    .single();
  if (srcErr || !src) {
    throw new Error(`Auto-Discovered Venue source not found: ${srcErr?.message}`);
  }
  console.log(`  source_id=${src.id}`);

  console.log("\n# Step 2 — pull event_ingest_raw rows for that source");
  // Page through; src.id should have at most ~few hundred rows so one fetch
  // is fine, but raise the cap defensively.
  const { data: rawRows, error: rawErr } = await supabase
    .from("event_ingest_raw")
    .select("external_id, raw_json")
    .eq("source_id", src.id)
    .limit(5000);
  if (rawErr) throw rawErr;
  console.log(`  found ${rawRows?.length || 0} raw rows`);

  // Build (source_url → parent_explore_item_id) map
  const urlToParent = new Map<string, string>();
  for (const r of rawRows || []) {
    const parts = String(r.external_id || "").split("::");
    const parentId = parts[0];
    const sourceUrl = (r.raw_json as any)?.source_url;
    if (!parentId || !sourceUrl) continue;
    // First-write wins; if multiple events share the same source_url they
    // share the same parent in practice (single venue page), so no conflict.
    if (!urlToParent.has(sourceUrl)) {
      urlToParent.set(sourceUrl, parentId);
    }
  }
  console.log(`  unique source_url → parent mappings: ${urlToParent.size}`);

  console.log("\n# Step 3 — fetch parent venue coordinates");
  const parentIds = [...new Set([...urlToParent.values()])];
  const parentCoords = new Map<string, { lat: number | null; lng: number | null; address: string | null }>();
  const CHUNK = 200;
  for (let i = 0; i < parentIds.length; i += CHUNK) {
    const chunk = parentIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("explore_items")
      .select("id, lat, lng, address")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data || []) {
      parentCoords.set(row.id, { lat: row.lat, lng: row.lng, address: row.address });
    }
  }
  console.log(`  resolved ${parentCoords.size} parents (of ${parentIds.length} unique ids)`);

  console.log("\n# Step 4 — fetch child events needing coords");
  const { data: children, error: childErr } = await supabase
    .from("explore_items")
    .select("id, source_url, lat, lng, address, title")
    .eq("source_id", src.id)
    .is("lat", null)
    .limit(5000);
  if (childErr) throw childErr;
  console.log(`  ${children?.length || 0} child events have null lat`);

  console.log("\n# Step 5 — match + update");
  const updates: Array<{ id: string; lat: number; lng: number; address: string | null; title: string }> = [];
  let unmatched = 0;
  for (const c of children || []) {
    if (!c.source_url) {
      unmatched++;
      continue;
    }
    const parentId = urlToParent.get(c.source_url);
    if (!parentId) {
      unmatched++;
      continue;
    }
    const parent = parentCoords.get(parentId);
    if (!parent || parent.lat == null || parent.lng == null) {
      unmatched++;
      continue;
    }
    updates.push({
      id: c.id,
      lat: parent.lat,
      lng: parent.lng,
      address: c.address ?? parent.address,
      title: c.title,
    });
  }
  console.log(`  ${updates.length} ready to update | ${unmatched} unmatched`);

  let updated = 0;
  // Updates are one-by-one to keep them safe (no batch upsert with partial keys).
  // 50-100 row cardinality means this finishes in seconds.
  for (const u of updates) {
    const { error } = await supabase
      .from("explore_items")
      .update({ lat: u.lat, lng: u.lng, address: u.address })
      .eq("id", u.id);
    if (error) {
      console.log(`    UPDATE failed for ${u.id} (${u.title.slice(0, 40)}): ${error.message}`);
    } else {
      updated++;
    }
  }
  console.log(`\n  successfully updated ${updated} of ${updates.length} rows`);

  console.log("\n# Sample (first 10 updated)");
  for (const u of updates.slice(0, 10)) {
    console.log(`  ${u.id} | (${u.lat.toFixed(4)}, ${u.lng.toFixed(4)}) | ${u.title.slice(0, 60)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

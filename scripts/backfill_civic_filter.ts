// Run the civic filter retroactively over existing explore_items.
// SURFACE first (print count + sample of 20), then SOFT-DELETE (deleted_at = NOW()).
// Idempotent — rows already soft-deleted are excluded from the scan.
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";
import { isCivicContent } from "../supabase/functions/_shared/civic-filter.ts";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log("# Step 1 — scan explore_items (live rows only)");
  // Page through to cover the catalog (~2200 live items).
  const PAGE = 1000;
  let offset = 0;
  const civicHits: Array<{ id: string; title: string; location_name: string | null; town: string | null; source_id: string | null; kind: string; reason?: string }> = [];
  while (true) {
    const { data, error } = await supabase
      .from("explore_items")
      .select("id, title, location_name, town, source_id, kind")
      .is("deleted_at", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const result = isCivicContent(row.title, row.location_name);
      if (result.isCivic) {
        civicHits.push({ ...row, reason: result.reason });
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`  scanned to offset ${offset + PAGE}; found ${civicHits.length} civic-content rows`);

  console.log("\n# Step 2 — sample of 20 (sanity check before soft-delete)");
  for (const h of civicHits.slice(0, 20)) {
    console.log(`  [${h.kind}] ${h.title.slice(0, 70).padEnd(70)} | venue=${(h.location_name || "").slice(0, 30).padEnd(30)} | reason=${h.reason}`);
  }
  if (civicHits.length > 20) {
    console.log(`  ... and ${civicHits.length - 20} more`);
  }

  if (civicHits.length === 0) {
    console.log("\nNo civic-content rows found. Nothing to soft-delete.");
    return;
  }

  console.log("\n# Step 3 — soft-delete (deleted_at = NOW())");
  const ids = civicHits.map((h) => h.id);
  const CHUNK = 200;
  let updated = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("explore_items")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", chunk);
    if (error) {
      console.error(`  chunk ${i / CHUNK} failed: ${error.message}`);
    } else {
      updated += chunk.length;
    }
  }
  console.log(`  soft-deleted ${updated} of ${civicHits.length} rows`);

  console.log("\n# Step 4 — breakdown by reason");
  const byReason = new Map<string, number>();
  for (const h of civicHits) {
    byReason.set(h.reason || "unknown", (byReason.get(h.reason || "unknown") || 0) + 1);
  }
  for (const [reason, count] of byReason) {
    console.log(`  ${reason}: ${count}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

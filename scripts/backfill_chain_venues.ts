/**
 * One-shot backfill: populate is_chain / chain_brand on existing explore_items
 * using the curated vocabulary in supabase/functions/_shared/chain-detection.ts.
 *
 * Run after migration 130 applies. Re-runnable safely — only updates rows
 * whose computed (is_chain, chain_brand) differs from what's currently stored,
 * so re-runs after vocabulary expansions are cheap.
 *
 * Usage:
 *   npx tsx scripts/backfill_chain_venues.ts [--dry-run] [--batch N]
 *
 * Options:
 *   --dry-run  Print what would change without writing.
 *   --batch N  Page size for SELECT (default 500). Updates are issued one row
 *              at a time to keep error reporting per-row.
 *
 * Reports at end:
 *   - total rows scanned
 *   - rows flagged is_chain=TRUE (with brand histogram)
 *   - rows that needed an update vs already correct
 *   - sample of 10 newly-flagged rows for spot-check (Pause B requirement)
 *   - per-brand count for Whole Foods / Trader Joe's / Wegmans / Barnes & Noble
 *     (Pause B requirement — decide whether to flag is_chain_override=FALSE)
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "node:path";
import { isChainVenue } from "../supabase/functions/_shared/chain-detection.ts";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

interface Row {
  id: string;
  title: string;
  is_chain: boolean | null;
  chain_brand: string | null;
}

// Brands we want a per-location report for after the run — these are the
// "default-suppress but override per location" group (grocery + bookstores).
const REPORT_BRANDS = new Set([
  "Whole Foods",
  "Trader Joe's",
  "Wegmans",
  "Barnes & Noble",
]);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const batchIdx = args.indexOf("--batch");
  const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) : 500;

  console.log(`[backfill_chain_venues] start. dry_run=${dryRun} batch=${batchSize}`);

  let scanned = 0;
  let flagged = 0;
  let updated = 0;
  let alreadyCorrect = 0;
  let errors = 0;
  const brandHistogram = new Map<string, number>();
  const reportBrandRows = new Map<string, string[]>(); // brand → titles
  const newlyFlaggedSample: { id: string; title: string; brand: string }[] = [];

  let offset = 0;
  while (true) {
    const { data: rows, error } = await supabase
      .from("explore_items")
      .select("id, title, is_chain, chain_brand")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("Query failed at offset", offset, ":", error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows as Row[]) {
      scanned++;
      const match = isChainVenue(row.title);
      const wantIsChain = match.is_chain;
      const wantBrand = match.brand;

      if (wantIsChain) {
        flagged++;
        brandHistogram.set(wantBrand!, (brandHistogram.get(wantBrand!) || 0) + 1);
        if (REPORT_BRANDS.has(wantBrand!)) {
          const arr = reportBrandRows.get(wantBrand!) || [];
          arr.push(row.title);
          reportBrandRows.set(wantBrand!, arr);
        }
      }

      const currentIsChain = row.is_chain === true;
      const currentBrand = row.chain_brand;
      const needsUpdate =
        currentIsChain !== wantIsChain || currentBrand !== wantBrand;

      if (!needsUpdate) {
        alreadyCorrect++;
        continue;
      }

      if (wantIsChain && newlyFlaggedSample.length < 10) {
        newlyFlaggedSample.push({
          id: row.id,
          title: row.title,
          brand: wantBrand!,
        });
      }

      if (dryRun) {
        updated++;
        continue;
      }

      const { error: upErr } = await supabase
        .from("explore_items")
        .update({ is_chain: wantIsChain, chain_brand: wantBrand })
        .eq("id", row.id);
      if (upErr) {
        console.error(`  update failed id=${row.id}: ${upErr.message}`);
        errors++;
      } else {
        updated++;
      }
    }

    if (rows.length < batchSize) break;
    offset += batchSize;
  }

  // ── Report ───────────────────────────────────────────────────────────
  console.log("\n========================================");
  console.log(`scanned:         ${scanned}`);
  console.log(`flagged is_chain ${flagged}`);
  console.log(`updated:         ${updated}${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`already correct: ${alreadyCorrect}`);
  console.log(`errors:          ${errors}`);

  console.log("\nbrand histogram (sorted by count desc):");
  const sortedBrands = [...brandHistogram.entries()].sort((a, b) => b[1] - a[1]);
  for (const [brand, n] of sortedBrands) {
    console.log(`  ${n.toString().padStart(4)}  ${brand}`);
  }

  console.log("\nsample of 10 newly-flagged rows (spot-check at Pause B):");
  for (const s of newlyFlaggedSample) {
    console.log(`  [${s.brand}] "${s.title}" (id=${s.id})`);
  }

  console.log("\n──── per-location report for default-suppress brands ────");
  console.log("(decide whether to manually set is_chain_override=FALSE for any)");
  for (const brand of REPORT_BRANDS) {
    const titles = reportBrandRows.get(brand) || [];
    console.log(`  ${brand}: ${titles.length} location(s)`);
    for (const t of titles) console.log(`    - ${t}`);
  }

  if (flagged > 150) {
    console.log(
      "\n⚠️  flagged count exceeds the 150-row sanity threshold — review " +
      "the brand list before proceeding.",
    );
    process.exit(2);
  }

  console.log("\n[backfill_chain_venues] done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

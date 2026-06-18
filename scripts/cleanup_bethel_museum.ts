/**
 * One-off cleanup: Museum at Bethel Woods is in the catalog as kind='event'
 * with a fabricated starts_at (midnight on April 1, the start of the museum's
 * operating season). The web_collector guardrail I added prevents future
 * occurrences but doesn't retroactively re-classify existing rows.
 *
 * Also scans for similar mis-classifications so we know the blast radius
 * before deciding whether to widen the cleanup.
 */
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(URL, KEY);

async function main() {
  console.log("# Step 1 — locate Bethel Woods Museum row(s)");
  const { data: matches, error: e1 } = await supabase
    .from("explore_items")
    .select("id, title, kind, starts_at, ends_at, location_name, town")
    .ilike("title", "%museum at bethel%")
    .eq("kind", "event");
  if (e1) throw e1;
  console.log(`found ${matches?.length || 0} row(s)`);
  for (const r of matches || []) {
    console.log(`  ${r.id} | ${r.title} | starts_at=${r.starts_at} | town=${r.town}`);
  }

  console.log("\n# Step 2 — flip kind=event → kind=activity, NULL the fake dates");
  const ids = (matches || []).map((r) => r.id);
  if (ids.length > 0) {
    const { error: e2 } = await supabase
      .from("explore_items")
      .update({ kind: "activity", starts_at: null, ends_at: null })
      .in("id", ids);
    if (e2) throw e2;
    console.log(`  updated ${ids.length} row(s)`);
  } else {
    console.log("  no rows to update");
  }

  console.log("\n# Step 3 — scan for similar misclassifications (NOT updating, just listing)");
  // Pull events with starts_at at exact midnight; filter the suspicious title/desc patterns in JS
  // (PostgREST doesn't let us express extract(hour) easily here).
  const { data: suspects, error: e3 } = await supabase
    .from("explore_items")
    .select("id, title, kind, starts_at, location_name, description")
    .eq("kind", "event")
    .not("starts_at", "is", null)
    .limit(2000);
  if (e3) throw e3;
  const facilityRe =
    /\b(?:museum|gallery|exhibit|visit the|visit us|hours of operation|open year[\s-]?round|open daily|permanent exhibit|on view|on display)\b/i;
  const filtered = (suspects || []).filter((r: any) => {
    if (!r.starts_at) return false;
    const d = new Date(r.starts_at);
    if (Number.isNaN(d.getTime())) return false;
    const isMidnightUTC = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
    if (!isMidnightUTC) return false;
    return facilityRe.test(r.title || "") || facilityRe.test(r.description || "");
  });
  console.log(`  ${filtered.length} candidates (NOT updated — review before acting)`);
  for (const r of filtered.slice(0, 25)) {
    console.log(
      `  ${r.id} | ${r.title?.slice(0, 60)} | ${r.starts_at} | venue=${r.location_name}`,
    );
  }
  if (filtered.length > 25) {
    console.log(`  ... and ${filtered.length - 25} more`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

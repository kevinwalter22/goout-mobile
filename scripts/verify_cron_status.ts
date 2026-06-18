// Quick verification: print cron.job for cache-place-photos-run and pg_cron
// recent_runs to confirm the new job is firing without the app.supabase_url
// error.
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const r = await fetch(`${URL}/functions/v1/diagnose-cron`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "diagnose" }),
  });
  const j = await r.json();
  console.log("# Recent cron runs (last 30 in 15 min window)");
  for (const row of j.recent_runs || []) {
    const msg = String(row.return_message || "").slice(0, 100).replace(/\s+/g, " ");
    console.log(`  jobid=${row.jobid} status=${row.status} start=${row.start_time} | ${msg}`);
  }
  console.log("\nTotal:", (j.recent_runs || []).length);
}

main().catch((e) => { console.error(e); process.exit(1); });

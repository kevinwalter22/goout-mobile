// Bump rates + add geo prioritization for the Warwick launch:
//
//   cache-place-photos-run     25 → 100 items / 15 min  (Issue 4)
//   ingest-venue-website-run    5 →  25 venues / hour    (Issue 5)
//   discover-venues-hourly     unchanged 50 / hour, but now scoped to Warwick bbox
//
// Goes through diagnose-cron's fix mode, which rewrites cron.job.command with
// literal URL + bearer (the only path that works on Supabase's managed
// instance — see migration 132 notes for the ALTER DATABASE blocker).
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const LEGACY = process.env.LEGACY_SERVICE_ROLE_JWT;

async function call(body: any): Promise<any> {
  const r = await fetch(`${URL}/functions/v1/diagnose-cron`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(t) }; } catch { return { ok: r.ok, status: r.status, raw: t }; }
}

// Warwick bbox used by the Warwick fanout — matches the bbox in
// scripts/session_warwick_invocations.ts.
const WARWICK_BBOX = { min_lat: 40.75, max_lat: 41.75, min_lng: -75.0, max_lng: -73.7 };

async function main() {
  const bearer = LEGACY || KEY;
  console.log(`Using bearer: ${LEGACY ? "LEGACY_SERVICE_ROLE_JWT" : "SUPABASE_SERVICE_ROLE_KEY"}`);

  const jobs = [
    {
      name: "cache-place-photos-run",
      schedule: "*/15 * * * *",
      endpoint: "cache-place-photos",
      payload: '{"max_items": 100, "mode": "cache"}',
    },
    {
      name: "ingest-venue-website-run",
      schedule: "15 * * * *",
      endpoint: "ingest-venue-website",
      payload: '{"max_per_run": 25}',
    },
    {
      name: "discover-venues-hourly",
      schedule: "0 * * * *",
      endpoint: "discover-venues-to-crawl",
      payload: `{"max_per_run": 50, "bbox": ${JSON.stringify(WARWICK_BBOX)}}`,
    },
  ];

  console.log("\n# Rewriting cron commands");
  const fix = await call({
    mode: "fix",
    supabase_url: URL,
    service_role_key: bearer,
    jobs,
  });
  console.log("fixes:", JSON.stringify(fix.json?.fixes, null, 2));

  console.log("\n# Re-diagnose snapshot (recent runs)");
  const diag = await call({ mode: "diagnose" });
  for (const r of (diag.json?.recent_runs || []).slice(0, 10)) {
    const msg = String(r.return_message || "").slice(0, 80).replace(/\s+/g, " ");
    console.log(`  jobid=${r.jobid} status=${r.status} start=${r.start_time} | ${msg}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

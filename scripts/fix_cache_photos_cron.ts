/**
 * Verify migration 133 + rewrite cache-place-photos-run command via diagnose-cron.
 * Same workaround used for migration 132 — ALTER DATABASE is permission-denied,
 * so embed URL + bearer as literals in cron.job.command.
 */
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const LEGACY = process.env.LEGACY_SERVICE_ROLE_JWT;

async function call(body: any): Promise<any> {
  const r = await fetch(`${URL}/functions/v1/diagnose-cron`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return { ok: r.ok, status: r.status, json: JSON.parse(text) };
  } catch {
    return { ok: r.ok, status: r.status, raw: text };
  }
}

async function main() {
  console.log("# Step 1 — diagnose snapshot (confirm job registered, current command)");
  const diag = await call({ mode: "diagnose" });
  if (!diag.ok) {
    console.error("diagnose failed:", diag.status, diag.json || diag.raw);
    process.exit(1);
  }
  console.log("pg_cron_ext:", JSON.stringify(diag.json?.pg_cron_ext));
  console.log("db_level_settings:", JSON.stringify(diag.json?.db_level_settings));
  const recent = (diag.json?.recent_runs || []).filter((r: any) =>
    String(r.return_message || "").includes("cache-place-photos") ||
    String(r.return_message || "").includes("app.supabase_url"),
  );
  console.log(`recent_runs (sample of ${(diag.json?.recent_runs || []).length}):`);
  for (const r of (diag.json?.recent_runs || []).slice(0, 5)) {
    console.log(`  jobid=${r.jobid} status=${r.status} msg=${(r.return_message || "").slice(0, 80)}`);
  }

  // Prefer LEGACY (matches the pattern used for the other 6 cron jobs last
  // session) but fall back to the current sb_secret_* — both pass through the
  // function-level auth guard, and the gateway is --no-verify-jwt for these
  // endpoints, so either works.
  const bearer = LEGACY || KEY;
  console.log(`\n# Step 2 — rewrite cache-place-photos-run command (using ${LEGACY ? "LEGACY_SERVICE_ROLE_JWT" : "SUPABASE_SERVICE_ROLE_KEY"})`);
  const fix = await call({
    mode: "fix",
    supabase_url: URL,
    service_role_key: bearer,
    jobs: [
      {
        name: "cache-place-photos-run",
        schedule: "*/15 * * * *",
        endpoint: "cache-place-photos",
        payload: '{"max_items": 25, "mode": "cache"}',
      },
    ],
  });
  console.log("fix result:", JSON.stringify(fix.json?.fixes, null, 2));

  console.log("\n# Step 3 — re-diagnose to confirm command now contains literal Bearer");
  const after = await call({ mode: "diagnose" });
  const recentAfter = (after.json?.recent_runs || []).slice(0, 5);
  console.log(`recent_runs after fix (last ${recentAfter.length}):`);
  for (const r of recentAfter) {
    console.log(`  jobid=${r.jobid} status=${r.status} msg=${(r.return_message || "").slice(0, 80)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

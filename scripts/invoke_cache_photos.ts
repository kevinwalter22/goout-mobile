// Manual invoke of cache-place-photos. Confirms the pipeline works end-to-end
// without waiting for the next 15-minute cron tick.
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function call(endpoint: string, body: any): Promise<any> {
  const r = await fetch(`${URL}/functions/v1/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try {
    return { ok: r.ok, status: r.status, json: JSON.parse(t) };
  } catch {
    return { ok: r.ok, status: r.status, raw: t };
  }
}

async function main() {
  console.log("# Stats before");
  const before = await call("cache-place-photos", { mode: "stats" });
  console.log(JSON.stringify(before.json?.stats, null, 2));

  console.log("\n# Manual drain (max_items=25)");
  const r = await call("cache-place-photos", { max_items: 25, mode: "cache" });
  console.log("status:", r.status);
  console.log("result:", JSON.stringify({
    processed: r.json?.processed,
    cached: r.json?.cached,
    skipped: r.json?.skipped,
    errors: (r.json?.errors || []).slice(0, 5),
  }, null, 2));

  console.log("\n# Stats after");
  const after = await call("cache-place-photos", { mode: "stats" });
  console.log(JSON.stringify(after.json?.stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

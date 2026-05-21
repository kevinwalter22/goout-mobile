/**
 * Session helper — runs ingest-web-collector in batches until queue drains.
 * Usage: npx tsx scripts/session_warwick_invocations.ts
 */
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function invoke(endpoint: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${URL}/functions/v1/${endpoint}`, {
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
  const mode = process.argv[2] || "ingest-web-collector";

  if (mode === "ingest-web-collector") {
    let total = { processed: 0, queued: 0, llm_calls: 0, cost: 0 };
    for (let i = 1; i <= 8; i++) {
      const start = Date.now();
      const r = await invoke("ingest-web-collector", { max_targets: 3 });
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      if (!r.ok) {
        console.log(`batch ${i} | ${dur}s | status=${r.status} | ${JSON.stringify(r.json || r.raw).slice(0, 200)}`);
        continue;
      }
      const s = r.json?.summary || {};
      console.log(
        `batch ${i} | ${dur}s | targets:${s.targets_processed} | queued:${s.candidates_queued} | llm_calls:${s.llm_calls_made} | cost:${s.llm_cost_cents}c | errors:${s.targets_with_errors}`,
      );
      total.processed += s.targets_processed || 0;
      total.queued += s.candidates_queued || 0;
      total.llm_calls += s.llm_calls_made || 0;
      total.cost += s.llm_cost_cents || 0;
      if ((s.targets_processed || 0) === 0) {
        console.log("no more eligible targets");
        break;
      }
    }
    console.log("\nTOTAL:", JSON.stringify(total));
  } else if (mode === "warwick-google-places") {
    const r = await invoke("ingest-google-places", {
      regions: [{ name: "warwick", lat: 41.2545, lng: -74.359, radius_m: 50000 }],
      max_total_requests: 60,
    });
    console.log("status:", r.status);
    console.log("summary:", JSON.stringify(r.json?.summary, null, 2));
    console.log("budget:", JSON.stringify(r.json?.budget));
  } else if (mode === "discover-warwick") {
    const r = await invoke("discover-venues-to-crawl", {
      max_per_run: 100,
      bbox: { min_lat: 40.75, max_lat: 41.75, min_lng: -75.0, max_lng: -73.7 },
    });
    console.log("status:", r.status);
    console.log("summary:", JSON.stringify(r.json?.summary, null, 2));
  } else if (mode === "ingest-venue-website") {
    let total = { claimed: 0, processed: 0, events_found: 0, queued: 0, cost: 0, errors: 0 };
    for (let i = 1; i <= 5; i++) {
      const start = Date.now();
      const r = await invoke("ingest-venue-website", { max_per_run: 4 });
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      if (!r.ok) {
        console.log(`batch ${i} | ${dur}s | status=${r.status} | ${JSON.stringify(r.json || r.raw).slice(0, 200)}`);
        continue;
      }
      const j = r.json;
      console.log(
        `batch ${i} | ${dur}s | claimed:${j.summary?.claimed} | events:${j.summary?.events_found} | queued:${j.summary?.candidates_queued} | cost:${j.summary?.cost_cents}c | err:${j.summary?.errors}`,
      );
      total.claimed += j.summary?.claimed || 0;
      total.processed += j.summary?.processed || 0;
      total.events_found += j.summary?.events_found || 0;
      total.queued += j.summary?.candidates_queued || 0;
      total.cost += j.summary?.cost_cents || 0;
      total.errors += j.summary?.errors || 0;
      if ((j.summary?.claimed || 0) === 0) {
        console.log("no more eligible rows");
        break;
      }
    }
    console.log("\nTOTAL:", JSON.stringify(total));
  } else if (mode === "normalize") {
    const r = await invoke("normalize-raw-events", { max_items: 200 });
    console.log("status:", r.status);
    console.log("summary:", JSON.stringify(r.json?.summary, null, 2));
  } else {
    console.log("usage: npx tsx scripts/session_warwick_invocations.ts <mode>");
    console.log("modes: ingest-web-collector | warwick-google-places | discover-warwick | ingest-venue-website | normalize");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

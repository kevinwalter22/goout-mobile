// Read-only source-liveness FYI for the weekly maintainer report.
// Finds sources that fetch FINE (recent successful fetch, 0 errors, returned data)
// but have produced no genuinely-NEW event in 14+ days — "gone quiet". That's an
// observation (likely a settled catalog, occasionally a subtly-stuck fetcher worth a
// glance), NOT the source-liveness ALERT, which fires only on real breakage.
//
// Runs in the maintainer's GATHER step (bash) so SUPABASE_ACCESS_TOKEN stays scoped to
// that step and never reaches the Claude agent step. Prints a JSON array to stdout.
import https from "node:https";
import { Buffer } from "node:buffer";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.PROD_REF;
if (!TOKEN || !REF) {
  process.stdout.write(JSON.stringify({ note: "skipped — no prod token/ref" }));
  process.exit(0);
}

const QUERY = `
  with alive as (
    select es.id, es.name, es.type
    from event_sources es
    join fetch_partitions fp on fp.source_id = es.id
    where es.is_enabled and fp.is_enabled
      and fp.last_fetched_at > now() - make_interval(mins => greatest(coalesce(fp.fetch_interval_minutes,0)*3, 360))
      and coalesce((fp.last_result->>'errors')::int, 0) = 0
      and coalesce((fp.last_result->>'total_fetched')::int, 0) > 0
    group by es.id, es.name, es.type
  )
  select a.name, a.type,
    coalesce(round(extract(epoch from (now() - max(eir.created_at)))/86400)::int, 9999) as days_since_new_event
  from alive a
  left join event_ingest_raw eir on eir.source_id = a.id
  group by a.name, a.type
  having max(eir.created_at) is null or max(eir.created_at) < now() - interval '14 days'
  order by days_since_new_event desc;
`;

const body = JSON.stringify({ query: QUERY });
const req = https.request(
  {
    hostname: "api.supabase.com",
    path: `/v1/projects/${REF}/database/query`,
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      if (res.statusCode !== 200) {
        process.stdout.write(JSON.stringify({ note: `query failed (HTTP ${res.statusCode})` }));
        return;
      }
      // Pass through the array of quiet sources (possibly empty).
      process.stdout.write(d);
    });
  },
);
req.on("error", () => process.stdout.write(JSON.stringify({ note: "query error" })));
req.write(body);
req.end();

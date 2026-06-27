// EAS build/submit failure monitor (closes the --no-wait blind spot).
// Queries recent iOS builds + their submissions; if any ERRORED within the
// lookback window, posts a Slack alert. Run by scheduled-monitoring.yml.
// Env: EXPO_TOKEN (required), EAS_PROJECT_ID (required), SLACK_WEBHOOK_URL (optional),
//      EAS_LOOKBACK_HOURS (optional, default 5).
import https from "node:https";

const EXPO_TOKEN = process.env.EXPO_TOKEN;
const PID = process.env.EAS_PROJECT_ID;
const WEBHOOK = process.env.SLACK_WEBHOOK_URL || "";
const LOOKBACK_H = Number(process.env.EAS_LOOKBACK_HOURS || "5");
if (!EXPO_TOKEN || !PID) { console.log("EXPO_TOKEN / EAS_PROJECT_ID not set; skipping."); process.exit(0); }

function post(host, path, headers, body) {
  return new Promise((res, rej) => {
    const r = https.request({ hostname: host, path, method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) } },
      x => { let d = ""; x.on("data", c => d += c); x.on("end", () => res({ s: x.statusCode, d })); });
    r.on("error", rej); r.write(body); r.end();
  });
}

const query = `query($id:String!){app{byId(appId:$id){builds(limit:20,offset:0,filter:{platform:IOS}){status createdAt appBuildVersion buildProfile error{message} submissions{status}}}}}`;

(async () => {
  const r = await post("api.expo.dev", "/graphql",
    { "Content-Type": "application/json", Authorization: "Bearer " + EXPO_TOKEN },
    JSON.stringify({ query, variables: { id: PID } }));
  let builds;
  try { builds = JSON.parse(r.d).data.app.byId.builds; }
  catch { console.log("::warning::EAS query failed:", r.d.slice(0, 200)); process.exit(0); }

  const cutoff = Date.now() - LOOKBACK_H * 3600 * 1000;
  const recent = builds.filter(b => new Date(b.createdAt).getTime() >= cutoff);
  const buildFails = recent.filter(b => b.status === "ERRORED");
  const submitFails = recent.filter(b => (b.submissions || []).some(s => s.status === "ERRORED"));
  const failed = [...new Set([...buildFails, ...submitFails])];

  console.log(`Checked ${recent.length} build(s) in last ${LOOKBACK_H}h: ${buildFails.length} build-errored, ${submitFails.length} submit-errored.`);
  if (!failed.length) { console.log("EAS health OK."); return; }

  const lines = failed.map(b => {
    const why = b.status === "ERRORED" ? `build ERRORED${b.error ? " — " + b.error.message : ""}` : "submission ERRORED";
    return `• *${b.buildProfile}* ${b.appBuildVersion} (${b.createdAt.slice(0, 16)}): ${why}`;
  }).join("\n");
  console.log("::warning::EAS failures detected:\n" + lines);

  if (WEBHOOK) {
    await post(new URL(WEBHOOK).hostname, new URL(WEBHOOK).pathname + new URL(WEBHOOK).search,
      { "Content-Type": "application/json" },
      JSON.stringify({ attachments: [{ color: "#e5484d", blocks: [
        { type: "section", text: { type: "mrkdwn", text: `⛔ *EAS build/submit failure* _(last ${LOOKBACK_H}h)_` } },
        { type: "section", text: { type: "mrkdwn", text: lines } },
        { type: "context", elements: [{ type: "mrkdwn", text: "check-eas-health (scheduled-monitoring) — these fail server-side and don't surface in CI" }] },
      ] }] }));
    console.log("Posted Slack alert.");
  }
})();

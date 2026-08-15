// Open a staging->main promotion PR, wait for its test gate, merge, then drive
// the prod deploy up to the Production approval gate. Reports the run id to approve.
import https from "node:https";
const REPO = "kevinwalter22/goout-mobile";
const token = process.env.GITHUB_TOKEN;
function gh(method, path, body) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((res, rej) => {
    const r = https.request({ hostname: "api.github.com", path: `/repos/${REPO}${path}`, method,
      headers: { "User-Agent": "euda", Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } },
      x => { let d = ""; x.on("data", c => d += c); x.on("end", () => { try { res({ s: x.statusCode, b: d ? JSON.parse(d) : null }); } catch { res({ s: x.statusCode, b: d }); } }); });
    r.on("error", rej); if (data) r.write(data); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const GATE = /Lint, typecheck|Integration tests \(staging\)|Dependency audit|Secret scan|Security regression/;
(async () => {
  const prom = await gh("POST", "/pulls", { title: "Promote staging → main: TestFlight config + prod submit workflow + cloud-setup hardening", head: "staging", base: "main", body: "Syncs staging-ahead changes to main: eas.json TestFlight/ascAppId config, deploy-staging auto-submit, submit-production.yml (makes it runnable), and cloud-setup.sh hardening. Build-only prod deploy; no TestFlight submission.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" });
  if (!prom.b || !prom.b.number) { log("promotion PR failed:", JSON.stringify(prom.b).slice(0, 300)); return; }
  log("promotion PR #" + prom.b.number, "head", prom.b.head.sha.slice(0, 7));
  const sha = prom.b.head.sha;
  for (let i = 0; i < 60; i++) {
    const cr = ((await gh("GET", `/commits/${sha}/check-runs`)).b.check_runs || []).filter(c => c.app && c.app.slug === "github-actions" && GATE.test(c.name));
    const pend = cr.filter(c => c.status !== "completed");
    const fail = cr.filter(c => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion));
    if (fail.length) { log("promotion gate FAILED:", fail.map(f => f.name).join(",")); return; }
    if (cr.length && !pend.length) { log("promotion gate green"); break; }
    await sleep(20000);
  }
  const m = await gh("PUT", `/pulls/${prom.b.number}/merge`, { merge_method: "merge", commit_title: `Promote staging → main: TestFlight + prod submit + hardening (#${prom.b.number})` });
  if (!m.b || !m.b.merged) { log("merge failed:", JSON.stringify(m.b).slice(0, 300)); return; }
  log("merged promotion to main");
  await sleep(10000);
  const run = (await gh("GET", "/actions/workflows/deploy-production.yml/runs?branch=main&per_page=1")).b.workflow_runs[0];
  log("prod run", run.id);
  for (let i = 0; i < 40; i++) {
    const pd = (await gh("GET", `/actions/runs/${run.id}/pending_deployments`)).b;
    if (Array.isArray(pd) && pd.length) { log(`PROD AT GATE: ${pd[0].environment.name} (run ${run.id}) — approve to deploy`); return; }
    const rs = (await gh("GET", `/actions/runs/${run.id}`)).b;
    if (rs.status === "completed") { log("prod run completed before gate:", rs.conclusion); return; }
    await sleep(20000);
  }
  log("prod gate wait timeout (run " + run.id + ")");
})();

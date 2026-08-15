// Merge sweep fix PRs #53 + #54 to staging, then promote staging->main and
// drive the prod deploy to the approval gate. Reports the run id to approve.
import https from "node:https";
const REPO = "kevinwalter22/goout-mobile";
const token = process.env.GITHUB_TOKEN;
const FIX_PRS = [53, 54];
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
async function waitGate(sha, label) {
  for (let i = 0; i < 60; i++) {
    const cr = ((await gh("GET", `/commits/${sha}/check-runs`)).b.check_runs || []).filter(c => c.app && c.app.slug === "github-actions" && GATE.test(c.name));
    const pend = cr.filter(c => c.status !== "completed");
    const fail = cr.filter(c => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion));
    if (fail.length) { log(`${label}: GATE FAILED:`, fail.map(f => f.name).join(",")); return false; }
    if (cr.length && !pend.length) { log(`${label}: gate green`); return true; }
    await sleep(20000);
  }
  log(`${label}: gate timeout`); return false;
}
(async () => {
  for (const PR of FIX_PRS) {
    const pr = (await gh("GET", `/pulls/${PR}`)).b;
    if (pr.merged) { log(`#${PR} already merged`); continue; }
    if (!(await waitGate(pr.head.sha, `PR#${PR}`))) return;
    const m = await gh("PUT", `/pulls/${PR}/merge`, { merge_method: "squash" });
    if (!m.b || !m.b.merged) { log(`#${PR} merge failed:`, JSON.stringify(m.b).slice(0, 200)); return; }
    log(`merged #${PR} to staging`);
    await sleep(4000);
  }
  // wait for the latest staging deploy to finish (last merge's)
  await sleep(10000);
  const sRun = (await gh("GET", "/actions/workflows/deploy-staging.yml/runs?branch=staging&per_page=1")).b.workflow_runs[0];
  log("staging deploy run", sRun.id);
  for (let i = 0; i < 50; i++) {
    const r = (await gh("GET", `/actions/runs/${sRun.id}`)).b;
    if (r.status === "completed") { log("staging deploy:", r.conclusion); break; }
    await sleep(20000);
  }
  // promote staging -> main
  const prom = await gh("POST", "/pulls", { title: "Promote staging → main: sweep fixes (EAS-failure monitoring + doc refresh)", head: "staging", base: "main", body: "Promotes pre-launch sweep fixes #53 (EAS build/submit failure monitoring) + #54 (doc refresh / ladder) to main.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" });
  if (!prom.b || !prom.b.number) { log("promotion PR failed:", JSON.stringify(prom.b).slice(0, 200)); return; }
  log("promotion PR #" + prom.b.number, "head", prom.b.head.sha.slice(0, 7));
  if (!(await waitGate(prom.b.head.sha, "promotion"))) return;
  const pm = await gh("PUT", `/pulls/${prom.b.number}/merge`, { merge_method: "merge", commit_title: `Promote staging → main: sweep fixes (#${prom.b.number})` });
  if (!pm.b || !pm.b.merged) { log("promotion merge failed:", JSON.stringify(pm.b).slice(0, 200)); return; }
  log("merged promotion to main");
  await sleep(10000);
  const pRun = (await gh("GET", "/actions/workflows/deploy-production.yml/runs?branch=main&per_page=1")).b.workflow_runs[0];
  log("prod run", pRun.id);
  for (let i = 0; i < 40; i++) {
    const pd = (await gh("GET", `/actions/runs/${pRun.id}/pending_deployments`)).b;
    if (Array.isArray(pd) && pd.length) { log(`PROD AT GATE: ${pd[0].environment.name} (run ${pRun.id}) — approve to deploy`); return; }
    const rs = (await gh("GET", `/actions/runs/${pRun.id}`)).b;
    if (rs.status === "completed") { log("prod completed before gate:", rs.conclusion); return; }
    await sleep(20000);
  }
  log("prod gate timeout (run " + pRun.id + ")");
})();

// Phase 7 rollback orchestration: drive PR #41 (revert) through staging and
// into the gated prod deploy, stopping at the approval gate. Notifies via stdout.
import https from "node:https";
const REPO = "kevinwalter22/goout-mobile";
const token = process.env.GITHUB_TOKEN;
const PR = 41;

function gh(method, path, body) {
  const apiPath = path.startsWith("/") ? path : `/repos/${REPO}/${path}`;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: "api.github.com", path: apiPath, method,
      headers: { "User-Agent": "euda-rollback", Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { try { resolve({ s: res.statusCode, b: d ? JSON.parse(d) : null }); } catch { resolve({ s: res.statusCode, b: d }); } }); });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const GATE = /Lint, typecheck|Integration tests \(staging\)|Dependency audit|Secret scan|Security regression/;
async function waitGate(sha, label) {
  for (let i = 0; i < 50; i++) {
    const { b } = await gh("GET", `commits/${sha}/check-runs`);
    const cr = (b.check_runs || []).filter((c) => c.app && c.app.slug === "github-actions" && GATE.test(c.name));
    const pend = cr.filter((c) => c.status !== "completed");
    const fail = cr.filter((c) => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion));
    if (fail.length) { log(`${label}: GATE FAILED:`, fail.map((f) => f.name).join(",")); return false; }
    if (cr.length && pend.length === 0) { log(`${label}: gate green`); return true; }
    await sleep(20000);
  }
  log(`${label}: gate timeout`); return false;
}
async function waitRun(id, label) {
  for (let i = 0; i < 60; i++) {
    const { b } = await gh("GET", `actions/runs/${id}`);
    if (b.status === "completed") { log(`${label}: ${b.conclusion}`); return b.conclusion; }
    await sleep(20000);
  }
  log(`${label}: timeout`); return null;
}

(async () => {
  // 1. wait for #41 gate, merge to staging
  const pr = (await gh("GET", `pulls/${PR}`)).b;
  if (!(await waitGate(pr.head.sha, "PR#41"))) return;
  const m = await gh("PUT", `pulls/${PR}/merge`, { merge_method: "squash" });
  if (!m.b || !m.b.merged) { log("merge #41 failed:", JSON.stringify(m.b)); return; }
  log("merged #41 to staging");

  // 2. wait for staging deploy
  await sleep(10000);
  const sRun = (await gh("GET", `actions/workflows/deploy-staging.yml/runs?branch=staging&per_page=1`)).b.workflow_runs[0];
  log("staging deploy run", sRun.id);
  if ((await waitRun(sRun.id, "staging-deploy")) !== "success") { log("staging deploy not green; stopping"); return; }

  // 3. open staging->main promotion
  const prom = await gh("POST", "pulls", { title: "Promote staging → main: Phase 7 rollback (revert synthetic)", head: "staging", base: "main", body: "Final Phase 7 step — promotes the rollback (revert of the synthetic change) to prod through the gate.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" });
  if (!prom.b || !prom.b.number) { log("promotion PR failed:", JSON.stringify(prom.b)); return; }
  log("promotion PR #" + prom.b.number, "head", prom.b.head.sha.slice(0, 7));

  // 4. wait promotion gate, merge to main
  if (!(await waitGate(prom.b.head.sha, "promotion"))) return;
  const pm = await gh("PUT", `pulls/${prom.b.number}/merge`, { merge_method: "merge" });
  if (!pm.b || !pm.b.merged) { log("promotion merge failed:", JSON.stringify(pm.b)); return; }
  log("merged promotion to main");

  // 5. wait for prod run to reach the gate
  await sleep(10000);
  const pRun = (await gh("GET", `actions/workflows/deploy-production.yml/runs?branch=main&per_page=1`)).b.workflow_runs[0];
  log("prod run", pRun.id);
  for (let i = 0; i < 40; i++) {
    const pd = (await gh("GET", `actions/runs/${pRun.id}/pending_deployments`)).b;
    if (Array.isArray(pd) && pd.length) { log(`PROD AT GATE: ${pd[0].environment.name} (run ${pRun.id})`); return; }
    const rs = (await gh("GET", `actions/runs/${pRun.id}`)).b;
    if (rs.status === "completed") { log("prod run completed before gate:", rs.conclusion); return; }
    await sleep(20000);
  }
  log("prod gate wait timeout");
})();

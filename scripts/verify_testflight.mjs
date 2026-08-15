// Wait for PR #49 CI, merge to staging, re-dispatch deploy-staging, and report
// whether the EAS build+auto-submit step finally queues cleanly.
import https from "node:https";
const REPO = "kevinwalter22/goout-mobile";
const token = process.env.GITHUB_TOKEN;
const PR = 49;
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
  const pr = (await gh("GET", `/pulls/${PR}`)).b;
  for (let i = 0; i < 50; i++) {
    const cr = ((await gh("GET", `/commits/${pr.head.sha}/check-runs`)).b.check_runs || []).filter(c => c.app && c.app.slug === "github-actions" && GATE.test(c.name));
    const pend = cr.filter(c => c.status !== "completed");
    const fail = cr.filter(c => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion));
    if (fail.length) { log("PR#49 CI FAILED:", fail.map(f => f.name).join(",")); return; }
    if (cr.length && !pend.length) { log("PR#49 CI green"); break; }
    await sleep(20000);
  }
  const m = await gh("PUT", `/pulls/${PR}/merge`, { merge_method: "squash" });
  if (!m.b || !m.b.merged) { log("merge failed:", JSON.stringify(m.b)); return; }
  log("merged #49 to staging");
  await sleep(8000);
  await gh("POST", "/actions/workflows/deploy-staging.yml/dispatches", { ref: "staging" });
  log("dispatched deploy-staging");
  await sleep(12000);
  const run = (await gh("GET", "/actions/workflows/deploy-staging.yml/runs?branch=staging&event=workflow_dispatch&per_page=1")).b.workflow_runs[0];
  log("watching run", run.id);
  for (let i = 0; i < 50; i++) {
    const r = (await gh("GET", `/actions/runs/${run.id}`)).b;
    if (r.status === "completed") { log("deploy:", r.conclusion);
      const jobs = (await gh("GET", `/actions/runs/${run.id}/jobs`)).b.jobs;
      const dj = jobs.find(j => j.name.includes("Migrations"));
      if (dj) (dj.steps || []).filter(s => /EAS|App Store|Materialize/.test(s.name)).forEach(s => log("   - " + s.name + ": " + (s.conclusion || s.status)));
      return;
    }
    await sleep(20000);
  }
  log("run timeout");
})();

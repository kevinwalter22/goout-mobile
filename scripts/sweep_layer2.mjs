// Layer 2 verification: confirm CI checks fire on PR #52, merge to staging,
// then capture every staging-deploy step (migrations, functions, EAS build+submit,
// Slack). Reports the full evidence trail.
import https from "node:https";
const REPO = "kevinwalter22/goout-mobile";
const token = process.env.GITHUB_TOKEN;
const PR = 52;
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
(async () => {
  const pr = (await gh("GET", `/pulls/${PR}`)).b;
  log("PR head", pr.head.sha.slice(0, 7));
  let checks = [];
  for (let i = 0; i < 60; i++) {
    checks = ((await gh("GET", `/commits/${pr.head.sha}/check-runs`)).b.check_runs || []).filter(c => c.app && c.app.slug === "github-actions");
    const pend = checks.filter(c => c.status !== "completed");
    if (checks.length && !pend.length) break;
    await sleep(20000);
  }
  log("CI checks that ran:");
  checks.forEach(c => log("   • " + c.name + " = " + c.conclusion));
  const fail = checks.filter(c => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion));
  if (fail.length) { log("ABORT — CI failed:", fail.map(f => f.name).join(",")); return; }
  const m = await gh("PUT", `/pulls/${PR}/merge`, { merge_method: "squash" });
  if (!m.b || !m.b.merged) { log("merge failed:", JSON.stringify(m.b).slice(0, 200)); return; }
  log("merged #" + PR + " to staging");
  await sleep(10000);
  const run = (await gh("GET", "/actions/workflows/deploy-staging.yml/runs?branch=staging&per_page=1")).b.workflow_runs[0];
  log("staging deploy run", run.id);
  let final;
  for (let i = 0; i < 60; i++) {
    const r = (await gh("GET", `/actions/runs/${run.id}`)).b;
    if (r.status === "completed") { final = r.conclusion; break; }
    await sleep(20000);
  }
  log("staging deploy:", final);
  const jobs = (await gh("GET", `/actions/runs/${run.id}/jobs`)).b.jobs;
  jobs.forEach(j => {
    log("JOB " + j.name + " = " + j.conclusion);
    (j.steps || []).filter(s => /migrat|edge functions|EAS|App Store|Materialize|Slack/i.test(s.name))
      .forEach(s => log("     - " + s.name + ": " + (s.conclusion || s.status)));
  });
})();

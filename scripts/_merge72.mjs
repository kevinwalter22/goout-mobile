// Merge PR #72 (notability score, base=staging) after the test.yml gate is green.
// Loads GITHUB_TOKEN from .env.local (never printed). Squash-merges. Background-safe.
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
try {
  const txt = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) { let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
  }
} catch (e) { console.error("env load fail", e.message); }
const token = process.env.GITHUB_TOKEN; const PR = 72;
const GATE = /Lint, typecheck|Integration tests \(staging\)|Dependency audit|Secret scan|Security regression/;
if (!token) { console.error("no GITHUB_TOKEN"); process.exit(1); }
function api(m, p, b) { const data = b ? JSON.stringify(b) : null; return new Promise((res, rej) => { const r = https.request({ hostname: "api.github.com", path: p, method: m, headers: { "User-Agent": "euda", Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } }, x => { let d = ""; x.on("data", c => d += c); x.on("end", () => res({ s: x.statusCode, b: d ? JSON.parse(d) : null })); }); r.on("error", rej); if (data) r.write(data); r.end(); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
(async () => {
  const pr = (await api("GET", `/repos/kevinwalter22/goout-mobile/pulls/${PR}`)).b;
  if (!pr || !pr.head) { log("PR fetch failed"); return; }
  log(`#${PR} base=${pr.base.ref} head=${pr.head.ref} sha=${pr.head.sha.slice(0, 7)} state=${pr.state}`);
  if (pr.base.ref !== "staging") { log("ABORT: base is not staging"); return; }
  if (pr.state !== "open") { log("PR not open (already merged?)"); return; }
  const sha = pr.head.sha;
  for (let i = 0; i < 45; i++) {
    const cr = ((await api("GET", `/repos/kevinwalter22/goout-mobile/commits/${sha}/check-runs`)).b.check_runs || []).filter(c => GATE.test(c.name));
    const pend = cr.filter(c => c.status !== "completed");
    const fail = cr.filter(c => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion));
    if (fail.length) { log(`#${PR} GATE FAILED:`, fail.map(f => `${f.name}:${f.conclusion}`).join(", ")); return; }
    if (cr.length && !pend.length) {
      for (let t = 0; t < 5; t++) { const mg = await api("PUT", `/repos/kevinwalter22/goout-mobile/pulls/${PR}/merge`, { merge_method: "squash" }); if (mg.b?.merged) { log(`#${PR} MERGED ${mg.b.sha?.slice(0, 7)}`); return; } log(`attempt ${t + 1}: ${mg.s} ${JSON.stringify(mg.b).slice(0, 120)}`); await sleep(4000); }
      return;
    }
    log(`#${PR} waiting… ${cr.length} checks, ${pend.length} pending`); await sleep(20000);
  }
  log("timeout");
})();

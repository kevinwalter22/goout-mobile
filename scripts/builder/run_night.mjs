// Overnight builder orchestrator. Claims up to N ready tasks from build_tasks,
// schedules them under two hard rules, runs each through implement + self-test,
// and opens a needs_kevin PR per success. NEVER merges. NEVER runs while the
// build_queue_enabled kill-switch is OFF.
//
// PERMANENT RULES (per Kevin):
//  1. VISUAL tasks (spec.visual) MUST pass a screenshot-evaluate self-test. If a
//     screenshot can't be captured or confidently evaluated, the task flips to
//     needs_device and opens only a DRAFT (not merge-ready) PR — never ship a
//     visual change unseen.
//  2. Two tasks touching the SAME FILE never run in parallel on one night. A
//     same-file pair is allowed only when one stacks on the other (spec.stack_on
//     → serial, second branches off the first). Otherwise the lower-priority one
//     is deferred to a later night. Under-fill rather than create a merge mess.
//
// The prod service-role key lives ONLY in this orchestrator (claim/update). Each
// task's `claude -p` subprocess is spawned with a SCRUBBED env (no prod keys, no
// ANTHROPIC_API_KEY) — only the OAuth token + staging build env + staging creds.
import https from "node:https";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const REF = process.env.SUPABASE_PROD_PROJECT_REF;
const KEY = process.env.SUPABASE_PROD_SERVICE_ROLE_KEY;
const OAUTH = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || "kevinwalter22/goout-mobile";
const GH_TOKEN = process.env.GITHUB_TOKEN;
// PR-open MUST use a real PAT, not the Actions GITHUB_TOKEN: PRs opened by the
// Actions token are suppressed from triggering workflows, so test.yml never runs
// and the PR lands unmergeable (blocked on required checks) — which is what forced
// the manual CI-forcing + T8 re-creation on night one. A PAT opens the PR as a real
// user → CI fires automatically. Falls back to GITHUB_TOKEN if unset (PR opens, but
// without auto-CI — the pre-PAT behavior).
const PR_TOKEN = process.env.BUILDER_PR_TOKEN || process.env.GITHUB_TOKEN;
const SLACK = process.env.SLACK_CHIEF_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || "";
const BASE_BRANCH = "staging";
const WORKER = `nightly-builder-${new Date().toISOString().slice(0, 10)}`;

const reqOnce = (host, path, method, headers, body) => new Promise((res) => {
  const b = body ? JSON.stringify(body) : null;
  const r = https.request({ hostname: host, path, method, headers: { ...headers, ...(b ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) } : {}) } },
    (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { try { res({ status: x.statusCode, body: JSON.parse(d) }); } catch { res({ status: x.statusCode, body: d }); } }); });
  r.on("error", (e) => res({ status: 0, body: String(e) })); if (b) r.write(b); r.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Retry transient network failures (EPIPE / ECONNRESET → status 0; 5xx). A transient
// `write EPIPE` on both the PR-open AND the follow-up status write is exactly what
// stranded night-one's T7 (stuck in_progress, no PR). 4xx/2xx are definitive → no retry.
const req = async (host, path, method, headers, body) => {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await reqOnce(host, path, method, headers, body);
    if (last.status !== 0 && last.status < 500) return last;
    if (attempt < 3) await sleep(attempt * 1500);
  }
  return last;
};
const pg = (path, method = "GET", body) =>
  req(`${REF}.supabase.co`, `/rest/v1/${path}`, method, { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "return=representation" }, body);
const gh = (path, method = "GET", body) =>
  req("api.github.com", `/repos/${REPO}/${path}`, method, { "User-Agent": "euda-builder", Authorization: `Bearer ${PR_TOKEN}`, Accept: "application/vnd.github+json" }, body);
async function slack(text) { if (!SLACK) return; const u = new URL(SLACK); await req(u.hostname, u.pathname + u.search, "POST", {}, { blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }); }
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
const shOk = (cmd) => { try { sh(cmd); return true; } catch { return false; } };

async function updateTask(id, fields) { await pg(`build_tasks?id=eq.${id}`, "PATCH", fields); }

async function config() {
  const r = await pg("feature_flags?flag_name=eq.build_queue_guardrails&select=config_json");
  const g = (r.body && r.body[0] && r.body[0].config_json) || {};
  const k = await pg("feature_flags?flag_name=eq.build_queue_enabled&select=is_enabled");
  const enabled = !!(k.body && k.body[0] && k.body[0].is_enabled);
  return { enabled,
    maxTasks: g.max_tasks_per_night ?? 4, maxTurns: g.max_turns_per_task ?? 40,
    maxWall: g.max_wallclock_min_per_task ?? 30,
    // Visual tasks run the screenshot-evaluate loop (login + navigate + scroll +
    // screenshot + read + judge), which a measured known-good run took ~61 turns /
    // ~13 min to complete. Give them ~2x headroom; cost caps are the real backstop.
    maxTurnsVisual: g.max_turns_visual ?? 120, maxWallVisual: g.max_wallclock_min_visual ?? 45,
    maxCostTask: g.max_cost_usd_per_task ?? 8,
    maxCostNight: g.max_cost_usd_per_night ?? 25, model: g.model || "sonnet", lease: g.lease_minutes ?? 30 };
}

async function claim(lease) {
  const r = await pg("rpc/claim_build_task", "POST", { p_worker: WORKER, p_lease_minutes: lease });
  // Fail loudly on an RPC error — do NOT silently treat it as "no ready tasks".
  if (r.status >= 400 || (r.body && r.body.message)) {
    throw new Error("claim_build_task RPC failed: " + JSON.stringify(r.body).slice(0, 300));
  }
  return Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}

// Spec fields authored as a single string instead of an array must NOT crash the whole
// night. A malformed spec field should at most degrade its own task — never throw during
// scheduling and strand every claimed task (which is exactly what a string `files`/`context`
// did: `"...".map` / `"...".join` → TypeError before any task ran). Coerce defensively.
const asArr = (x) => (Array.isArray(x) ? x : x == null || x === "" ? [] : [x]);
const filesOf = (t) => asArr(t.spec?.files).map((f) => String(f).split(/[ (]/)[0].trim()).filter((f) => f.includes("/"));

function buildPrompt(t) {
  const s = t.spec || {}, a = t.acceptance || {};
  const visual = !!s.visual;
  return `You are the Euda overnight builder. Implement ONE task, self-test it thoroughly, and leave changes in the working tree. Do NOT commit, push, or open a PR — the harness handles that.

TASK: ${t.title}
WHY: ${s.why || ""}
FILES TO CHANGE: ${asArr(s.files).join(" | ")}
THE CHANGE: ${s.change || ""}
CONTEXT (read these to understand HOW): ${asArr(s.context).join(" | ")}
OUT OF SCOPE: ${s.out_of_scope || ""}

FUNCTIONAL SELF-TEST — run and iterate until all pass:
${(a.checks || []).map((c, i) => `${i + 1}. ${c}`).join("\n")}

${visual ? `VISUAL SELF-TEST — MANDATORY (never claim the fix works without SEEING it):
- Run 'npx expo export --platform web' (produces ./dist). Do NOT start a web server yourself.
- Capture the feed with the helper (it serves ./dist internally AND shuts the server down itself):
  \`TARGET_RE='<a text pattern your change produces>' OUT=builder-artifacts/${t.id}.png STAGING_EMAIL=$STAGING_EMAIL STAGING_PASSWORD=$STAGING_PASSWORD node scripts/builder/feed_screenshot.mjs\`
  (it spawns 'serve -s dist', logs into staging, opens the grouped Cards view, scrolls to your change, screenshots, and always kills its server. Extend it if your surface is the event-detail screen.)
- READ builder-artifacts/${t.id}.png with the Read tool and JUDGE it against: ${a.done_when || ""}
- NEVER run 'npx serve &' or leave any process backgrounded — a lingering server hangs your exit and the whole run gets killed (exit 143).
` : ""}
WRITE ./task-result.json:
{ "status": "pass" | "fail" | "needs_device",
  "functional_pass": <bool>, "visual": ${visual},
  "screenshot_captured": <bool>, "screenshot_path": "builder-artifacts/${t.id}.png",
  "screenshot_verdict": "yes" | "no" | null,
  "note": "<what you did, what you saw in the screenshot, honest caveats>" }

DECISION RULES:
- Visual task + you CANNOT capture a screenshot OR cannot confidently see the change is correct → status="needs_device" (do NOT claim pass). Never ship a visual change unseen.
- A functional check fails after real effort, or the change would need auth/RLS/DB-schema → status="fail" with the reason.
- Otherwise, everything green and (for visual) the screenshot confirms the change → status="pass".
Tier 1-2 only. Do NOT commit/push/PR. Leave changes in the working tree.`;
}

function runClaude(t, model, maxTurns, maxWallMin) {
  fs.mkdirSync("builder-artifacts", { recursive: true });
  fs.writeFileSync(`/tmp/prompt-${t.id}.md`, buildPrompt(t));
  // scrubbed env: no prod keys, no API key
  const env = { ...process.env };
  delete env.SUPABASE_PROD_SERVICE_ROLE_KEY; delete env.SUPABASE_PROD_PROJECT_REF;
  delete env.ANTHROPIC_API_KEY; delete env.SUPABASE_SERVICE_ROLE_KEY; delete env.GITHUB_TOKEN; delete env.BUILDER_PR_TOKEN;
  env.CLAUDE_CODE_OAUTH_TOKEN = OAUTH;
  const out = `builder-artifacts/${t.id}-claude.json`;
  const r = spawnSync("bash", ["-lc",
    `timeout ${maxWallMin * 60} claude -p "$(cat /tmp/prompt-${t.id}.md)" --model ${model} --max-turns ${maxTurns} ` +
    `--allowedTools "Read,Grep,Glob,Edit,Write,Bash" --dangerously-skip-permissions --output-format json > ${out} 2> builder-artifacts/${t.id}-err.log`],
    { env, encoding: "utf8", stdio: "pipe" });
  let usage = {};
  try { const j = JSON.parse(fs.readFileSync(out, "utf8")); usage = { cost: j.total_cost_usd ?? null, turns: j.num_turns ?? null }; } catch {}
  let result = null;
  try { result = JSON.parse(fs.readFileSync("task-result.json", "utf8")); } catch {}
  return { exit: r.status, usage, result };
}

async function main() {
  const cfg = await config();
  console.log("config:", JSON.stringify(cfg));
  if (!cfg.enabled) { console.log("build_queue_enabled = OFF → no-op."); await slack("🌙 *Nightly builder* — kill-switch OFF, nothing claimed."); return; }
  await slack(`🌙 *Nightly builder* starting — up to ${cfg.maxTasks} tasks (model ${cfg.model}).`);

  // Trust workspace for headless Claude
  shOk(`node -e "const fs=require('fs'),os=require('os'),p=require('path');const f=p.join(os.homedir(),'.claude.json');let j={};try{j=JSON.parse(fs.readFileSync(f,'utf8'))}catch{};j.projects=j.projects||{};j.projects[process.cwd()]=Object.assign({},j.projects[process.cwd()],{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true});fs.writeFileSync(f,JSON.stringify(j))"`);
  shOk(`git config user.email "builder@euda.live"; git config user.name "Euda Nightly Builder"`);

  // 1. Claim up to maxTasks
  const claimed = [];
  for (let i = 0; i < cfg.maxTasks; i++) { const t = await claim(cfg.lease); if (!t) break; claimed.push(t); }
  console.log(`claimed ${claimed.length}:`, claimed.map((t) => t.title));
  if (!claimed.length) { await slack("🌙 Nightly builder — no ready tasks."); return; }

  // 2. Schedule under Rule 2 (same-file → serial via stack_on, else defer)
  const byId = Object.fromEntries(claimed.map((t) => [t.id, t]));
  const touched = new Map(); // file -> task id that owns it tonight
  const scheduled = [], deferred = [];
  // order: stack parents first, then by priority
  const order = [...claimed].sort((a, b) => (a.spec?.stack_on ? 1 : 0) - (b.spec?.stack_on ? 1 : 0) || a.priority - b.priority);
  for (const t of order) {
    const stackParent = t.spec?.stack_on && byId[t.spec.stack_on] ? t.spec.stack_on : null;
    const collide = filesOf(t).find((f) => touched.has(f) && touched.get(f) !== stackParent);
    if (collide && !stackParent) { deferred.push(t); continue; } // Rule 2: defer
    scheduled.push({ t, stackParent });
    for (const f of filesOf(t)) touched.set(f, t.id);
  }
  // release deferred back to ready
  for (const t of deferred) { await updateTask(t.id, { status: "ready", claimed_by: null, claimed_at: null, lease_expires_at: null, blocked_reason: null }); console.log("deferred (same-file):", t.title); }

  // 3. Work scheduled tasks
  let nightCost = 0;
  const branchOf = {}; // task id -> branch (for stacked children)
  for (const { t, stackParent } of scheduled) {
    if (nightCost >= cfg.maxCostNight) { await updateTask(t.id, { status: "ready", claimed_by: null, claimed_at: null, lease_expires_at: null }); console.log("night cost cap → releasing", t.title); continue; }
    const base = stackParent && branchOf[stackParent] ? branchOf[stackParent] : BASE_BRANCH;
    const branch = `chief/${String(t.id).slice(0, 8)}-${t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30).replace(/-$/, "")}`;
    await updateTask(t.id, { status: "in_progress" });
    sh(`git checkout ${base} && git pull --ff-only origin ${base} 2>/dev/null || git checkout ${base}`);
    shOk(`git checkout -B ${branch}`);

    // Visual tasks get the higher turn/wall caps (the screenshot loop is turn-heavy).
    const isVisual = !!t.spec?.visual;
    const { exit, usage, result } = runClaude(t, cfg.model, isVisual ? cfg.maxTurnsVisual : cfg.maxTurns, isVisual ? cfg.maxWallVisual : cfg.maxWall);
    nightCost += usage.cost || 0;
    console.log(`task ${t.title}: exit=${exit} cost=${usage.cost} turns=${usage.turns} result=${JSON.stringify(result)?.slice(0, 200)}`);

    // ── Outcome ─────────────────────────────────────────────────────────
    const st = result?.status;
    const guardrailHit = (usage.cost || 0) > cfg.maxCostTask;
    const capOrCrash = !result && exit !== 0; // killed by --max-turns / wall timeout / crash before writing a result
    const hasChanges = sh("git status --porcelain").trim().length > 0; // builder scratch is gitignored → real source only
    const visualUnseen = isVisual && (st !== "pass" || !result?.screenshot_captured || result?.screenshot_verdict !== "yes");

    // Nothing salvageable in the working tree → block (no PR).
    if (!hasChanges) {
      const why = st === "fail" ? (result?.note || "self-test failed")
        : capOrCrash ? `no result (exit ${exit}${usage.turns ? `, ${usage.turns} turns` : ""}) — likely hit ${isVisual ? "turn/time cap" : "cap"} — and no changes`
        : "no changes produced";
      await updateTask(t.id, { status: "blocked", blocked_reason: why.slice(0, 400) });
      await slack(`🔴 *${t.title}* — blocked (${why.slice(0, 140)}). $${usage.cost ?? "?"} / ${usage.turns ?? "?"} turns.`);
      continue;
    }

    // There ARE changes — preserve them. A clean pass is merge-ready; anything else
    // (cap-hit partial, over-cost, self-declared fail, unseen visual) is a DRAFT so a
    // near-complete task never vanishes to a hard kill.
    const cleanPass = st === "pass" && !guardrailHit && !visualUnseen;
    const draft = !cleanPass;
    const partialReason = guardrailHit ? `over cost cap ($${usage.cost} > $${cfg.maxCostTask})`
      : capOrCrash ? `PARTIAL — hit ${isVisual ? "turn/time" : ""} cap at ${usage.turns ?? "?"} turns, needs continuation`
      : st === "fail" ? `self-test failed but left changes: ${(result?.note || "").slice(0, 120)}`
      : st === "needs_device" ? "needs on-device visual verification"
      : visualUnseen ? "visual change could not be self-verified in-run"
      : "";

    sh(`git add -A && git commit -q -m ${JSON.stringify(`feat(builder): ${t.title}\n\n${result?.note || partialReason}\n\nAutonomous overnight builder — task ${t.id}. ${draft ? `DRAFT: ${partialReason}.` : `Self-tested (functional${isVisual ? " + screenshot" : ""}).`}\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)}`);
    if (!shOk(`git push -u origin ${branch}`)) { await updateTask(t.id, { status: "blocked", blocked_reason: "push failed" }); await slack(`🔴 *${t.title}* — push failed.`); continue; }
    branchOf[t.id] = branch;

    const body = `Autonomous overnight builder — task \`${t.id}\`.\n\n**Self-test:** ${result?.note || "_(no result file — task was cut off before it could self-report)_"}\n\n${draft ? `⚠️ **DRAFT — ${partialReason}. Do not merge as-is.**` : (isVisual ? "✅ Screenshot self-test confirmed the change (see the run's nightly-builder artifact)." : "✅ Functional self-test passed (non-visual).")}\n\nTier ${t.tier} · ${draft ? "needs Kevin" : "review + merge"}. 🤖 overnight builder`;
    const pr = await gh("pulls", "POST", { title: `${draft ? "[draft] " : ""}${t.title}`, head: branch, base: stackParent ? (branchOf[stackParent] || BASE_BRANCH) : BASE_BRANCH, body, draft });
    const url = pr.body?.html_url || null;
    if (!url) {
      // PR auto-open failed — the branch IS pushed, so work is safe; flag loudly, don't fake needs_kevin.
      console.error("PR open failed:", JSON.stringify(pr).slice(0, 400));
      await updateTask(t.id, { status: "blocked", blocked_reason: `PR auto-open failed (branch ${branch} pushed — open manually): ${JSON.stringify(pr.body).slice(0, 180)}`, result: (result?.note || partialReason).slice(0, 500) });
      await slack(`🟠 *${t.title}* — implemented + pushed \`${branch}\` but PR auto-open FAILED. Open it manually. $${usage.cost ?? "?"} / ${usage.turns ?? "?"} turns.`);
      continue;
    }
    await updateTask(t.id, { status: "needs_kevin", needs_device: st === "needs_device" || visualUnseen, pr_url: url, result: (result?.note || partialReason).slice(0, 500) });
    await slack(`${cleanPass ? "✅" : "🟠"} *${t.title}* → ${cleanPass ? "PR (review + merge)" : `DRAFT PR (${partialReason.slice(0, 60)})`} ${url} · $${usage.cost ?? "?"} / ${usage.turns ?? "?"} turns.`);
  }
  await slack(`🌙 Nightly builder done — ${scheduled.length} worked, ${deferred.length} deferred, ~$${nightCost.toFixed(2)} total.`);
}
main().catch(async (e) => { console.error(e); await slack(`🔴 Nightly builder crashed: ${String(e).slice(0, 300)}`); process.exit(1); });

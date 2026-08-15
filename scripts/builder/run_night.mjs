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
const SLACK = process.env.SLACK_CHIEF_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || "";
const BASE_BRANCH = "staging";
const WORKER = `nightly-builder-${new Date().toISOString().slice(0, 10)}`;

const req = (host, path, method, headers, body) => new Promise((res) => {
  const b = body ? JSON.stringify(body) : null;
  const r = https.request({ hostname: host, path, method, headers: { ...headers, ...(b ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) } : {}) } },
    (x) => { let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => { try { res({ status: x.statusCode, body: JSON.parse(d) }); } catch { res({ status: x.statusCode, body: d }); } }); });
  r.on("error", (e) => res({ status: 0, body: String(e) })); if (b) r.write(b); r.end();
});
const pg = (path, method = "GET", body) =>
  req(`${REF}.supabase.co`, `/rest/v1/${path}`, method, { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "return=representation" }, body);
const gh = (path, method = "GET", body) =>
  req("api.github.com", `/repos/${REPO}/${path}`, method, { "User-Agent": "euda-builder", Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" }, body);
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
    maxWall: g.max_wallclock_min_per_task ?? 30, maxCostTask: g.max_cost_usd_per_task ?? 8,
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

const filesOf = (t) => (t.spec?.files || []).map((f) => String(f).split(/[ (]/)[0].trim()).filter((f) => f.includes("/"));

function buildPrompt(t) {
  const s = t.spec || {}, a = t.acceptance || {};
  const visual = !!s.visual;
  return `You are the Euda overnight builder. Implement ONE task, self-test it thoroughly, and leave changes in the working tree. Do NOT commit, push, or open a PR — the harness handles that.

TASK: ${t.title}
WHY: ${s.why || ""}
FILES TO CHANGE: ${(s.files || []).join(" | ")}
THE CHANGE: ${s.change || ""}
CONTEXT (read these to understand HOW): ${(s.context || []).join(" | ")}
OUT OF SCOPE: ${s.out_of_scope || ""}

FUNCTIONAL SELF-TEST — run and iterate until all pass:
${(a.checks || []).map((c, i) => `${i + 1}. ${c}`).join("\n")}

${visual ? `VISUAL SELF-TEST — MANDATORY (never claim the fix works without SEEING it):
- After 'npx expo export --platform web' succeeds: serve it (\`npx --yes serve -s dist -l 8080 &\`, wait ~5s), then capture the feed:
  \`TARGET_RE='<a text pattern your change produces>' OUT=builder-artifacts/${t.id}.png STAGING_EMAIL=$STAGING_EMAIL STAGING_PASSWORD=$STAGING_PASSWORD node scripts/builder/feed_screenshot.mjs\`
  (that helper logs into staging, opens the grouped Cards view, and scrolls to your change. Extend it if your surface is the event-detail screen.)
- READ builder-artifacts/${t.id}.png with the Read tool and JUDGE it against: ${a.done_when || ""}
- Then kill the server: \`pkill -f "serve -s dist" || true\`.
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
  delete env.ANTHROPIC_API_KEY; delete env.SUPABASE_SERVICE_ROLE_KEY; delete env.GITHUB_TOKEN;
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

    const { exit, usage, result } = runClaude(t, cfg.model, cfg.maxTurns, cfg.maxWall);
    nightCost += usage.cost || 0;
    console.log(`task ${t.title}: exit=${exit} cost=${usage.cost} turns=${usage.turns} result=${JSON.stringify(result)?.slice(0, 200)}`);

    // guardrail: per-task cost
    const guardrailHit = (usage.cost || 0) > cfg.maxCostTask;
    const st = result?.status;
    const visualUnseen = t.spec?.visual && (st !== "pass" || !result?.screenshot_captured || result?.screenshot_verdict !== "yes");

    if (guardrailHit || st === "fail" || (!result && exit !== 0)) {
      await updateTask(t.id, { status: "blocked", blocked_reason: guardrailHit ? `cost $${usage.cost} > cap $${cfg.maxCostTask}` : (result?.note || "self-test failed / no result").slice(0, 400) });
      await slack(`🔴 *${t.title}* — blocked (${guardrailHit ? "cost cap" : "self-test failed"}). $${usage.cost ?? "?"} / ${usage.turns ?? "?"} turns.`);
      continue;
    }
    // Rule 1: visual must be seen
    const draft = st === "needs_device" || visualUnseen;
    const noChanges = !shOk("git diff --quiet --exit-code") ? false : true; // shOk true = clean tree = no changes
    if (noChanges) {
      await updateTask(t.id, { status: "blocked", blocked_reason: "no changes produced" });
      await slack(`🔴 *${t.title}* — blocked (no changes produced).`); continue;
    }
    sh(`git add -A && git commit -q -m ${JSON.stringify(`feat(builder): ${t.title}\n\n${result?.note || ""}\n\nAutonomous overnight builder — task ${t.id}. ${draft ? "DRAFT: needs on-device visual verification." : "Self-tested (functional" + (t.spec?.visual ? " + screenshot" : "") + ")."}\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)}`);
    if (!shOk(`git push -u origin ${branch}`)) { await updateTask(t.id, { status: "blocked", blocked_reason: "push failed" }); continue; }
    branchOf[t.id] = branch;

    const body = `Autonomous overnight builder — task \`${t.id}\`.\n\n**Self-test:** ${result?.note || ""}\n\n${t.spec?.visual ? (draft ? "⚠️ **Visual result could not be self-verified — DRAFT, needs on-device check before merge.**" : "✅ Screenshot self-test confirmed the change (see builder-artifacts).") : "Functional self-test only (non-visual)."}\n\nTier ${t.tier} · ${draft ? "needs_device" : "review + merge"}. 🤖 overnight builder`;
    const pr = await gh("pulls", "POST", { title: `${draft ? "[needs-device] " : ""}${t.title}`, head: branch, base: stackParent ? (branchOf[stackParent] || BASE_BRANCH) : BASE_BRANCH, body, draft });
    const url = pr.body?.html_url || null;
    if (draft) await updateTask(t.id, { status: "needs_kevin", needs_device: true, pr_url: url, result: (result?.note || "").slice(0, 500) });
    else await updateTask(t.id, { status: "needs_kevin", pr_url: url, result: (result?.note || "").slice(0, 500) });
    await slack(`${draft ? "🟠" : "✅"} *${t.title}* → ${draft ? "DRAFT PR (needs device)" : "PR (needs review)"} ${url || ""} · $${usage.cost ?? "?"} / ${usage.turns ?? "?"} turns.`);
  }
  await slack(`🌙 Nightly builder done — ${scheduled.length} worked, ${deferred.length} deferred, ~$${nightCost.toFixed(2)} total.`);
}
main().catch(async (e) => { console.error(e); await slack(`🔴 Nightly builder crashed: ${String(e).slice(0, 300)}`); process.exit(1); });

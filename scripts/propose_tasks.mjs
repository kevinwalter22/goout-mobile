// propose_tasks.mjs — the read-agent → build_tasks write-path.
//
// A read-worker's Claude step (keyless, contents:read) writes proposed tasks to a JSON
// file; THIS runs in a separate workflow step WITH the staging service key and inserts
// them as status='proposed' via the propose_build_task RPC. Agents never touch 'ready' —
// that's Kevin's promote gate. Keeps the DB key out of the Claude step (same security
// model as the Slack post-step).
//
// Usage: node scripts/propose_tasks.mjs <proposed-tasks.json> <agent>
// Env:   STG_URL + STG_KEY  (staging queue URL + service-role key; falls back to
//        SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Also posts a one-line Slack digest
//        via SLACK_CHIEF_WEBHOOK_URL (or SLACK_WEBHOOK_URL) if set.
//
// Input JSON: array of { title, tier, priority?, spec:{why,files,change,context,out_of_scope}, acceptance:{checks} }
// Each is spec-gated (enforce_build_task_spec) + capped per agent per day server-side;
// a bad/vague proposal is refused and reported, never queued.

import fs from "node:fs";

const [file, agent] = process.argv.slice(2);
if (!file || !agent) { console.error("usage: propose_tasks.mjs <file.json> <agent>"); process.exit(2); }
if (!fs.existsSync(file)) { console.log(`no ${file} — agent proposed nothing this run.`); process.exit(0); }

const URL = process.env.STG_URL || process.env.SUPABASE_URL;
const KEY = process.env.STG_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("missing STG_URL/STG_KEY (or SUPABASE_URL/KEY)"); process.exit(1); }
const SLACK = process.env.SLACK_CHIEF_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
const CAP = Number(process.env.PROPOSE_CAP || 5);

let items;
try { items = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error("bad JSON:", e.message); process.exit(1); }
if (!Array.isArray(items)) { console.error("expected a JSON array"); process.exit(1); }
items = items.slice(0, CAP); // client-side cap too (server enforces the real one)

async function rpc(name, body) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

const proposed = [], refused = [];
for (const it of items) {
  if (!it || !it.title || !it.spec || !it.acceptance) { refused.push({ title: it?.title || "(untitled)", why: "missing title/spec/acceptance" }); continue; }
  const res = await rpc("propose_build_task", {
    p_title: it.title, p_tier: it.tier ?? 2, p_spec: it.spec, p_acceptance: it.acceptance,
    p_agent: agent, p_priority: it.priority ?? 50, p_cap: CAP,
  });
  if (res.ok) proposed.push(it.title);
  else refused.push({ title: it.title, why: res.text.replace(/\s+/g, " ").slice(0, 140) });
}

console.log(`proposed ${proposed.length}/${items.length} as '${agent}':`);
proposed.forEach((t) => console.log("  ✓", t));
refused.forEach((r) => console.log("  ✗", r.title, "—", r.why));

if (SLACK && (proposed.length || refused.length)) {
  const lines = [
    `*🗒️ ${agent} proposed ${proposed.length} task${proposed.length === 1 ? "" : "s"}* — review + promote the good ones (\`node scripts/promote_task.mjs list\`):`,
    ...proposed.map((t) => `• ${t}`),
    ...(refused.length ? [`_${refused.length} refused (spec/cap): ${refused.map((r) => r.title).join(", ")}_`] : []),
  ].join("\n");
  await fetch(SLACK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: lines }) }).catch(() => {});
}

#!/usr/bin/env node
// cost_watch.mjs — weekly deterministic cost report (NO LLM, so it costs ~$0 to run).
//
// Surfaces the three things that historically blew up the bill BEFORE they hit the
// receipt, and pings Slack the moment any of them crosses a threshold:
//   A. Supabase idle compute — # of live projects + any non-default branch DBs
//      (a stray branch = ~$10/mo of 24/7 compute for nothing; that was the Aug leak).
//   B. Claude API metered spend — requests-vs-cap per service from api_usage_counters
//      (the agents run on Kevin's subscription; only the ingestion/notability edge
//      functions are metered, and each is request-capped).
//   C. EAS builds this month vs the 22/mo free cap ($2/build over).
//
// Runs from .github/workflows/cost-watch.yml on a weekly cron. Inert (exit 0, no post)
// until the secrets exist, mirroring the worker-*.yml "inert until wired" convention.
//
// Env (all from GH secrets): SUPABASE_ACCESS_TOKEN, SUPABASE_PROD_PROJECT_REF,
// EXPO_TOKEN, SLACK_CHIEF_WEBHOOK_URL, SLACK_ALERT_MENTION (optional), EAS_BUILD_CAP.

import { execSync } from "node:child_process";

const {
  SUPABASE_ACCESS_TOKEN,
  SUPABASE_PROD_PROJECT_REF,
  EXPO_TOKEN,
  SLACK_ALERT_MENTION = "",
  EAS_BUILD_CAP = "22",
} = process.env;

// Prefer the dedicated #euda-chief webhook; fall back to #euda-monitoring
// (SLACK_WEBHOOK_URL) — same convention as scripts/worker_slack.mjs. The chief
// webhook is optional; SLACK_CHIEF_WEBHOOK_URL is not a repo secret today, so the
// fallback is what actually posts.
const SLACK_WEBHOOK = process.env.SLACK_CHIEF_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || "";

const BUILD_CAP = Number(EAS_BUILD_CAP) || 22;
const BUILD_WARN = Math.ceil(BUILD_CAP * 0.8); // amber at 80% of cap

// api_usage_counters.requests_used means different things per service:
//   - anthropic_*  → accumulates CENTS of spend (the edge fns increment by cost_cents),
//     so dollars = value/100 EXACTLY (not an estimate), and the cap is a cents budget.
//   - google_places / predicthq → accumulates CALL COUNT; est $ via a per-call list price.
const CENTS_SERVICES = new Set(["anthropic_haiku", "anthropic_opus_notability"]);
const USD_PER_CALL = { google_places: 0.017, predicthq: 0.0 };
// The one line that grows with ingestion (sources × cities × churn) — called out weekly.
const PRIMARY_VARIABLE = "anthropic_haiku";

const flags = []; // human-readable threshold breaches → drive the @-mention

async function mgmt(path, init = {}) {
  const r = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`mgmt ${path} → ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

async function sql(query) {
  return mgmt(`/v1/projects/${SUPABASE_PROD_PROJECT_REF}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });
}

// ── A. Supabase compute ──────────────────────────────────────────────────────
async function supabaseSection() {
  const lines = [];
  const projects = await mgmt("/v1/projects");
  const active = projects.filter((p) => p.status !== "INACTIVE");
  lines.push(`• *Projects live:* ${active.length} (${active.map((p) => p.name).join(", ")})`);

  let orphanBranches = 0;
  for (const p of active) {
    let branches = [];
    try {
      branches = await mgmt(`/v1/projects/${p.id}/branches`);
    } catch {
      continue; // branching not enabled on this project → no branches endpoint
    }
    const nonDefault = (branches || []).filter((b) => !b.is_default);
    orphanBranches += nonDefault.length;
    for (const b of nonDefault) {
      lines.push(
        `• ⚠️ *Branch DB alive:* \`${b.name}\` on ${p.name} (ref ${b.project_ref}) — ephemeral branches should be torn down; this is ~$10/mo of 24/7 compute.`
      );
    }
  }
  if (orphanBranches > 0) {
    flags.push(`${orphanBranches} orphaned branch DB${orphanBranches > 1 ? "s" : ""}`);
  } else {
    lines.push("• Branch DBs: none (good — no idle-branch leak).");
  }
  return lines.join("\n");
}

// ── B. Claude / Google API metered spend ─────────────────────────────────────
async function apiSection() {
  const rows = await sql(
    `select service, sum(requests_used)::int reqs, max(requests_limit)::int lim
       from api_usage_counters
      where period_start >= date_trunc('month', now())::date
      group by service order by reqs desc`
  );
  const lines = [];
  let total = 0;
  for (const { service, reqs, lim } of rows) {
    const pct = lim ? Math.round((reqs / lim) * 100) : 0;
    const bar = pct >= 80 ? "🔴" : pct >= 50 ? "🟠" : "🟢";
    const tag = service === PRIMARY_VARIABLE ? "  ← variable cost to watch (scales with ingestion)" : "";
    if (CENTS_SERVICES.has(service)) {
      const usd = reqs / 100; // counter IS cents → exact spend
      const budget = lim / 100; // cap is a cents budget
      total += usd;
      lines.push(`• ${bar} \`${service}\`: $${usd.toFixed(2)} / $${budget.toFixed(0)} budget (${pct}%)${tag}`);
      if (lim && reqs / lim >= 0.8) flags.push(`${service} at ${pct}% of $${budget.toFixed(0)} budget`);
    } else {
      const est = reqs * (USD_PER_CALL[service] ?? 0);
      total += est;
      lines.push(`• ${bar} \`${service}\`: ${reqs.toLocaleString()} calls (${pct}% of cap) ≈ $${est.toFixed(2)} est`);
      if (lim && reqs / lim >= 0.8) flags.push(`${service} at ${pct}% of call cap`);
    }
  }
  lines.push(`• *Metered LLM/API this month: ~$${total.toFixed(2)}* (agents run on subscription → $0 metered)`);
  return lines.join("\n");
}

// ── C. EAS builds vs the monthly cap ─────────────────────────────────────────
async function easSection() {
  if (!EXPO_TOKEN) return "• EAS: skipped (no EXPO_TOKEN).";
  let builds;
  try {
    const out = execSync(
      "npx --yes eas-cli@latest build:list --platform ios --limit 50 --non-interactive --json",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: process.env, maxBuffer: 10 * 1024 * 1024 }
    );
    // eas-cli can emit a notice line before the JSON array — parse from the first '['.
    const start = out.indexOf("[");
    if (start < 0) throw new Error("no JSON array in output");
    builds = JSON.parse(out.slice(start));
  } catch (e) {
    return `• EAS: build:list unavailable (${String(e.message).slice(0, 80)}).`;
  }
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const mtd = builds.filter((b) => new Date(b.createdAt) >= monthStart);
  const byProfile = {};
  for (const b of mtd) byProfile[b.buildProfile] = (byProfile[b.buildProfile] || 0) + 1;
  const total = mtd.length;
  const bar = total > BUILD_CAP ? "🔴" : total >= BUILD_WARN ? "🟠" : "🟢";
  const detail = Object.entries(byProfile)
    .map(([p, n]) => `${p} ${n}`)
    .join(", ");
  if (total > BUILD_CAP) flags.push(`EAS builds ${total}/${BUILD_CAP} — OVER cap ($2/build over)`);
  else if (total >= BUILD_WARN) flags.push(`EAS builds ${total}/${BUILD_CAP} — approaching cap`);
  return `• ${bar} *EAS iOS builds this month:* ${total}/${BUILD_CAP} (${detail || "none"})`;
}

// ── D. Autonomous load vs the shared subscription pool ───────────────────────
// The agents + builder run on Kevin's Max subscription (one shared quota with his
// interactive use). Anthropic doesn't expose a "% of weekly quota remaining" to CI,
// so the honest early-warning signal is AUTONOMOUS RUN-LOAD: how much the scheduled
// agents ran this week. A spike here (new autonomous work, or the builder churning
// many tasks/night) is what would start eating into interactive headroom — visible
// here before it becomes a mid-work wall. Definitive quota view is `/usage` in-app.
async function autonomousLoadSection() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // owner/repo — auto-set in Actions
  if (!token || !repo) return "• Autonomous load: skipped (no GITHUB_TOKEN/repo).";
  const WFS = ["worker-auditor.yml", "worker-maintainer.yml", "worker-researcher.yml", "nightly-builder.yml"];
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  let runs = 0;
  let minutes = 0;
  const per = [];
  for (const wf of WFS) {
    try {
      const r = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${wf}/runs?created=%3E%3D${since}&per_page=100`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const list = j.workflow_runs || [];
      let m = 0;
      for (const run of list) {
        if (run.run_started_at && run.updated_at) {
          m += Math.max(0, (new Date(run.updated_at) - new Date(run.run_started_at)) / 60000);
        }
      }
      runs += list.length;
      minutes += m;
      if (list.length) per.push(`${wf.replace(/\.yml$/, "").replace(/^worker-/, "")} ${list.length}`);
    } catch {
      /* skip a workflow that errors */
    }
  }
  const mins = Math.round(minutes);
  const bar = mins > 300 ? "🔴" : mins > 120 ? "🟠" : "🟢";
  if (mins > 300) flags.push(`autonomous run-load ${mins}min/wk — high, may pressure your quota`);
  else if (mins > 120) flags.push(`autonomous run-load ${mins}min/wk — climbing`);
  return (
    `• ${bar} *Autonomous run-load (7d):* ${runs} runs, ${mins} min wall-clock (${per.join(", ") || "none"})\n` +
    `• Baseline ≈ 3 weekly workers + nightly builder. Agents/builder are on your subscription ($0 metered); this is the headroom leading-indicator — definitive quota is \`/usage\` in-app.`
  );
}

// ── E. Posting loop health (Phase 3 · Act 1) ─────────────────────────────────
// "Are people actually posting?" — the deterministic weekly read on the crown-
// jewel loop. Reuses the posting_loop_health() RPC (migration 175, the same
// source the auditor scores) for this 7-day window vs. the prior one. Purely
// informational (no flag) — it's a usage signal, not a cost breach. If the RPC
// isn't on prod yet (before the gated deploy of 175), it errors → caught below.
async function postingLoopSection() {
  const rows = await sql(
    `select
       public.posting_loop_health(now() - interval '7 days',  now())                          as cur,
       public.posting_loop_health(now() - interval '14 days', now() - interval '7 days')       as prev`
  );
  const r = rows?.[0];
  if (!r) return "• Posting loop: no data.";
  const cur = r.cur || {};
  const prev = r.prev || {};
  const cp = cur.posts || {};
  const pp = prev.posts || {};
  const cf = cur.funnel || {};
  const total = cp.total ?? 0;
  const prevTotal = pp.total ?? 0;
  const arrow = total > prevTotal ? "▲" : total < prevTotal ? "▼" : "▬";
  if (total === 0 && prevTotal === 0) {
    return "• 🟣 *Posting loop:* no posts in the last 14 days (loop is live but unused — worth a look).";
  }
  const route = cp.by_route || {};
  const link = cp.by_link || {};
  const started = cf.started ?? 0;
  const completed = cf.completed ?? 0;
  const abandonPct = started > 0 ? Math.round(((started - completed) / started) * 100) : null;
  const lines = [
    `• 🟣 *Posts (7d):* ${total} ${arrow} (prev ${prevTotal}) · ${cp.distinct_posters ?? 0} poster${(cp.distinct_posters ?? 0) === 1 ? "" : "s"}`,
    `• *Route:* ${route.post_first ?? 0} post-first · ${route.item_gated ?? 0} check-in${(route.unknown ?? 0) ? ` · ${route.unknown} pre-instrumentation` : ""}`,
    `• *Link:* ${link.linked ?? 0} linked-at-place · ${link.my_location ?? 0} My-Location · ${cp.verified_at_event ?? 0} verified-at-event`,
  ];
  if (started > 0) {
    lines.push(`• *Funnel:* ${started} opened → ${completed} posted${abandonPct != null ? ` (${abandonPct}% didn't finish)` : ""}`);
  }
  return lines.join("\n");
}

async function main() {
  if (!SUPABASE_ACCESS_TOKEN || !SUPABASE_PROD_PROJECT_REF || !SLACK_WEBHOOK) {
    console.log("cost_watch: required secrets missing — inert (no post).");
    return;
  }

  const [supa, api, eas, load, posting] = await Promise.all([
    supabaseSection().catch((e) => `• Supabase section failed: ${e.message}`),
    apiSection().catch((e) => `• API section failed: ${e.message}`),
    easSection().catch((e) => `• EAS section failed: ${e.message}`),
    autonomousLoadSection().catch((e) => `• Autonomous load failed: ${e.message}`),
    postingLoopSection().catch((e) => `• Posting loop: unavailable (${String(e.message).slice(0, 80)}).`),
  ]);

  const header = flags.length
    ? `💸 *Weekly cost watch* — ${flags.length} thing${flags.length > 1 ? "s" : ""} to look at${SLACK_ALERT_MENTION ? " " + SLACK_ALERT_MENTION : ""}`
    : "💰 *Weekly cost watch* — all green";
  const body = [
    header,
    "",
    "*Supabase compute*",
    supa,
    "",
    "*Claude / API metered spend (month-to-date)*",
    api,
    "",
    "*EAS builds*",
    eas,
    "",
    "*Posting loop health (7d vs prior 7d)*",
    posting,
    "",
    "*Subscription headroom (autonomous load)*",
    load,
    flags.length ? `\n*Flags:* ${flags.join(" · ")}` : "",
  ]
    .filter((x) => x !== null && x !== undefined)
    .join("\n");

  if (process.env.COST_WATCH_DRY_RUN) {
    console.log("cost_watch DRY RUN — would post:\n\n" + body);
    return;
  }

  const res = await fetch(SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: body }),
  });
  console.log(`cost_watch: posted to Slack → ${res.status}`);
  if (flags.length) console.log("cost_watch flags:", flags.join(" | "));
}

main().catch((e) => {
  console.error("cost_watch fatal:", e);
  // Never fail the workflow over a reporting hiccup.
  process.exit(0);
});

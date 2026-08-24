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
  SLACK_CHIEF_WEBHOOK_URL,
  SLACK_ALERT_MENTION = "",
  EAS_BUILD_CAP = "22",
} = process.env;

const BUILD_CAP = Number(EAS_BUILD_CAP) || 22;
const BUILD_WARN = Math.ceil(BUILD_CAP * 0.8); // amber at 80% of cap

// Rough $/request estimates — the counter stores requests, not dollars, so these are
// deliberately conservative order-of-magnitude figures for trend-spotting, not invoicing.
const EST_USD_PER_REQ = {
  anthropic_haiku: 0.011, // web/venue event extraction: ~6k in + ~1k out @ Haiku 4.5
  anthropic_opus_notability: 0.022, // ~2k in + ~0.5k out @ Opus 4.8
  google_places: 0.017, // Places details/text-search list price
};

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
  let estTotal = 0;
  for (const { service, reqs, lim } of rows) {
    const rate = EST_USD_PER_REQ[service] ?? 0;
    const est = reqs * rate;
    estTotal += est;
    const pct = lim ? Math.round((reqs / lim) * 100) : 0;
    const bar = pct >= 80 ? "🔴" : pct >= 50 ? "🟠" : "🟢";
    lines.push(`• ${bar} \`${service}\`: ${reqs.toLocaleString()}/${lim.toLocaleString()} reqs (${pct}%) ≈ $${est.toFixed(2)} est`);
    if (lim && reqs / lim >= 0.8) flags.push(`${service} at ${pct}% of request cap`);
  }
  lines.push(`• *Est. metered LLM/API this month:* ~$${estTotal.toFixed(2)} (agents run on subscription → $0 metered)`);
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

async function main() {
  if (!SUPABASE_ACCESS_TOKEN || !SUPABASE_PROD_PROJECT_REF || !SLACK_CHIEF_WEBHOOK_URL) {
    console.log("cost_watch: required secrets missing — inert (no post).");
    return;
  }

  const [supa, api, eas, load] = await Promise.all([
    supabaseSection().catch((e) => `• Supabase section failed: ${e.message}`),
    apiSection().catch((e) => `• API section failed: ${e.message}`),
    easSection().catch((e) => `• EAS section failed: ${e.message}`),
    autonomousLoadSection().catch((e) => `• Autonomous load failed: ${e.message}`),
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

  const res = await fetch(SLACK_CHIEF_WEBHOOK_URL, {
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

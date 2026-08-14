// Posts Phase A read-worker heartbeats + reports to the #euda-chief Slack
// webhook. No-op (exit 0) when SLACK_CHIEF_WEBHOOK_URL is unset, so the
// workflows stay inert until the secret exists. Telemetry must never fail a
// run: every error path exits 0. Plain node:https, no dependencies.
//
// Usage:
//   node scripts/worker_slack.mjs start  <worker> [subtitle]
//   node scripts/worker_slack.mjs report <worker> <reportFile>
//   node scripts/worker_slack.mjs fail   <worker> [detail]
import https from "node:https";
import fs from "node:fs";

const [, , mode = "", worker = "worker", arg = ""] = process.argv;
// Prefer the dedicated #euda-chief webhook; fall back to the existing
// #euda-monitoring webhook (SLACK_WEBHOOK_URL) so the workers can report even
// before a separate channel exists ("reuse monitoring").
const WEBHOOK = process.env.SLACK_CHIEF_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || "";
if (!WEBHOOK) {
  console.warn("No SLACK_CHIEF_WEBHOOK_URL or SLACK_WEBHOOK_URL set — skipping Slack post (inert).");
  process.exit(0);
}

const EMOJI = { start: "🟡", report: "✅", fail: "🔴" };
const LABEL = { start: "starting", report: "report", fail: "did not finish" };

// Slack section text caps around 3000 chars; chunk on line boundaries.
function sections(text) {
  const MAX = 2800;
  const out = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (buf.length + line.length + 1 > MAX) {
      if (buf.trim()) out.push(buf);
      buf = "";
    }
    buf += line + "\n";
  }
  if (buf.trim()) out.push(buf);
  return out.slice(0, 12).map((t) => ({ type: "section", text: { type: "mrkdwn", text: t } }));
}

let body = "";
if (mode === "report") {
  try {
    body = fs.readFileSync(arg, "utf8").trim();
  } catch {
    body = "_(worker produced no report file)_";
  }
} else {
  body = arg;
}

const header = `${EMOJI[mode] ?? "•"} *chief · ${worker}* — ${LABEL[mode] ?? mode}`;
const blocks = [{ type: "section", text: { type: "mrkdwn", text: header } }];
if (mode === "report") {
  blocks.push(...sections(body || "_(empty report)_"));
} else if (body) {
  blocks.push({ type: "section", text: { type: "mrkdwn", text: body } });
}
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
blocks.push({
  type: "context",
  elements: [{ type: "mrkdwn", text: `phase-a read-worker · ${stamp} UTC` }],
});

const payload = JSON.stringify({ blocks });
const u = new URL(WEBHOOK);
const req = https.request(
  {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  },
  (res) => {
    res.on("data", () => {});
    res.on("end", () => {
      if (!res.statusCode || res.statusCode >= 300) {
        console.warn(`Slack webhook returned HTTP ${res.statusCode}`);
      }
      process.exit(0);
    });
  },
);
req.on("error", (e) => {
  console.warn("Slack post failed:", e.message);
  process.exit(0);
});
req.write(payload);
req.end();

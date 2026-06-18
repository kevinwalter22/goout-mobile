/**
 * Slack notification helper for edge monitoring (Chief Engineer Phase 3b).
 *
 * Posts Block Kit messages to a Slack Incoming Webhook with severity levels.
 * No-op when SLACK_WEBHOOK_URL is unset, so local/unconfigured deploys are safe.
 * Telemetry must never break a caller — every path swallows its own errors.
 *
 * Config (Supabase function secrets):
 *   SLACK_WEBHOOK_URL    - Incoming Webhook for the monitoring channel
 *                          (recommend a dedicated #euda-monitoring)
 *   SLACK_ALERT_MENTION  - optional, e.g. "<@U123ABC>" — appended on `critical`
 *   SENTRY_ENV           - reused as the environment tag in messages (prod/staging)
 */

export type Severity = "info" | "warning" | "error" | "critical";

const WEBHOOK = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";
const MENTION = Deno.env.get("SLACK_ALERT_MENTION") ?? "";
const ENV = Deno.env.get("SENTRY_ENV") ?? "prod";

const META: Record<Severity, { emoji: string; color: string }> = {
  info: { emoji: "ℹ️", color: "#36a3eb" },
  warning: { emoji: "⚠️", color: "#f5a623" },
  error: { emoji: "⛔", color: "#e5484d" },
  critical: { emoji: "🚨", color: "#d50000" },
};

export interface NotifyOpts {
  /** Markdown body. */
  text?: string;
  /** Key/value pairs rendered as a 2-column field grid (max 10). */
  fields?: Record<string, string | number>;
  /** Small context/footer line. */
  context?: string;
}

export const NOTIFY_ENABLED = !!WEBHOOK;

/** Post a severity-tagged Block Kit message. Returns true if delivered. */
export async function notify(
  severity: Severity,
  title: string,
  opts: NotifyOpts = {},
): Promise<boolean> {
  if (!WEBHOOK) return false;
  const m = META[severity];
  let headline = `${m.emoji} *${title}*  _(${ENV})_`;
  if (severity === "critical" && MENTION) headline += `  ${MENTION}`;

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: headline } },
  ];
  if (opts.text) blocks.push({ type: "section", text: { type: "mrkdwn", text: opts.text } });
  if (opts.fields && Object.keys(opts.fields).length) {
    blocks.push({
      type: "section",
      fields: Object.entries(opts.fields).slice(0, 10).map(([k, v]) => ({
        type: "mrkdwn",
        text: `*${k}:*\n${v}`,
      })),
    });
  }
  if (opts.context) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: opts.context }] });
  }

  try {
    const r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachments: [{ color: m.color, blocks }] }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

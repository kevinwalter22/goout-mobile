/**
 * monitor-error-rates (Phase 3b) — cron every 30 min.
 * Pulls hourly error volume from Sentry (org euda-2e) for the last 7 days,
 * compares the most recent complete hour to the rolling 7-day hourly median.
 * Spike (> 3× median and an absolute floor) → warning/critical.
 *
 * Needs SENTRY_ORG_AUTH_TOKEN (function secret). No-op if unset.
 * Thresholds are first-guess; tune once we have baseline volume (tech debt).
 */
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { notify } from "../_shared/notify.ts";

const ORG = "euda-2e";
const SPIKE_FACTOR = 3;
const ABS_FLOOR = 10; // ignore spikes below this absolute count (noise)

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  const cors = getCorsHeaders(req);
  const auth = requireServiceRole(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.error === "Forbidden" ? 403 : 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const token = Deno.env.get("SENTRY_ORG_AUTH_TOKEN") ?? "";
    if (!token) {
      return new Response(JSON.stringify({ ok: true, skipped: "no SENTRY_ORG_AUTH_TOKEN" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const url =
      `https://sentry.io/api/0/organizations/${ORG}/stats_v2/` +
      `?field=sum(quantity)&category=error&interval=1h&statsPeriod=7d`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Sentry stats ${res.status}: ${await res.text()}`);
    const json = await res.json();

    // Sum error quantity across all groups per interval.
    const intervals: string[] = json.intervals ?? [];
    const totals = new Array(intervals.length).fill(0);
    for (const g of json.groups ?? []) {
      const series: number[] = g.series?.["sum(quantity)"] ?? [];
      series.forEach((v: number, i: number) => { totals[i] += v ?? 0; });
    }
    // Drop the last (incomplete) bucket; latest = the one before it.
    const complete = totals.slice(0, -1);
    const latest = complete[complete.length - 1] ?? 0;
    const med = median(complete.slice(0, -1)); // median excluding the latest

    let severity: "warning" | "critical" | null = null;
    if (latest >= ABS_FLOOR && latest > SPIKE_FACTOR * Math.max(med, 1)) {
      severity = latest > 5 * Math.max(med, 1) ? "critical" : "warning";
    }
    if (severity) {
      await notify(severity, "Error-rate spike (Sentry)", {
        fields: { "Latest hour": latest, "7d hourly median": med.toFixed(1), "Factor": `${(latest / Math.max(med, 1)).toFixed(1)}×` },
        context: "monitor-error-rates",
      });
    }

    return new Response(
      JSON.stringify({ ok: true, latest_hour: latest, median_7d: med, alerted: severity }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("monitor-error-rates error:", error);
    await captureEdgeException(error, { function: "monitor-error-rates" });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});

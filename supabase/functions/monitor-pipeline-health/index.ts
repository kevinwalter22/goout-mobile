/**
 * monitor-pipeline-health (Phase 3b) — cron every 30 min.
 * Flags ingestion sources that have gone silent in pipeline_health_log:
 *   > 4h since last entry  → warning
 *   > 24h since last entry → critical
 * The whole point: detect the "silent for 3 months" failure mode early.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { notify } from "../_shared/notify.ts";

const WARN_HOURS = 4;
const CRIT_HOURS = 24;

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // Latest health-log entry per source.
    const { data, error } = await supabase
      .from("pipeline_health_log")
      .select("source_name, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw error;

    const latest = new Map<string, string>();
    for (const row of data ?? []) {
      if (!latest.has(row.source_name)) latest.set(row.source_name, row.created_at);
    }

    const now = Date.now();
    const warnings: string[] = [];
    const criticals: string[] = [];
    const fields: Record<string, string> = {};
    for (const [src, ts] of latest) {
      const hours = (now - new Date(ts).getTime()) / 3.6e6;
      fields[src] = `${hours.toFixed(1)}h ago`;
      if (hours > CRIT_HOURS) criticals.push(`${src} (${hours.toFixed(0)}h)`);
      else if (hours > WARN_HOURS) warnings.push(`${src} (${hours.toFixed(0)}h)`);
    }

    if (criticals.length) {
      await notify("critical", "Pipeline sources silent >24h", {
        text: criticals.map((s) => `• ${s}`).join("\n"),
        context: "monitor-pipeline-health",
      });
    } else if (warnings.length) {
      await notify("warning", "Pipeline sources silent >4h", {
        text: warnings.map((s) => `• ${s}`).join("\n"),
        context: "monitor-pipeline-health",
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sources: latest.size,
        warnings: warnings.length,
        criticals: criticals.length,
        last_seen: fields,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("monitor-pipeline-health error:", error);
    await captureEdgeException(error, { function: "monitor-pipeline-health" });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});

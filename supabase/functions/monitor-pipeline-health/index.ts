/**
 * monitor-pipeline-health (Phase 3b) — cron every 30 min.
 * Flags CORE PIPELINE STAGES that have gone silent in pipeline_health_log:
 *   > 4h since last entry  → warning
 *   > 24h since last entry → critical
 * The whole point: detect the "silent for 3 months" failure mode early.
 *
 * We monitor by `stage` (a tiny fixed set on a 15–30m cron cadence), NOT by
 * `source_name` (75+ individual venues, many low-frequency) — that granularity
 * made the check pure noise (40+ false warnings on the first run).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { notify } from "../_shared/notify.ts";

const WARN_HOURS = 4;
const CRIT_HOURS = 24;

// Core pipeline stages that log to pipeline_health_log on a frequent cron
// cadence. Tune this list as the pipeline evolves (e.g. add "enrich" if/when
// run-enrichment-queue starts writing health entries).
const EXPECTED_STAGES = ["web_collect", "ingest", "normalize", "discover"];

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
    // Latest entry per core stage (one tiny query each — reliably catches a
    // stage that has gone fully silent, even for days).
    const now = Date.now();
    const warnings: string[] = [];
    const criticals: string[] = [];
    const fields: Record<string, string> = {};
    for (const stage of EXPECTED_STAGES) {
      const { data, error } = await supabase
        .from("pipeline_health_log")
        .select("created_at")
        .eq("stage", stage)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const last = data?.[0]?.created_at;
      if (!last) {
        fields[stage] = "no entries";
        criticals.push(`${stage} (never)`);
        continue;
      }
      const hours = (now - new Date(last).getTime()) / 3.6e6;
      fields[stage] = `${hours.toFixed(1)}h ago`;
      if (hours > CRIT_HOURS) criticals.push(`${stage} (${hours.toFixed(0)}h)`);
      else if (hours > WARN_HOURS) warnings.push(`${stage} (${hours.toFixed(0)}h)`);
    }

    if (criticals.length) {
      await notify("critical", "Pipeline stages silent >24h", {
        text: criticals.map((s) => `• ${s}`).join("\n"),
        context: "monitor-pipeline-health",
      });
    } else if (warnings.length) {
      await notify("warning", "Pipeline stages silent >4h", {
        text: warnings.map((s) => `• ${s}`).join("\n"),
        context: "monitor-pipeline-health",
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        stages: EXPECTED_STAGES.length,
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

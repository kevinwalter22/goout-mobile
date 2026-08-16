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
import { createClient } from "npm:@supabase/supabase-js@2";
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

    // Per-SOURCE freshness. The stage check above stays green as long as the
    // ingest stage has ANY activity (web_collector), so it can't see an individual
    // API source going dark — which is exactly how Ticketmaster/PredictHQ stayed
    // frozen for ~2 months unnoticed. fetch_partitions is a small curated set (not
    // the 75+ web-collector venues), so paging on it is low-noise. An ENABLED
    // partition (with an ENABLED source) that hasn't fetched in >3 days = a live
    // source has gone dark. Brand-new partitions (<1 day old) are skipped.
    const STALE_SOURCE_DAYS = 3;
    const { data: parts, error: pErr } = await supabase
      .from("fetch_partitions")
      .select("partition_label, last_fetched_at, created_at, event_sources!inner(name, is_enabled)")
      .eq("is_enabled", true)
      .eq("event_sources.is_enabled", true);
    if (pErr) throw pErr;
    const darkSources = (parts ?? [])
      .filter((p: any) => {
        if ((now - new Date(p.created_at).getTime()) / 8.64e7 < 1) return false;
        if (!p.last_fetched_at) return true;
        return (now - new Date(p.last_fetched_at).getTime()) / 8.64e7 > STALE_SOURCE_DAYS;
      })
      .map((p: any) => {
        const age = p.last_fetched_at
          ? `${Math.round((now - new Date(p.last_fetched_at).getTime()) / 8.64e7)}d`
          : "never";
        return `${p.event_sources.name} / ${p.partition_label} (${age})`;
      });

    if (darkSources.length) {
      await notify("critical", `Ingestion source(s) dark >${STALE_SOURCE_DAYS}d`, {
        text: darkSources.map((s) => `• ${s}`).join("\n"),
        context: "monitor-pipeline-health · source-freshness",
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        stages: EXPECTED_STAGES.length,
        warnings: warnings.length,
        criticals: criticals.length,
        dark_sources: darkSources.length,
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

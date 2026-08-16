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

    // SOURCE-LIVENESS — the durable fix for silent source-death. The stage check
    // above stays green as long as ingest has ANY activity (web_collector), so it
    // can't see an individual source going dark — how Ticketmaster/PredictHQ stayed
    // frozen ~2 months unnoticed. This measures OUTPUT (rows in event_ingest_raw),
    // not fetch attempts — so it also catches a source that "fetches" but writes
    // nothing (a stub / broken adapter, e.g. two headline sources empty forever).
    // N is per-source-type cadence so a genuinely low-frequency source doesn't
    // false-alarm on a normal gap; brand-new sources (<1d) get a grace period.
    const STALE_DAYS_BY_TYPE: Record<string, number> = {
      api_ticketmaster: 3, api_predicthq: 3, api_google_places: 3,
      api_eventbrite: 4, api_yelp: 4, web_collector: 4, web_community_calendar: 7,
    };
    // Only sources ACTIVELY configured to fetch (an enabled partition, or an enabled
    // collector target) are checked — so an intentionally-paused source (Google
    // Places' enumeration is pulled back; a source whose partitions are all off) is
    // never false-flagged. A source that IS configured to fetch but produces no rows
    // is the real death signal.
    const active = new Map<string, any>();
    const { data: aParts } = await supabase
      .from("fetch_partitions")
      .select("source_id, event_sources!inner(id, name, type, is_enabled)")
      .eq("is_enabled", true)
      .eq("event_sources.is_enabled", true);
    for (const p of (aParts ?? []) as any[]) active.set(p.source_id, p.event_sources);
    const { data: wcSrcs } = await supabase
      .from("event_sources").select("id, name, type").eq("is_enabled", true)
      .in("type", ["web_collector", "web_community_calendar"]);
    for (const s of (wcSrcs ?? []) as any[]) {
      const { count } = await supabase
        .from("collector_targets").select("id", { count: "exact", head: true })
        .eq("source_id", s.id).eq("is_enabled", true);
      if ((count ?? 0) > 0) active.set(s.id, s);
    }
    const darkSources: string[] = [];
    for (const [sid, s] of active) {
      const { data: last } = await supabase
        .from("event_ingest_raw")
        .select("created_at")
        .eq("source_id", sid)
        .order("created_at", { ascending: false })
        .limit(1);
      const lastAt = last?.[0]?.created_at;
      const nDays = STALE_DAYS_BY_TYPE[s.type] ?? 3;
      const ageDays = lastAt ? (now - new Date(lastAt).getTime()) / 8.64e7 : Infinity;
      if (ageDays > nDays) {
        darkSources.push(`${s.name} — ${lastAt ? Math.round(ageDays) + "d silent" : "0 rows ever"} (N=${nDays}d)`);
      }
    }

    if (darkSources.length) {
      await notify("critical", "Ingestion source(s) producing 0 rows", {
        text: darkSources.map((s) => `• ${s}`).join("\n"),
        context: "monitor-pipeline-health · source-liveness",
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

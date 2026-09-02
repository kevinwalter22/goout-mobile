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

    // SOURCE-LIVENESS — catch a source that is SILENTLY BROKEN: it's configured to
    // fetch but either can't fetch (stale / erroring) or fetches and returns NOTHING
    // (dead endpoint / stub adapter). This is the "Ticketmaster frozen 2 months
    // unnoticed" failure mode.
    //
    // What we DON'T alert on: a source that fetches fine but simply has no NEW events.
    // A settled catalog (fetches OK, returns data, nothing new happening) is HEALTHY,
    // not broken — measuring new event_ingest_raw rows conflated the two and spammed a
    // healthy Ticketmaster. "Gone quiet" is a weekly FYI in the maintainer report, not
    // a siren. Here: alive = fetched recently, 0 errors, returned data.
    //
    // De-dup: a broken source pages at most once / 24h (or the moment it newly breaks),
    // never every 30-min run — a siren that re-fires every 30 min trains you to ignore it.
    const STALE_MULT = 3;                 // tolerate this many missed fetch cycles
    const API_STALE_FLOOR_MIN = 6 * 60;   // ...but at least 6h for a fast cron
    const WEB_STALE_FLOOR_MIN = 24 * 60;  // web collectors run on a slower cadence
    const CONSEC_ERR_ALERT = 3;
    const ageMin = (iso: string | null | undefined) =>
      iso ? (now - new Date(iso).getTime()) / 60000 : Infinity;

    type Health = { name: string; type: string; alive: boolean; reason: string };
    const health = new Map<string, Health>();
    const seed = (id: string, name: string, type: string) => {
      if (!health.has(id)) health.set(id, { name, type, alive: false, reason: "no successful fetch on record" });
    };

    // API sources (fetch_partitions): alive = fresh fetch + no errors + total_fetched > 0.
    // A source is alive if ANY of its enabled partitions is healthy.
    const { data: aParts } = await supabase
      .from("fetch_partitions")
      .select("source_id, last_fetched_at, last_result, consecutive_errors, fetch_interval_minutes, event_sources!inner(id, name, type, is_enabled)")
      .eq("is_enabled", true)
      .eq("event_sources.is_enabled", true);
    for (const p of (aParts ?? []) as any[]) {
      const s = p.event_sources;
      seed(s.id, s.name, s.type);
      const staleAt = Math.max((p.fetch_interval_minutes || 0) * STALE_MULT, API_STALE_FLOOR_MIN);
      const fresh = ageMin(p.last_fetched_at) <= staleAt;
      const errored = (p.consecutive_errors || 0) >= CONSEC_ERR_ALERT || Number(p.last_result?.errors || 0) > 0;
      const gotData = Number(p.last_result?.total_fetched || 0) > 0;
      if (fresh && !errored && gotData) {
        health.set(s.id, { name: s.name, type: s.type, alive: true, reason: "" });
      } else if (!health.get(s.id)?.alive) {
        const reason = !fresh
          ? `no successful fetch in ${(ageMin(p.last_fetched_at) / 60).toFixed(0)}h`
          : errored
          ? `${p.consecutive_errors || p.last_result?.errors} recent fetch error(s)`
          : "fetches but returns 0 rows (dead endpoint / broken adapter)";
        health.set(s.id, { name: s.name, type: s.type, alive: false, reason });
      }
    }

    // GAP 1 — an enabled API-family source with ZERO enabled partitions never enters
    // the health map above, because the aParts query inner-joins on is_enabled=true
    // (both partition AND source). So a source whose partitions were all disabled while
    // the source row stayed enabled just vanishes from monitoring — exactly how Google
    // Places went dark for 2 months: event_sources.is_enabled=true, but every
    // fetch_partitions row is_enabled=false → nothing drove ingestion, nothing alerted.
    // An intentional pause belongs at the SOURCE level (event_sources.is_enabled=false);
    // an *enabled* source with no active partition is a silent misconfiguration worth
    // paging on. Route it through the same health/brokenSources → cooldown → notify flow.
    const sourcesWithEnabledPart = new Set((aParts ?? []).map((p: any) => p.source_id));
    const { data: apiSources } = await supabase
      .from("event_sources")
      .select("id, name, type")
      .eq("is_enabled", true)
      .like("type", "api_%");
    for (const s of (apiSources ?? []) as any[]) {
      if (sourcesWithEnabledPart.has(s.id)) continue; // has ≥1 active partition → already scored above
      if (health.has(s.id)) continue;                 // defensive: never clobber partition-based health
      health.set(s.id, {
        name: s.name,
        type: s.type,
        alive: false,
        reason: "enabled source has no active partitions — ingestion cannot run",
      });
    }

    // GAP 2 — Web collectors evaluated PER TOWN, not per shared source_id. Every
    // Warwick/Portland/Potsdam collector_target hangs off ONE shared "Web Collector"
    // source, so rolling health up to event_sources.id lets a whole region's collectors
    // die while the shared source stays "alive" on the other regions' volume. We instead
    // group enabled targets by collector_targets.town and alert on a *dark town*.
    //
    // A town is dark (given ≥ 2 enabled targets — a single-venue town is a per-source
    // concern, not regional death) when EITHER:
    //   • every enabled target is unhealthy — circuit_breaker='open', OR
    //     consecutive_errors ≥ max_consecutive_errors, OR stale (no run within
    //     max(crawl_frequency_minutes*3, 24h)); OR
    //   • its combined event_yield_7d = 0 across all enabled targets that have existed
    //     > 7 days (established collectors that collectively produced nothing in a week).
    const WEB_YIELD_MIN_AGE_MIN = 7 * 24 * 60; // only judge yield for targets older than 7d
    const MIN_REGION_TARGETS = 2;              // a "region" = ≥ 2 enabled collectors
    const { data: townT } = await supabase
      .from("collector_targets")
      .select("town, last_run_at, consecutive_errors, max_consecutive_errors, circuit_breaker, crawl_frequency_minutes, event_yield_7d, created_at, event_sources!inner(is_enabled)")
      .eq("is_enabled", true)
      .eq("event_sources.is_enabled", true);

    const byTown = new Map<string, any[]>();
    for (const t of (townT ?? []) as any[]) {
      const town = (t.town ?? "").trim();
      if (!town) continue; // no town hint → can't evaluate regionally (falls to stage/source checks)
      const arr = byTown.get(town);
      if (arr) arr.push(t);
      else byTown.set(town, [t]);
    }

    type DarkTown = { town: string; reason: string };
    const darkTowns: DarkTown[] = [];
    for (const [town, targets] of byTown) {
      if (targets.length < MIN_REGION_TARGETS) continue;
      const unhealthy = (t: any) =>
        t.circuit_breaker === "open"
        || (t.consecutive_errors || 0) >= (t.max_consecutive_errors || CONSEC_ERR_ALERT)
        || ageMin(t.last_run_at) > Math.max((t.crawl_frequency_minutes || 0) * STALE_MULT, WEB_STALE_FLOOR_MIN);
      const allDead = targets.every(unhealthy);
      const aged = targets.filter((t) => ageMin(t.created_at) > WEB_YIELD_MIN_AGE_MIN);
      const combinedYield = aged.reduce((sum, t) => sum + (Number(t.event_yield_7d) || 0), 0);
      const zeroYield = aged.length > 0 && combinedYield === 0;
      if (!allDead && !zeroYield) continue;
      const reason = allDead && zeroYield
        ? `all ${targets.length} enabled web collectors dead/0-yield`
        : allDead
        ? `all ${targets.length} enabled web collectors dead (circuit-open / stale / erroring)`
        : `0 events in 7d across ${aged.length} established collector(s) of ${targets.length} enabled`;
      darkTowns.push({ town, reason });
    }

    const brokenSources = [...health.entries()].filter(([, h]) => !h.alive);

    // Unify source-level breakage (keyed by source_id) with per-town web-collector
    // death (keyed by `town:<Town>`) so BOTH ride the SAME cooldown pass + app_config
    // state object → each pages at most once / 24h and recovers cleanly.
    type Broken = { key: string; name: string; reason: string };
    const brokenEntities: Broken[] = [
      ...brokenSources.map(([id, h]) => ({ key: id, name: h.name, reason: h.reason })),
      ...darkTowns.map((d) => ({ key: `town:${d.town}`, name: d.town, reason: d.reason })),
    ];

    // COOLDOWN — state (entity-key -> last-alerted ISO) lives in app_config so it
    // survives across the stateless cron runs. Alert a broken entity only if it's
    // newly broken (not in state) or >24h since its last page. Recovered entities
    // drop out of the state (so a re-break pages fresh).
    const COOLDOWN_MS = 24 * 60 * 60 * 1000;
    const STATE_KEY = "monitor_liveness_alert_state";
    let prevState: Record<string, string> = {};
    try {
      const { data: cfg } = await supabase.from("app_config").select("value").eq("key", STATE_KEY).maybeSingle();
      if (cfg?.value) prevState = JSON.parse(cfg.value);
    } catch { /* first run / malformed → treat as empty */ }

    const nextState: Record<string, string> = {};
    const toAlert: string[] = [];
    for (const { key, name, reason } of brokenEntities) {
      const lastAlerted = prevState[key] ? new Date(prevState[key]).getTime() : 0;
      if (now - lastAlerted > COOLDOWN_MS) {
        toAlert.push(`${name} — ${reason}`);
        nextState[key] = new Date(now).toISOString();
      } else {
        nextState[key] = prevState[key]; // still broken, within cooldown → stay quiet
      }
    }
    try {
      await supabase.from("app_config").upsert({ key: STATE_KEY, value: JSON.stringify(nextState) }, { onConflict: "key" });
    } catch { /* non-fatal: worst case the next run re-evaluates */ }

    if (toAlert.length) {
      await notify("critical", "Ingestion source(s) silently broken", {
        text: toAlert.map((s) => `• ${s}`).join("\n"),
        context: "monitor-pipeline-health · source + per-town liveness (≤ once/24h each)",
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        stages: EXPECTED_STAGES.length,
        warnings: warnings.length,
        criticals: criticals.length,
        broken_sources: brokenSources.length,
        dark_towns: darkTowns.length,
        alerted: toAlert.length,
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

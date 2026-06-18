/**
 * monitor-data-quality (Phase 3b) — cron daily ~08:00 ET (12:00 UTC).
 * Snapshots catalog data-quality metrics into monitoring_daily (for trending)
 * and posts a daily summary to Slack. Warns on anomalies (null-coord events,
 * missing start times, quarantine backlog).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { notify } from "../_shared/notify.ts";

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
    const since = new Date(Date.now() - 24 * 3.6e6).toISOString();
    const count = async (build: (q: any) => any): Promise<number> => {
      const { count, error } = await build(
        supabase.from("explore_items").select("id", { count: "exact", head: true }),
      );
      if (error) throw error;
      return count ?? 0;
    };

    const newItemsTotal = await count((q) => q.gte("created_at", since).is("deleted_at", null));
    const nullCoordEvents = await count((q) =>
      q.eq("kind", "event").is("deleted_at", null).or("lat.is.null,lng.is.null")
    );
    const missingStartsEvents = await count((q) =>
      q.eq("kind", "event").is("deleted_at", null).is("starts_at", null)
    );
    const quarantinedTotal = await count((q) => q.eq("review_status", "quarantined"));

    const { count: postAtEvent24h, error: pErr } = await supabase
      .from("engagement_log")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "post_at_event")
      .gte("occurred_at", since);
    if (pErr) throw pErr;

    // New items by source (aggregate in JS; 24h of rows is small).
    const { data: recent, error: rErr } = await supabase
      .from("explore_items")
      .select("source_id")
      .gte("created_at", since)
      .is("deleted_at", null)
      .limit(5000);
    if (rErr) throw rErr;
    const bySource: Record<string, number> = {};
    for (const r of recent ?? []) {
      const k = r.source_id ?? "manual/null";
      bySource[k] = (bySource[k] ?? 0) + 1;
    }

    const snapshotDate = since.slice(0, 10); // not used as PK key directly; see upsert
    const today = new Date().toISOString().slice(0, 10);
    const metrics = {
      snapshot_date: today,
      new_items_total: newItemsTotal,
      new_items_by_source: bySource,
      null_coord_events: nullCoordEvents,
      missing_starts_events: missingStartsEvents,
      post_at_event_24h: postAtEvent24h ?? 0,
      quarantined_total: quarantinedTotal,
    };

    const { error: upErr } = await supabase
      .from("monitoring_daily")
      .upsert(metrics, { onConflict: "snapshot_date" });
    if (upErr) throw upErr;

    const anomaly = nullCoordEvents > 0 || missingStartsEvents > 0 || quarantinedTotal > 0;
    await notify(anomaly ? "warning" : "info", "Daily data-quality snapshot", {
      fields: {
        "New items (24h)": newItemsTotal,
        "post_at_event (24h)": postAtEvent24h ?? 0,
        "Null-coord events": nullCoordEvents,
        "Missing start time": missingStartsEvents,
        "Quarantined": quarantinedTotal,
      },
      context: `monitor-data-quality · ${today}`,
    });

    return new Response(JSON.stringify({ ok: true, metrics }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("monitor-data-quality error:", error);
    await captureEdgeException(error, { function: "monitor-data-quality" });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});

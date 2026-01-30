/**
 * Health Summary Edge Function
 *
 * Returns a JSON dashboard of the pipeline's current health:
 * - Per-source: item counts, last_fetched, overdue status
 * - Queue depths: normalization + enrichment (queued/running/failed/done)
 * - Data quality: confidence stats, missing fields, duplicates
 * - Recent errors from pipeline_health_log
 *
 * GET  /health-summary          → full snapshot
 * POST /health-summary          → log a health event
 * POST /health-summary?action=log  → explicit log entry
 *
 * Used by: monitoring dashboards, alerting, wave2_verification.md checks.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // POST with action=log: record a health event
    if (req.method === "POST" && action === "log") {
      return await handleLogEntry(supabase, req);
    }

    // GET (or POST without action): return health snapshot
    return await handleSnapshot(supabase);
  } catch (error) {
    console.error("Health summary error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ============================================================================
// GET: Health snapshot
// ============================================================================

async function handleSnapshot(supabase: any) {
  // Try RPC first (migration 033)
  const { data: snapshot, error: rpcError } = await supabase.rpc(
    "pipeline_health_snapshot"
  );

  if (rpcError) {
    console.warn("RPC pipeline_health_snapshot failed, building manually:", rpcError.message);
    return await buildManualSnapshot(supabase);
  }

  return new Response(JSON.stringify(snapshot), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function buildManualSnapshot(supabase: any) {
  // Fallback: build snapshot from direct queries
  const [sourcesRes, normQueueRes, enrichQueueRes, qualityRes] =
    await Promise.all([
      supabase.from("event_sources").select("*").order("name"),
      supabase
        .from("event_normalization_jobs")
        .select("status", { count: "exact", head: false }),
      supabase
        .from("enrichment_queue")
        .select("status", { count: "exact", head: false }),
      supabase
        .from("explore_items")
        .select(
          "id, priority, is_duplicate, normalized_confidence, hook_line, tags, availability_json, price_bucket, kind"
        )
        .gte("priority", 0),
    ]);

  const sources = (sourcesRes.data || []).map((es: any) => ({
    name: es.name,
    type: es.type,
    is_enabled: es.is_enabled,
    last_fetch_at: es.last_fetch_at,
    fetch_interval_minutes: es.fetch_interval_minutes,
    minutes_since_fetch: es.last_fetch_at
      ? (Date.now() - new Date(es.last_fetch_at).getTime()) / 60000
      : null,
    is_overdue:
      es.last_fetch_at && es.is_enabled
        ? Date.now() - new Date(es.last_fetch_at).getTime() >
          es.fetch_interval_minutes * 60000 * 2
        : false,
  }));

  // Count queue statuses
  const normJobs = normQueueRes.data || [];
  const enrichJobs = enrichQueueRes.data || [];
  const countStatus = (arr: any[], s: string) =>
    arr.filter((j: any) => j.status === s).length;

  const queues = {
    normalization: {
      queued: countStatus(normJobs, "queued"),
      running: countStatus(normJobs, "running"),
      failed: countStatus(normJobs, "failed"),
      done: countStatus(normJobs, "done"),
    },
    enrichment: {
      queued: countStatus(enrichJobs, "queued"),
      running: countStatus(enrichJobs, "running"),
      failed: countStatus(enrichJobs, "failed"),
      done: countStatus(enrichJobs, "done"),
    },
  };

  // Quality metrics
  const items = qualityRes.data || [];
  const active = items.filter((i: any) => !i.is_duplicate);
  const withConf = active.filter(
    (i: any) => i.normalized_confidence !== null
  );
  const avgConf =
    withConf.length > 0
      ? Math.round(
          withConf.reduce(
            (sum: number, i: any) => sum + i.normalized_confidence,
            0
          ) / withConf.length
        )
      : null;

  const quality = {
    total_items: items.length,
    active_items: active.length,
    duplicates_marked: items.length - active.length,
    missing_confidence: active.filter(
      (i: any) => i.normalized_confidence === null
    ).length,
    low_confidence: active.filter(
      (i: any) =>
        i.normalized_confidence !== null && i.normalized_confidence < 40
    ).length,
    avg_confidence: avgConf,
    missing_hook_line: active.filter(
      (i: any) => !i.hook_line || i.hook_line.length < 10
    ).length,
    missing_tags: active.filter(
      (i: any) => !i.tags || i.tags.length === 0
    ).length,
    missing_availability: active.filter(
      (i: any) => i.kind === "event" && !i.availability_json
    ).length,
    unknown_price: active.filter(
      (i: any) => i.price_bucket === "unknown"
    ).length,
  };

  const snapshot = {
    snapshot_at: new Date().toISOString(),
    sources,
    queues,
    quality,
    recent_errors: [], // No health log table in fallback mode
  };

  return new Response(JSON.stringify(snapshot), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================================
// POST: Log a health event
// ============================================================================

interface HealthLogEntry {
  stage: string;           // 'ingest', 'normalize', 'enrich', 'dedup', 'schedule'
  source_name?: string;    // e.g. 'Ticketmaster'
  status?: string;         // 'ok', 'warn', 'error'
  items_processed?: number;
  items_failed?: number;
  duration_ms?: number;
  details_json?: Record<string, unknown>;
}

async function handleLogEntry(supabase: any, req: Request) {
  let entry: HealthLogEntry;
  try {
    entry = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (!entry.stage) {
    return new Response(
      JSON.stringify({ error: "Missing required field: stage" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const { error: insertError } = await supabase
    .from("pipeline_health_log")
    .insert({
      stage: entry.stage,
      source_name: entry.source_name || null,
      status: entry.status || "ok",
      items_processed: entry.items_processed || 0,
      items_failed: entry.items_failed || 0,
      duration_ms: entry.duration_ms || null,
      details_json: entry.details_json || null,
    });

  if (insertError) {
    console.error("Failed to insert health log:", insertError.message);
    return new Response(
      JSON.stringify({ error: insertError.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  return new Response(
    JSON.stringify({ success: true }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

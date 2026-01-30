/**
 * Shared health log utility for Edge Functions.
 *
 * Usage:
 *   import { logPipelineHealth } from "../_shared/health-log.ts";
 *   await logPipelineHealth(supabase, {
 *     stage: "ingest",
 *     source_name: "Ticketmaster",
 *     items_processed: 42,
 *     items_failed: 1,
 *     duration_ms: 3400,
 *   });
 *
 * Non-blocking: errors are caught and logged but don't throw.
 */

export interface HealthLogEntry {
  stage: string;            // 'ingest' | 'normalize' | 'enrich' | 'dedup' | 'schedule'
  source_name?: string;     // e.g. 'Ticketmaster', null for global
  status?: string;          // 'ok' | 'warn' | 'error'
  items_processed?: number;
  items_failed?: number;
  duration_ms?: number;
  details_json?: Record<string, unknown>;
}

/**
 * Insert a row into pipeline_health_log.
 * Fails silently — health logging should never break the pipeline.
 */
export async function logPipelineHealth(
  supabase: any,
  entry: HealthLogEntry
): Promise<void> {
  try {
    const { error } = await supabase.from("pipeline_health_log").insert({
      stage: entry.stage,
      source_name: entry.source_name || null,
      status: entry.status || (entry.items_failed && entry.items_failed > 0 ? "warn" : "ok"),
      items_processed: entry.items_processed || 0,
      items_failed: entry.items_failed || 0,
      duration_ms: entry.duration_ms || null,
      details_json: entry.details_json || null,
    });

    if (error) {
      // Table might not exist yet (migration 033 not applied) — non-fatal
      console.warn("Health log insert failed (non-fatal):", error.message);
    }
  } catch (err) {
    console.warn("Health log error (non-fatal):", err);
  }
}

/**
 * Fetch Coordinator
 *
 * Orchestrates API source fetching with rotation and partitioning.
 * Picks the next overdue fetch partition, invokes the appropriate
 * ingestion function, records the result, and moves to the next.
 *
 * Features:
 * - Round-robin by staleness (oldest partition first)
 * - Exponential backoff on consecutive errors
 * - Per-partition config override (geo, radius, days_ahead)
 * - Rate limit protection between fetches
 * - Health logging for each fetch cycle
 *
 * Usage:
 *   POST /fetch-coordinator
 *   Body: { "max_fetches": 3, "source_type": "api_ticketmaster" }
 *
 * Designed for scheduled execution (every 30-60 minutes via pg_cron
 * or external scheduler).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logPipelineHealth } from "../_shared/health-log.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

interface CoordinatorConfig {
  max_fetches?: number;     // Max partitions to fetch per invocation
  source_type?: string;     // Filter to specific source type
  delay_ms?: number;        // Delay between fetches (rate limit protection)
  dry_run?: boolean;
}

const DEFAULT_CONFIG: Required<CoordinatorConfig> = {
  max_fetches: 3,
  source_type: "",     // Empty = all sources
  delay_ms: 2000,
  dry_run: false,
};

// Map source type → Edge Function name
const SOURCE_FUNCTION_MAP: Record<string, string> = {
  api_ticketmaster: "ingest-ticketmaster",
  api_eventbrite: "ingest-eventbrite",
  api_google_places: "ingest-google-places",
  api_predicthq: "ingest-predicthq",
  web_collector: "ingest-web-collector",
  web_community_calendar: "ingest-web-collector", // Legacy type maps to same function
};

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  const corsHeaders = getCorsHeaders(req);

  const auth = requireServiceRole(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.error === "Forbidden" ? 403 : 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let config: CoordinatorConfig = {};
    if (req.method === "POST") {
      try {
        config = await req.json();
      } catch {
        // Empty body OK
      }
    }

    const cfg = { ...DEFAULT_CONFIG, ...config };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Fetch coordinator starting: max_fetches=${cfg.max_fetches}, source_type=${cfg.source_type || "all"}`);

    const startTime = Date.now();
    const fetchResults: Array<{
      partition_label: string;
      source_name: string;
      source_type: string;
      status: "success" | "error" | "skipped";
      items_fetched?: number;
      error?: string;
    }> = [];

    let fetchCount = 0;

    while (fetchCount < cfg.max_fetches) {
      // Pick next overdue partition
      const { data: partitions, error: pickError } = await supabase.rpc(
        "next_fetch_partition",
        {
          p_source_type: cfg.source_type || null,
        }
      );

      if (pickError) {
        console.error("Failed to pick next partition:", pickError.message);
        break;
      }

      if (!partitions || partitions.length === 0) {
        console.log("No overdue partitions found — all sources are up to date.");
        break;
      }

      const partition = partitions[0];
      console.log(
        `\nFetch ${fetchCount + 1}/${cfg.max_fetches}: ` +
        `${partition.source_name} / ${partition.partition_label} ` +
        `(${partition.minutes_since_fetch === null ? "never fetched" : Math.round(partition.minutes_since_fetch) + "min ago"})`
      );

      // Find the Edge Function for this source type
      const functionName = SOURCE_FUNCTION_MAP[partition.source_type];
      if (!functionName) {
        console.warn(`  No ingest function mapped for source type: ${partition.source_type}`);

        await supabase.rpc("complete_fetch_partition", {
          p_partition_id: partition.partition_id,
          p_success: false,
          p_error: `No ingest function for ${partition.source_type}`,
        });

        fetchResults.push({
          partition_label: partition.partition_label,
          source_name: partition.source_name,
          source_type: partition.source_type,
          status: "skipped",
          error: `No ingest function for ${partition.source_type}`,
        });
        fetchCount++;
        continue;
      }

      if (cfg.dry_run) {
        console.log(`  [DRY RUN] Would invoke ${functionName} with config:`, partition.config_json);
        fetchResults.push({
          partition_label: partition.partition_label,
          source_name: partition.source_name,
          source_type: partition.source_type,
          status: "skipped",
        });
        fetchCount++;
        continue;
      }

      // Invoke the ingestion Edge Function
      try {
        const { data: invokeResult, error: invokeError } = await supabase.functions.invoke(
          functionName,
          {
            body: partition.config_json,
          }
        );

        if (invokeError) {
          throw new Error(invokeError.message || "Invoke failed");
        }

        const summary = invokeResult?.summary || {};
        console.log(`  Result: ${summary.inserted || 0} new, ${summary.updated || 0} updated, ${summary.errors || 0} errors`);

        // Record success
        await supabase.rpc("complete_fetch_partition", {
          p_partition_id: partition.partition_id,
          p_success: true,
          p_result: invokeResult?.summary || null,
        });

        fetchResults.push({
          partition_label: partition.partition_label,
          source_name: partition.source_name,
          source_type: partition.source_type,
          status: "success",
          items_fetched: (summary.inserted || 0) + (summary.updated || 0),
        });
      } catch (fetchErr) {
        const errorMsg = fetchErr instanceof Error ? fetchErr.message : "Unknown error";
        console.error(`  Fetch failed: ${errorMsg}`);

        await supabase.rpc("complete_fetch_partition", {
          p_partition_id: partition.partition_id,
          p_success: false,
          p_error: errorMsg,
        });

        fetchResults.push({
          partition_label: partition.partition_label,
          source_name: partition.source_name,
          source_type: partition.source_type,
          status: "error",
          error: errorMsg,
        });
      }

      fetchCount++;

      // Rate limit delay between fetches
      if (fetchCount < cfg.max_fetches) {
        await new Promise((resolve) => setTimeout(resolve, cfg.delay_ms));
      }
    }

    const durationMs = Date.now() - startTime;
    const successCount = fetchResults.filter((r) => r.status === "success").length;
    const errorCount = fetchResults.filter((r) => r.status === "error").length;

    // Log health event
    await logPipelineHealth(supabase, {
      stage: "ingest",
      items_processed: successCount,
      items_failed: errorCount,
      duration_ms: durationMs,
      details_json: {
        fetches: fetchCount,
        results: fetchResults,
      },
    });

    console.log(`\nCoordinator complete: ${successCount} success, ${errorCount} errors (${durationMs}ms)`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          fetches_attempted: fetchCount,
          success: successCount,
          errors: errorCount,
          duration_ms: durationMs,
        },
        results: fetchResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Coordinator error:", error);
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

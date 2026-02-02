/**
 * Eventbrite Ingestion (DISABLED)
 *
 * Eventbrite removed public geo-discovery endpoints (/v3/events/search/)
 * in February 2020. This function is now a safe no-op that logs its
 * disabled status to pipeline_health_log without making any network calls.
 *
 * Future: Could be re-enabled for curated organizer ingest if specific
 * organization_ids are configured. See docs/eventbrite_deprecation.md.
 *
 * History:
 * - Wave 2 (W2-1): Built geo-discovery ingestion
 * - Wave 3 (W3-0): Disabled — endpoint removed by Eventbrite
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logPipelineHealth } from "../_shared/health-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(
      "Eventbrite ingestion invoked — geo-discovery endpoint is deprecated. " +
      "Exiting cleanly. See docs/eventbrite_deprecation.md."
    );

    // Log disabled status to health pipeline
    await logPipelineHealth(supabase, {
      stage: "ingest",
      source_name: "Eventbrite",
      status: "ok",
      items_processed: 0,
      items_failed: 0,
      duration_ms: Date.now() - startTime,
      details_json: {
        status: "disabled",
        reason: "unsupported_endpoint",
        message:
          "Eventbrite removed /v3/events/search/ in Feb 2020. " +
          "Geo-discovery ingestion is no longer possible. " +
          "Re-enable only with curated organization_ids.",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        status: "disabled",
        reason: "unsupported_endpoint",
        message:
          "Eventbrite removed public geo-discovery (/v3/events/search/) in February 2020. " +
          "This function is now a safe no-op. " +
          "To re-enable, configure specific organization_ids in event_sources.config_json.",
        summary: {
          total_fetched: 0,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          errors: 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Eventbrite no-op error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        status: "disabled",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

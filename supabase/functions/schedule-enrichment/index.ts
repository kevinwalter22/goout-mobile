/**
 * Re-enrichment Scheduler
 *
 * Finds explore_items that need (re-)enrichment and enqueues them.
 * Designed for scheduled execution (daily via pg_cron or manual invoke).
 *
 * Targets items where:
 * - normalized_confidence IS NULL
 * - tags empty or NULL
 * - hook_line missing or too short
 * - availability_json missing for events
 * - llm_enriched_at older than 30 days for active items
 * - price_bucket = 'unknown'
 *
 * Respects rate limits by batching and not re-enqueuing already-queued items.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ScheduleConfig {
  batch_size?: number;      // Max items to enqueue per run
  stale_days?: number;      // Re-enrich if enriched more than N days ago
  dry_run?: boolean;
}

const DEFAULT_CONFIG: Required<ScheduleConfig> = {
  batch_size: 50,
  stale_days: 30,
  dry_run: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let config: ScheduleConfig = {};
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

    const staleCutoff = new Date();
    staleCutoff.setDate(staleCutoff.getDate() - cfg.stale_days);
    const staleCutoffIso = staleCutoff.toISOString();

    // Find items needing enrichment.
    // We query explore_items and LEFT JOIN enrichment_queue to skip
    // items that are already queued/running.
    const { data: candidates, error: queryError } = await supabase
      .rpc("find_items_needing_enrichment", {
        p_stale_cutoff: staleCutoffIso,
        p_limit: cfg.batch_size,
      });

    if (queryError) {
      // RPC might not exist yet — fall back to direct query
      console.warn("RPC find_items_needing_enrichment not found, using direct query");

      const { data: directCandidates, error: directError } = await supabase
        .from("explore_items")
        .select("id, title, normalized_confidence, llm_enriched_at")
        .or(
          "normalized_confidence.is.null," +
          "tags.is.null," +
          "hook_line.is.null," +
          "availability_json.is.null," +
          `llm_enriched_at.lt.${staleCutoffIso}`
        )
        .gte("priority", 0)
        .eq("is_duplicate", false)
        .order("normalized_confidence", { ascending: true, nullsFirst: true })
        .limit(cfg.batch_size);

      if (directError) {
        throw new Error(`Query failed: ${directError.message}`);
      }

      return await enqueueItems(supabase, directCandidates || [], cfg);
    }

    return await enqueueItems(supabase, candidates || [], cfg);
  } catch (error) {
    console.error("Schedule enrichment error:", error);
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

async function enqueueItems(
  supabase: any,
  candidates: any[],
  cfg: Required<ScheduleConfig>
) {
  console.log(`Found ${candidates.length} items needing enrichment`);

  if (cfg.dry_run) {
    return new Response(
      JSON.stringify({
        success: true,
        dry_run: true,
        candidates: candidates.length,
        items: candidates.map((c: any) => ({
          id: c.id,
          title: c.title,
          confidence: c.normalized_confidence,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let enqueued = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of candidates) {
    try {
      // queue_for_enrichment is idempotent (ON CONFLICT DO UPDATE)
      const { error: queueError } = await supabase.rpc("queue_for_enrichment", {
        p_explore_item_id: item.id,
        p_priority: item.normalized_confidence === null ? 20 : 10,
      });

      if (queueError) {
        // May already be queued — that's fine
        if (queueError.message?.includes("duplicate") || queueError.message?.includes("conflict")) {
          skipped++;
        } else {
          console.warn(`Failed to enqueue ${item.id}: ${queueError.message}`);
          errors++;
        }
      } else {
        enqueued++;
      }
    } catch (err) {
      errors++;
    }
  }

  console.log(`Enqueued: ${enqueued}, Skipped: ${skipped}, Errors: ${errors}`);

  return new Response(
    JSON.stringify({
      success: true,
      summary: {
        candidates: candidates.length,
        enqueued,
        skipped,
        errors,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

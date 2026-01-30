/**
 * Normalize Raw Events Worker
 *
 * Processes event_normalization_jobs queue, converting raw ingested data
 * into normalized explore_items records.
 *
 * Features:
 * - Source-agnostic: uses adapter registry for source-specific mapping
 * - Idempotent: upserts on (source_id, external_id)
 * - Batch processing with configurable size
 * - Auto-queues for LLM enrichment after normalization
 *
 * This function should be scheduled to run periodically (every 5-15 minutes)
 * or triggered after ingestion completes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getAdapter,
  hasAdapter,
  getSupportedSourceTypes,
  type NormalizedEvent,
} from "../_shared/source-adapters/index.ts";
import { normalizeFields } from "../_shared/normalize-fields.ts";
import { logPipelineHealth } from "../_shared/health-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WorkerConfig {
  batch_size?: number;
  max_items?: number;
  dry_run?: boolean;
  source_type?: string; // Filter to specific source type
}

interface ProcessResult {
  job_id: string;
  raw_id: string;
  external_id: string;
  title: string;
  status: "normalized" | "skipped" | "error";
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse config
    let config: WorkerConfig = {};
    if (req.method === "POST") {
      try {
        config = await req.json();
      } catch {
        // Empty body OK
      }
    }

    const batchSize = config.batch_size || 10;
    const maxItems = config.max_items || 100;
    const dryRun = config.dry_run || false;

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(
      `Starting normalization worker: batch_size=${batchSize}, max_items=${maxItems}, dry_run=${dryRun}`
    );
    console.log(`Supported adapters: ${getSupportedSourceTypes().join(", ")}`);

    const results: ProcessResult[] = [];
    let processedCount = 0;

    // Process in batches
    while (processedCount < maxItems) {
      // Claim next job using the helper function
      const { data: jobs, error: claimError } = await supabase.rpc(
        "claim_normalization_job"
      );

      if (claimError) {
        console.error("Failed to claim job:", claimError);
        break;
      }

      if (!jobs || jobs.length === 0) {
        console.log("No more jobs in queue");
        break;
      }

      const job = jobs[0];
      console.log(`Processing job ${job.job_id} for raw_id ${job.raw_id}`);

      // Fetch the raw data with source info
      const { data: rawData, error: fetchError } = await supabase
        .from("event_ingest_raw")
        .select(
          `
          id,
          source_id,
          external_id,
          raw_json,
          event_sources!inner (
            id,
            name,
            type
          )
        `
        )
        .eq("id", job.raw_id)
        .single();

      if (fetchError || !rawData) {
        console.error(`Failed to fetch raw data: ${fetchError?.message}`);
        await supabase.rpc("complete_normalization_job", {
          p_job_id: job.job_id,
          p_success: false,
          p_error: `Raw data not found: ${fetchError?.message}`,
        });

        results.push({
          job_id: job.job_id,
          raw_id: job.raw_id,
          external_id: "unknown",
          title: "unknown",
          status: "error",
          error: `Raw data not found`,
        });
        processedCount++;
        continue;
      }

      const source = rawData.event_sources as any;
      const sourceType = source.type;

      // Check if we have an adapter for this source
      if (!hasAdapter(sourceType)) {
        console.log(`No adapter for source type: ${sourceType}, skipping`);

        await supabase.rpc("complete_normalization_job", {
          p_job_id: job.job_id,
          p_success: false,
          p_error: `No adapter for source type: ${sourceType}`,
        });

        // Mark raw record as skipped
        await supabase
          .from("event_ingest_raw")
          .update({ status: "skipped", last_error: "No adapter available" })
          .eq("id", rawData.id);

        results.push({
          job_id: job.job_id,
          raw_id: job.raw_id,
          external_id: rawData.external_id,
          title: "unknown",
          status: "skipped",
          error: `No adapter for ${sourceType}`,
        });
        processedCount++;
        continue;
      }

      // Filter by source type if specified
      if (config.source_type && sourceType !== config.source_type) {
        // Re-queue this job (we're filtering)
        await supabase
          .from("event_normalization_jobs")
          .update({ status: "queued", started_at: null })
          .eq("id", job.job_id);
        continue;
      }

      try {
        // Step 1: Source-specific mapping (adapter)
        const adapter = getAdapter(sourceType)!;
        const mapped: NormalizedEvent = adapter(rawData.raw_json);

        // Step 2: Deterministic field normalization
        // Canonicalizes category, price_bucket, tags, town and computes confidence
        const fieldNorm = normalizeFields({
          category: mapped.category,
          price_bucket: mapped.price_bucket,
          tags: mapped.tags as string[] | undefined,
          town: mapped.town,
        });

        // Merge: adapter output + normalized fields
        const normalized = {
          ...mapped,
          category: fieldNorm.category,
          price_bucket: fieldNorm.price_bucket,
          tags: fieldNorm.tags,
          town: fieldNorm.town,
          normalized_confidence: fieldNorm.normalized_confidence,
        };

        console.log(`  Normalized: "${normalized.title}" (confidence: ${fieldNorm.normalized_confidence})`);

        if (dryRun) {
          console.log(`  [DRY RUN] Would upsert:`, {
            title: normalized.title,
            category: normalized.category,
            price_bucket: normalized.price_bucket,
            starts_at: normalized.starts_at,
            location_name: normalized.location_name,
            confidence: fieldNorm.normalized_confidence,
          });

          await supabase.rpc("complete_normalization_job", {
            p_job_id: job.job_id,
            p_success: true,
            p_error: null,
          });

          results.push({
            job_id: job.job_id,
            raw_id: job.raw_id,
            external_id: rawData.external_id,
            title: normalized.title,
            status: "normalized",
          });
          processedCount++;
          continue;
        }

        // Upsert into explore_items
        const { data: upserted, error: upsertError } = await supabase
          .from("explore_items")
          .upsert(
            {
              source_id: rawData.source_id,
              external_id: rawData.external_id,
              ...normalized,
            },
            {
              onConflict: "source_id,external_id",
            }
          )
          .select("id")
          .single();

        if (upsertError) {
          throw upsertError;
        }

        // Step 3: Compute dedupe_key for cross-source dedup
        if (upserted) {
          await supabase.rpc("compute_dedupe_key", {
            p_title: normalized.title,
            p_starts_at: normalized.starts_at || null,
            p_lat: normalized.lat || null,
            p_lng: normalized.lng || null,
            p_location_name: normalized.location_name || null,
          }).then(async ({ data: dedupeKey }: { data: string | null }) => {
            if (dedupeKey) {
              await supabase
                .from("explore_items")
                .update({ dedupe_key: dedupeKey })
                .eq("id", upserted.id);
            }
          }).catch((err: Error) => {
            console.warn(`  Dedupe key computation failed (non-fatal): ${err.message}`);
          });
        }

        // Mark raw record as normalized
        await supabase
          .from("event_ingest_raw")
          .update({ status: "normalized", last_error: null })
          .eq("id", rawData.id);

        // Queue for LLM enrichment if hook_line is empty
        if (!normalized.hook_line && upserted) {
          await supabase.rpc("queue_for_enrichment", {
            p_explore_item_id: upserted.id,
            p_priority: normalized.is_anchor ? 80 : 50,
          });
          console.log(`  Queued for LLM enrichment`);
        }

        // Complete the job
        await supabase.rpc("complete_normalization_job", {
          p_job_id: job.job_id,
          p_success: true,
          p_error: null,
        });

        results.push({
          job_id: job.job_id,
          raw_id: job.raw_id,
          external_id: rawData.external_id,
          title: normalized.title,
          status: "normalized",
        });

        console.log(`  ✓ Normalized: ${normalized.title}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`  ✗ Failed: ${errorMessage}`);

        // Mark job as failed
        await supabase.rpc("complete_normalization_job", {
          p_job_id: job.job_id,
          p_success: false,
          p_error: errorMessage,
        });

        // Mark raw record as failed
        await supabase
          .from("event_ingest_raw")
          .update({ status: "failed", last_error: errorMessage })
          .eq("id", rawData.id);

        results.push({
          job_id: job.job_id,
          raw_id: job.raw_id,
          external_id: rawData.external_id,
          title: "unknown",
          status: "error",
          error: errorMessage,
        });
      }

      processedCount++;

      // Small delay between items
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Summary
    const normalizedCount = results.filter((r) => r.status === "normalized").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errorCount = results.filter((r) => r.status === "error").length;

    console.log(
      `\nNormalization complete: ${normalizedCount} normalized, ${skipped} skipped, ${errorCount} errors`
    );

    // Log health event (non-blocking)
    await logPipelineHealth(supabase, {
      stage: "normalize",
      items_processed: normalizedCount,
      items_failed: errorCount,
      details_json: { skipped, processed: processedCount },
    });

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          processed: processedCount,
          normalized: normalizedCount,
          skipped,
          errors: errorCount,
        },
        supported_adapters: getSupportedSourceTypes(),
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Normalizer error:", error);
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

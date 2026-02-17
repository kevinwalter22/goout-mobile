/**
 * Run Enrichment Queue Worker
 *
 * Processes the enrichment queue in batches.
 * Designed to be called by a cron job or manually.
 *
 * Features:
 * - Batch processing with configurable size
 * - Exponential backoff on failures
 * - Respects max attempts
 * - Cost-conscious: skips items that don't need enrichment
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLLMProvider } from "../_shared/llm-provider.ts";
import {
  buildEnrichmentPrompt,
  validateEnrichmentResponse,
} from "../_shared/enrichment-schema.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

interface WorkerConfig {
  batch_size?: number;
  max_items?: number;
  dry_run?: boolean;
}

interface ProcessResult {
  job_id: string;
  explore_item_id: string;
  title: string;
  success: boolean;
  error?: string;
  skipped?: boolean;
}

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
    // Parse config from body (optional)
    let config: WorkerConfig = {};
    if (req.method === "POST") {
      try {
        config = await req.json();
      } catch {
        // Empty body is OK
      }
    }

    const batchSize = config.batch_size || 5;
    const maxItems = config.max_items || 50;
    const dryRun = config.dry_run || false;

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if LLM is configured
    let llm;
    try {
      llm = createLLMProvider();
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "LLM not configured",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: ProcessResult[] = [];
    let processedCount = 0;
    let totalTokensUsed = { input: 0, output: 0 };

    console.log(`Starting enrichment worker: batch_size=${batchSize}, max_items=${maxItems}, dry_run=${dryRun}`);

    // Process in batches
    while (processedCount < maxItems) {
      // Claim next job
      const { data: jobs, error: claimError } = await supabase.rpc("claim_enrichment_job");

      if (claimError) {
        console.error("Failed to claim job:", claimError);
        break;
      }

      if (!jobs || jobs.length === 0) {
        console.log("No more jobs in queue");
        break;
      }

      const job = jobs[0];
      console.log(`Processing: ${job.item_title} (${job.explore_item_id})`);

      // Check if enrichment is actually needed
      const needsEnrichment =
        !job.item_hook_line ||
        job.item_hook_line.length < 10 ||
        !job.item_tags ||
        job.item_tags.length === 0 ||
        !job.item_availability_json ||
        job.item_price_bucket === "unknown" ||
        !job.item_description ||
        (job.item_schedule_text && job.item_schedule_text.length > 50 && !job.item_time_text);

      if (!needsEnrichment) {
        // Skip - already has good data
        await supabase.rpc("complete_enrichment_job", {
          p_job_id: job.job_id,
          p_success: true,
          p_error: null,
        });

        // Mark as enriched without calling LLM
        await supabase
          .from("explore_items")
          .update({ llm_enriched_at: new Date().toISOString() })
          .eq("id", job.explore_item_id);

        results.push({
          job_id: job.job_id,
          explore_item_id: job.explore_item_id,
          title: job.item_title,
          success: true,
          skipped: true,
        });

        processedCount++;
        continue;
      }

      if (dryRun) {
        // Dry run - don't actually call LLM
        await supabase.rpc("complete_enrichment_job", {
          p_job_id: job.job_id,
          p_success: false,
          p_error: "Dry run - skipped",
        });

        results.push({
          job_id: job.job_id,
          explore_item_id: job.explore_item_id,
          title: job.item_title,
          success: false,
          skipped: true,
        });

        processedCount++;
        continue;
      }

      try {
        // Build prompt
        const prompt = buildEnrichmentPrompt({
          title: job.item_title,
          description: job.item_description,
          hook_line: job.item_hook_line,
          category: job.item_category,
          schedule_text: job.item_schedule_text,
          time_text: job.item_time_text,
          recurrence: job.item_recurrence,
          season: job.item_season,
          tags: job.item_tags,
        });

        // Call LLM
        const llmResponse = await llm.chat(
          [
            {
              role: "system",
              content:
                "You are a helpful assistant that enriches event data. Always respond with valid JSON only, no markdown or explanation.",
            },
            { role: "user", content: prompt },
          ],
          {
            maxTokens: 512,
            temperature: 0.3,
            jsonMode: llm.name === "openai",
          }
        );

        // Track token usage
        if (llmResponse.usage) {
          totalTokensUsed.input += llmResponse.usage.input_tokens;
          totalTokensUsed.output += llmResponse.usage.output_tokens;
        }

        // Parse response
        let parsedResponse: unknown;
        let jsonStr = llmResponse.content.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        }
        parsedResponse = JSON.parse(jsonStr);

        // Validate
        const validation = validateEnrichmentResponse(parsedResponse);
        if (!validation.valid || !validation.data) {
          throw new Error(`Invalid response: ${validation.errors?.join(", ")}`);
        }

        const enrichment = validation.data;

        // Apply enrichment
        const recurrence = enrichment.availability?.recurrence || enrichment.recurrence;
        const startsAt = enrichment.availability?.next_occurrence || enrichment.next_occurrence?.starts_at;
        const endsAt = enrichment.next_occurrence?.ends_at;

        const { error: applyError } = await supabase.rpc("apply_enrichment", {
          p_explore_item_id: job.explore_item_id,
          p_hook_line: enrichment.hook_line,
          p_tags: enrichment.tags,
          p_recurrence: recurrence,
          p_starts_at: startsAt,
          p_ends_at: endsAt,
          p_availability_json: enrichment.availability || null,
          p_price_bucket: enrichment.price_bucket || null,
          p_description: enrichment.description || null,
          p_time_text: enrichment.short_schedule || null,
        });

        if (applyError) {
          throw new Error(`Failed to apply: ${applyError.message}`);
        }

        // Mark job complete
        await supabase.rpc("complete_enrichment_job", {
          p_job_id: job.job_id,
          p_success: true,
          p_error: null,
        });

        results.push({
          job_id: job.job_id,
          explore_item_id: job.explore_item_id,
          title: job.item_title,
          success: true,
        });

        console.log(`  ✓ Enriched: ${job.item_title}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`  ✗ Failed: ${job.item_title} - ${errorMessage}`);

        // Mark job failed
        await supabase.rpc("complete_enrichment_job", {
          p_job_id: job.job_id,
          p_success: false,
          p_error: errorMessage,
        });

        results.push({
          job_id: job.job_id,
          explore_item_id: job.explore_item_id,
          title: job.item_title,
          success: false,
          error: errorMessage,
        });
      }

      processedCount++;

      // Small delay between items to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Summary
    const successful = results.filter((r) => r.success && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.success && !r.skipped).length;

    console.log(`\nEnrichment complete: ${successful} enriched, ${skipped} skipped, ${failed} failed`);
    console.log(`Total tokens used: ${totalTokensUsed.input} input, ${totalTokensUsed.output} output`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          processed: processedCount,
          enriched: successful,
          skipped,
          failed,
        },
        tokens_used: totalTokensUsed,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Worker error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

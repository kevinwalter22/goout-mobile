/**
 * Enrich Explore Item Edge Function
 *
 * Takes an explore_item_id and enriches it with LLM-generated content:
 * - hook_line (if missing)
 * - tags
 * - recurrence parsing
 * - next occurrence inference
 *
 * Requires service role - not callable from client.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLLMProvider } from "../_shared/llm-provider.ts";
import {
  buildEnrichmentPrompt,
  validateEnrichmentResponse,
} from "../_shared/enrichment-schema.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

interface EnrichRequest {
  explore_item_id: string;
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
    // Parse request body
    const body: EnrichRequest = await req.json();

    if (!body.explore_item_id) {
      return new Response(
        JSON.stringify({ error: "Missing explore_item_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the explore item
    const { data: item, error: fetchError } = await supabase
      .from("explore_items")
      .select("*")
      .eq("id", body.explore_item_id)
      .single();

    if (fetchError || !item) {
      return new Response(
        JSON.stringify({ error: `Item not found: ${fetchError?.message}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skip if already enriched recently (within 7 days)
    if (item.llm_enriched_at) {
      const enrichedAt = new Date(item.llm_enriched_at);
      const daysSinceEnriched = (Date.now() - enrichedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceEnriched < 7) {
        return new Response(
          JSON.stringify({
            success: true,
            skipped: true,
            message: "Item was enriched recently",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Create LLM provider
    const llm = createLLMProvider();

    // Build prompt
    const prompt = buildEnrichmentPrompt({
      title: item.title,
      description: item.description,
      hook_line: item.hook_line,
      category: item.category,
      schedule_text: item.schedule_text,
      time_text: item.time_text,
      recurrence: item.recurrence,
      season: item.season,
      tags: item.tags,
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
        jsonMode: llm.name === "openai", // OpenAI supports native JSON mode
      }
    );

    // Parse LLM response
    let parsedResponse: unknown;
    try {
      // Extract JSON from response (in case of markdown wrapping)
      let jsonStr = llmResponse.content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      parsedResponse = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("Failed to parse LLM response:", llmResponse.content);
      return new Response(
        JSON.stringify({
          error: "Failed to parse LLM response",
          raw: llmResponse.content,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate response
    const validation = validateEnrichmentResponse(parsedResponse);
    if (!validation.valid || !validation.data) {
      return new Response(
        JSON.stringify({
          error: "Invalid LLM response structure",
          errors: validation.errors,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const enrichment = validation.data;

    // Apply enrichment to database
    // Extract recurrence and dates from availability or legacy fields
    const recurrence = enrichment.availability?.recurrence || enrichment.recurrence;
    const startsAt = enrichment.availability?.next_occurrence || enrichment.next_occurrence?.starts_at;
    const endsAt = enrichment.next_occurrence?.ends_at;

    const { error: updateError } = await supabase.rpc("apply_enrichment", {
      p_explore_item_id: body.explore_item_id,
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

    if (updateError) {
      return new Response(
        JSON.stringify({ error: `Failed to apply enrichment: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        enrichment,
        usage: llmResponse.usage,
        validation_warnings: validation.errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Enrichment error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * LLM Reranker Edge Function
 *
 * Reranks top K explore items using LLM for personalized ordering.
 * Behind feature flag with strict budget controls and caching.
 *
 * This is OPTIONAL and disabled by default. The app works fully
 * without this function using deterministic scoring.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RerankRequest {
  user_id?: string;
  items: Array<{
    id: string;
    title: string;
    category?: string;
    tags?: string[];
    base_score: number;
  }>;
  context: {
    time_of_day: string;
    day_of_week: string;
    weather?: string;
  };
}

interface RerankResponse {
  reranked: Array<{
    id: string;
    rank: number;
    reason: string;
  }>;
  cached: boolean;
  tokens_used?: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check feature flag
    const { data: flag, error: flagError } = await supabase
      .from("feature_flags")
      .select("is_enabled, config_json")
      .eq("flag_name", "llm_reranker")
      .single();

    if (flagError || !flag?.is_enabled) {
      return new Response(
        JSON.stringify({
          error: "LLM reranker is disabled",
          code: "FEATURE_DISABLED",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!anthropicKey) {
      return new Response(
        JSON.stringify({
          error: "ANTHROPIC_API_KEY not configured",
          code: "CONFIG_ERROR",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body: RerankRequest = await req.json();

    if (!body.items || body.items.length === 0) {
      return new Response(
        JSON.stringify({ error: "No items to rerank", code: "INVALID_INPUT" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Generate cache key
    const timeBucket = Math.floor(Date.now() / (60 * 60 * 1000)); // Hour bucket
    const itemIds = body.items
      .map((i) => i.id)
      .sort()
      .join(",");
    const cacheKey = `${body.user_id || "anon"}_${timeBucket}_${hashString(itemIds)}`;

    // Check cache
    const { data: cached } = await supabase
      .from("llm_reranker_cache")
      .select("output_ranking")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (cached) {
      return new Response(
        JSON.stringify({
          reranked: cached.output_ranking,
          cached: true,
        } as RerankResponse),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check budget
    const { data: budgetData } = await supabase.rpc("get_api_budget", {
      p_service: "llm_reranker",
    });

    if (budgetData?.[0]?.requests_remaining <= 0) {
      return new Response(
        JSON.stringify({
          error: "Monthly LLM budget exhausted",
          code: "BUDGET_EXCEEDED",
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build prompt
    const prompt = buildRerankPrompt(body.items, body.context);
    const maxTokens = flag.config_json?.max_tokens || 500;

    // Call Anthropic API
    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: maxTokens,
          temperature: 0.3,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          system: `You are a helpful assistant that reranks explore items for a user browsing local events and activities.
Output valid JSON only, no markdown or explanation.
Rerank based on:
- Time of day relevance (${body.context.time_of_day})
- Weather appropriateness (${body.context.weather || "unknown"})
- Natural flow between activities
Keep reasons SHORT (under 10 words each).`,
        }),
      }
    );

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("[rerank] Anthropic API error:", errorText);
      return new Response(
        JSON.stringify({ error: "LLM API error", code: "LLM_ERROR" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const llmResult = await anthropicResponse.json();
    const responseText = llmResult.content?.[0]?.text || "";
    const tokensUsed = llmResult.usage?.output_tokens || 0;

    // Parse response
    let reranked: RerankResponse["reranked"];
    try {
      let jsonStr = responseText.trim();
      // Handle markdown code blocks
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
      const parsed = JSON.parse(jsonStr);
      reranked = parsed.items || parsed;

      // Validate structure
      if (!Array.isArray(reranked)) {
        throw new Error("Response is not an array");
      }
    } catch (parseError) {
      console.error("[rerank] Parse error:", parseError, "Response:", responseText);
      // Return original order on parse failure
      reranked = body.items.map((item, i) => ({
        id: item.id,
        rank: i,
        reason: "Default order",
      }));
    }

    // Cache result
    const cacheTtlHours = flag.config_json?.cache_ttl_hours || 2;
    await supabase.from("llm_reranker_cache").upsert({
      user_id: body.user_id || null,
      cache_key: cacheKey,
      time_bucket: new Date(timeBucket * 60 * 60 * 1000).toISOString(),
      input_item_ids: body.items.map((i) => i.id),
      output_ranking: reranked,
      tokens_used: tokensUsed,
      expires_at: new Date(
        Date.now() + cacheTtlHours * 60 * 60 * 1000
      ).toISOString(),
    });

    // Increment budget counter
    await supabase.rpc("increment_api_usage", {
      p_service: "llm_reranker",
      p_count: 1,
    });

    return new Response(
      JSON.stringify({
        reranked,
        cached: false,
        tokens_used: tokensUsed,
      } as RerankResponse),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[rerank] Unexpected error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        code: "INTERNAL_ERROR",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function buildRerankPrompt(
  items: RerankRequest["items"],
  context: RerankRequest["context"]
): string {
  const itemList = items
    .map(
      (item, i) =>
        `${i + 1}. "${item.title}" [${item.category || "uncategorized"}] tags: ${item.tags?.join(", ") || "none"}`
    )
    .join("\n");

  return `Rerank these ${items.length} items for someone browsing on a ${context.day_of_week} ${context.time_of_day}.
Weather: ${context.weather || "unknown"}

Items:
${itemList}

Return a JSON array with: id, rank (0-indexed), reason (short).
Example format: [{"id": "abc-123", "rank": 0, "reason": "Great for evening"}]`;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

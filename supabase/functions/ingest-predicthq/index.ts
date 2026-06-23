/**
 * PredictHQ Events API v1 — Event Ingestion
 *
 * Fetches upcoming events from PredictHQ and stores raw data in event_ingest_raw.
 *
 * Strategy:
 * - Query within radius of search center
 * - Filter by category and minimum rank
 * - Paginate via offset/next URL
 * - Skip cancelled/postponed events
 * - SHA256 hash for change detection
 * - Budget guardrail: respects api_usage_counters monthly limit
 *
 * Required secrets:
 * - PREDICTHQ_API_KEY: PredictHQ API access token
 *
 * API Reference:
 * https://docs.predicthq.com/api/events/search-events
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logPipelineHealth } from "../_shared/health-log.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

const PHQ_EVENTS_URL = "https://api.predicthq.com/v1/events/";

// ============================================================================
// Config
// ============================================================================

interface IngestConfig {
  lat?: number;
  lng?: number;
  radius_km?: number;
  categories?: string[];
  days_ahead?: number;
  min_rank?: number;
  limit?: number;              // Results per page (PHQ max: 10 on free tier)
  max_pages?: number;
  delay_between_requests_ms?: number;
  dry_run?: boolean;
}

interface IngestResult {
  external_id: string;
  title: string;
  category: string;
  start: string | null;
  status: "inserted" | "updated" | "unchanged" | "skipped" | "error";
  error?: string;
}

const DEFAULT_CATEGORIES = [
  "community", "concerts", "conferences", "expos",
  "festivals", "performing-arts", "sports",
];

// ============================================================================
// Hashing
// ============================================================================

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((v) => stableStringify(v)).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + stableStringify((obj as Record<string, unknown>)[k]),
  );
  return "{" + parts.join(",") + "}";
}

async function hashJson(obj: unknown): Promise<string> {
  const data = new TextEncoder().encode(stableStringify(obj));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// API Caller
// ============================================================================

async function fetchPredictHQEvents(
  apiKey: string,
  url: string,
): Promise<{ results: any[]; nextUrl: string | null; count: number; error?: string }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      results: [],
      nextUrl: null,
      count: 0,
      error: `HTTP ${response.status}: ${errorText.substring(0, 500)}`,
    };
  }

  const data = await response.json();
  return {
    results: data.results || [],
    nextUrl: data.next || null,
    count: data.count || 0,
  };
}

// ============================================================================
// Main Handler
// ============================================================================

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

  const startTime = Date.now();

  try {
    let config: IngestConfig = {};
    if (req.method === "POST") {
      try {
        config = await req.json();
      } catch {
        // Empty body OK
      }
    }

    const lat = config.lat ?? 44.6697;
    const lng = config.lng ?? -74.9814;
    const radiusKm = config.radius_km ?? 50;
    const categories = config.categories ?? DEFAULT_CATEGORIES;
    const daysAhead = config.days_ahead ?? 90;
    const minRank = config.min_rank ?? 20;
    const limit = Math.min(config.limit ?? 10, 10); // PHQ free tier max
    const maxPages = config.max_pages ?? 20;
    const delayMs = config.delay_between_requests_ms ?? 500;
    const dryRun = config.dry_run ?? false;

    // Get API key
    const apiKey = Deno.env.get("PREDICTHQ_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "PREDICTHQ_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Budget check
    const { data: budgetRows } = await supabase.rpc("get_api_budget", {
      p_service: "predicthq",
    });
    const budget = budgetRows?.[0];
    if (budget && budget.requests_remaining <= 0) {
      return new Response(
        JSON.stringify({
          success: false,
          status: "budget_exceeded",
          requests_used: budget.requests_used,
          requests_limit: budget.requests_limit,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get or create PredictHQ source
    let sourceId: string;
    const { data: existingSource } = await supabase
      .from("event_sources")
      .select("id")
      .eq("type", "api_predicthq")
      .single();

    if (existingSource) {
      sourceId = existingSource.id;
    } else {
      const { data: newSource, error: createError } = await supabase
        .from("event_sources")
        .insert({
          name: "PredictHQ",
          type: "api_predicthq",
          is_enabled: true,
          config_json: { api_version: "v1" },
        })
        .select("id")
        .single();

      if (createError || !newSource) {
        throw new Error(`Failed to create source: ${createError?.message}`);
      }
      sourceId = newSource.id;
    }

    // Batch-load existing hashes
    const existingHashes = new Map<string, string>();
    {
      const { data: rows } = await supabase
        .from("event_ingest_raw")
        .select("external_id, raw_hash")
        .eq("source_id", sourceId);
      for (const row of rows || []) {
        existingHashes.set(row.external_id, row.raw_hash);
      }
      console.log(`Loaded ${existingHashes.size} existing hashes`);
    }

    // Build initial query URL
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const initialParams = new URLSearchParams({
      within: `${radiusKm}km@${lat},${lng}`,
      category: categories.join(","),
      "start.gte": today.toISOString().split("T")[0],
      "start.lte": futureDate.toISOString().split("T")[0],
      "rank.gte": minRank.toString(),
      state: "active",
      sort: "start",
      limit: limit.toString(),
    });

    let currentUrl = `${PHQ_EVENTS_URL}?${initialParams}`;

    const results: IngestResult[] = [];
    const seenIds = new Set<string>();
    let totalApiCalls = 0;
    let pageCount = 0;
    let budgetExceeded = false;

    console.log(
      `PredictHQ ingestion: within=${radiusKm}km@${lat},${lng}, ` +
      `categories=${categories.join(",")}, days_ahead=${daysAhead}, ` +
      `min_rank=${minRank}, dry_run=${dryRun}`,
    );

    while (currentUrl && pageCount < maxPages) {
      // Budget guard
      if (budget && totalApiCalls >= budget.requests_remaining) {
        budgetExceeded = true;
        console.log(`Budget limit reached (${totalApiCalls} calls)`);
        break;
      }

      totalApiCalls++;
      pageCount++;

      const { results: events, nextUrl, count, error: fetchError } =
        await fetchPredictHQEvents(apiKey, currentUrl);

      if (fetchError) {
        console.error(`  Page ${pageCount}: ${fetchError}`);
        if (fetchError.includes("429") || fetchError.includes("403")) {
          budgetExceeded = true;
        }
        break;
      }

      if (pageCount === 1) {
        console.log(`  Total events matching query: ${count}`);
      }
      console.log(`  Page ${pageCount}: ${events.length} events`);

      // Increment budget
      await supabase.rpc("increment_api_usage", { p_service: "predicthq", p_count: 1 });

      // Process events
      for (const event of events) {
        const externalId = event.id;
        if (!externalId || seenIds.has(externalId)) continue;
        seenIds.add(externalId);

        // Skip cancelled/postponed events
        if (event.cancelled || event.postponed) {
          results.push({
            external_id: externalId,
            title: event.title,
            category: event.category,
            start: event.start,
            status: "skipped",
          });
          continue;
        }

        if (dryRun) {
          results.push({
            external_id: externalId,
            title: event.title,
            category: event.category,
            start: event.start,
            status: "unchanged",
          });
          continue;
        }

        try {
          const rawHash = await hashJson(event);
          const existingHash = existingHashes.get(externalId);

          if (existingHash === rawHash) {
            results.push({
              external_id: externalId,
              title: event.title,
              category: event.category,
              start: event.start,
              status: "unchanged",
            });
            continue;
          }

          const { error: upsertError } = await supabase
            .from("event_ingest_raw")
            .upsert(
              {
                source_id: sourceId,
                external_id: externalId,
                fetched_at: new Date().toISOString(),
                raw_json: event,
                raw_hash: rawHash,
                status: "new",
              },
              { onConflict: "source_id,external_id" },
            );

          if (upsertError) throw upsertError;

          existingHashes.set(externalId, rawHash);
          results.push({
            external_id: externalId,
            title: event.title,
            category: event.category,
            start: event.start,
            status: existingHash !== undefined ? "updated" : "inserted",
          });
        } catch (error) {
          results.push({
            external_id: externalId,
            title: event.title,
            category: event.category,
            start: event.start,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Move to next page
      currentUrl = nextUrl || "";
      if (!currentUrl || events.length === 0) break;

      // Rate limit
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    // Update last_fetch_at
    if (!dryRun) {
      await supabase
        .from("event_sources")
        .update({ last_fetch_at: new Date().toISOString() })
        .eq("id", sourceId);
    }

    const durationMs = Date.now() - startTime;

    const inserted = results.filter((r) => r.status === "inserted").length;
    const updated = results.filter((r) => r.status === "updated").length;
    const unchanged = results.filter((r) => r.status === "unchanged").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(
      `\nPredictHQ ingestion complete: ${inserted} new, ${updated} updated, ` +
      `${unchanged} unchanged, ${skipped} skipped, ${errors} errors ` +
      `(${totalApiCalls} API calls, ${pageCount} pages, ${durationMs}ms)`,
    );

    // Log health
    await logPipelineHealth(supabase, {
      stage: "ingest",
      source_name: "PredictHQ",
      status: budgetExceeded ? "warn" : errors > 0 ? "warn" : "ok",
      items_processed: inserted + updated,
      items_failed: errors,
      duration_ms: durationMs,
      details_json: {
        api_calls: totalApiCalls,
        pages: pageCount,
        unique_events: seenIds.size,
        inserted,
        updated,
        unchanged,
        skipped,
        errors,
        budget_exceeded: budgetExceeded,
        categories,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          unique_events: seenIds.size,
          api_calls: totalApiCalls,
          pages: pageCount,
          inserted,
          updated,
          unchanged,
          skipped,
          errors,
          duration_ms: durationMs,
          budget_exceeded: budgetExceeded,
        },
        results: results.slice(0, 300),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error("PredictHQ ingestion error:", error);

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await logPipelineHealth(supabase, {
        stage: "ingest",
        source_name: "PredictHQ",
        status: "error",
        items_processed: 0,
        items_failed: 1,
        duration_ms: durationMs,
        details_json: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    } catch {
      // Health logging failure is non-fatal
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

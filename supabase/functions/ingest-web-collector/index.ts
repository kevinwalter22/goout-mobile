/**
 * ingest-web-collector — Web Collector Ingestion Edge Function
 *
 * Collects events from configured web targets using the deterministic
 * extraction pipeline (JSON-LD → ICS → RSS → DOM).
 *
 * Features:
 * - Fetches pages from enabled collector_targets
 * - Caches HTML with content hash change detection
 * - Extracts event candidates using multi-strategy pipeline
 * - Validates candidates and stores in cache
 * - Respects robots.txt and circuit breakers
 *
 * Request body (optional):
 * {
 *   "target_id": "uuid",     // Run only this target (optional)
 *   "dry_run": false,        // Don't store results (optional)
 *   "max_targets": 10        // Max targets to process (optional)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "summary": { targets_processed, pages_fetched, candidates_found, ... },
 *   "results": [{ target_name, pages_fetched, candidates_found, ... }]
 * }
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { WebCollector, CollectorTarget, CollectionResult, EventCandidate } from "../_shared/web-collector.ts";
import { extractCandidates } from "../_shared/web-extractors.ts";
import { logPipelineHealth } from "../_shared/health-log.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

// ============================================================================
// Hashing Utilities
// ============================================================================

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((v) => stableStringify(v)).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      JSON.stringify(k) +
      ":" +
      stableStringify((obj as Record<string, unknown>)[k]),
  );
  return "{" + parts.join(",") + "}";
}

async function hashJson(obj: unknown): Promise<string> {
  const data = new TextEncoder().encode(stableStringify(obj));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateExternalId(candidate: EventCandidate): string {
  // Create a stable external ID from source_url
  // The URL should uniquely identify the event page
  try {
    const url = new URL(candidate.source_url);
    const pathHash = url.pathname.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 100);
    return `web:${url.hostname}${pathHash}`.substring(0, 255);
  } catch {
    // Fallback for invalid URLs
    const titleHash = candidate.title.toLowerCase().replace(/\s+/g, "_").substring(0, 100);
    return `web:${titleHash}`.substring(0, 255);
  }
}

// ============================================================================
// Configuration
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DEFAULT_MAX_TARGETS = 10;

// ============================================================================
// Request Handler
// ============================================================================

serve(async (req) => {
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

  // Parse request body
  let targetId: string | undefined;
  let dryRun = false;
  let maxTargets = DEFAULT_MAX_TARGETS;

  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      targetId = body.target_id;
      dryRun = body.dry_run === true;
      maxTargets = body.max_targets || DEFAULT_MAX_TARGETS;
    }
  } catch {
    // Use defaults
  }

  // Initialize Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Initialize collector
  const collector = new WebCollector(supabase);

  // Summary stats
  const summary = {
    targets_processed: 0,
    targets_skipped: 0,
    pages_fetched: 0,
    pages_cached_hit: 0,
    pages_blocked: 0,
    pages_error: 0,
    candidates_found: 0,
    valid_candidates: 0,
    candidates_queued: 0,  // Candidates inserted into event_ingest_raw
    candidates_blocklisted: 0,
    duration_ms: 0,
  };

  const results: any[] = [];
  const errors: string[] = [];

  try {
    // Get enabled targets
    let targets: CollectorTarget[];

    if (targetId) {
      // Fetch specific target
      const { data, error } = await supabase
        .from("collector_targets")
        .select(`
          id,
          name,
          base_url,
          discovery_urls,
          allowed_paths,
          parsing_strategy,
          dom_selectors,
          user_agent,
          rate_limit_rpm,
          request_delay_ms,
          max_pages_per_run,
          crawl_frequency_minutes,
          source_id,
          town,
          venue_name,
          default_category,
          content_types,
          site_config
        `)
        .eq("id", targetId)
        .single();

      if (error || !data) {
        throw new Error(`Target not found: ${targetId}`);
      }

      targets = [{
        target_id: data.id,
        name: data.name,
        base_url: data.base_url,
        discovery_urls: data.discovery_urls || [],
        allowed_paths: data.allowed_paths || [],
        parsing_strategy: data.parsing_strategy,
        dom_selectors: data.dom_selectors || {},
        user_agent: data.user_agent,
        rate_limit_rpm: data.rate_limit_rpm,
        request_delay_ms: data.request_delay_ms,
        max_pages_per_run: data.max_pages_per_run,
        minutes_since_last_run: null,
        crawl_frequency_minutes: data.crawl_frequency_minutes,
        source_id: data.source_id,
        town: data.town || null,
        venue_name: data.venue_name || null,
        default_category: data.default_category || null,
        content_types: data.content_types || ["events"],
        site_config: data.site_config || {},
      }];
    } else {
      // Get all enabled targets that are due
      targets = await collector.getEnabledTargets();
    }

    if (targets.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          status: "no_targets",
          message: "No enabled collector targets ready to run",
          summary,
          results: [],
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Load blocklist once for the entire run
    const { data: blocklistRows } = await supabase
      .from("collector_blocklist")
      .select("pattern_type, pattern");
    const blocklist = (blocklistRows || []).map((row: { pattern_type: string; pattern: string }) => ({
      type: row.pattern_type as "domain" | "url_pattern" | "title_pattern",
      pattern: row.pattern,
      regex: row.pattern_type === "title_pattern" || row.pattern_type === "url_pattern"
        ? (() => { try { return new RegExp(row.pattern, "i"); } catch { return null; } })()
        : null,
    }));

    // Limit number of targets
    const targetsToProcess = targets.slice(0, maxTargets);

    console.log(`Processing ${targetsToProcess.length} collector targets (blocklist: ${blocklist.length} rules)`);

    // Process each target
    for (const target of targetsToProcess) {
      console.log(`\n=== Processing target: ${target.name} ===`);
      console.log(`  Base URL: ${target.base_url}`);
      console.log(`  Discovery URLs: ${target.discovery_urls.join(", ")}`);
      console.log(`  Strategy: ${target.parsing_strategy}`);

      try {
        // Collect pages
        const collectionResult = await collector.collectTarget(target);

        // Extract candidates from newly fetched/changed pages
        const { data: cachedPages } = await supabase
          .from("collector_page_cache")
          .select("*")
          .eq("target_id", target.target_id)
          .is("extracted_candidates", null)  // Only process unextracted pages
          .not("raw_html", "is", null);

        let extractedCount = 0;
        let validCount = 0;
        let queuedCount = 0;

        if (cachedPages && cachedPages.length > 0) {
          console.log(`  Extracting from ${cachedPages.length} cached pages...`);

          for (const page of cachedPages) {
            if (!page.raw_html) continue;

            const { candidates, errors: extractErrors } = await extractCandidates(
              page.raw_html,
              page.url,
              target,
            );

            extractedCount += candidates.length;
            validCount += candidates.filter((c) => c.is_valid).length;

            if (extractErrors.length > 0) {
              console.log(`    Extraction errors for ${page.url}: ${extractErrors.join(", ")}`);
            }

            // Store extraction results (unless dry run)
            if (!dryRun && candidates.length > 0) {
              await collector.updateExtractionResults(
                page.id,
                candidates,
                target.parsing_strategy,
                extractErrors,
              );

              // Insert valid candidates into event_ingest_raw for normalization
              if (target.source_id) {
                const validCandidates = candidates.filter((c) => c.is_valid);
                for (const candidate of validCandidates) {
                  // Check candidate against blocklist
                  const blocked = blocklist.some((rule: { type: string; pattern: string; regex: RegExp | null }) => {
                    if (rule.type === "domain") {
                      try {
                        return new URL(candidate.source_url).hostname.includes(rule.pattern);
                      } catch { return false; }
                    }
                    if (rule.type === "url_pattern" && rule.regex) {
                      return rule.regex.test(candidate.source_url);
                    }
                    if (rule.type === "title_pattern" && rule.regex) {
                      return rule.regex.test(candidate.title);
                    }
                    return false;
                  });
                  if (blocked) {
                    summary.candidates_blocklisted++;
                    continue;
                  }

                  try {
                    // Add target metadata to candidate for normalization adapter
                    const enrichedCandidate = {
                      ...candidate,
                      _target_name: target.name,
                      _target_base_url: target.base_url,
                      _target_town: target.town,
                      _target_venue_name: target.venue_name,
                      _target_default_category: target.default_category,
                      _target_content_types: target.content_types,
                    };

                    const externalId = generateExternalId(candidate);
                    const rawHash = await hashJson(enrichedCandidate);

                    const { error: upsertError } = await supabase
                      .from("event_ingest_raw")
                      .upsert(
                        {
                          source_id: target.source_id,
                          external_id: externalId,
                          fetched_at: new Date().toISOString(),
                          raw_json: enrichedCandidate,
                          raw_hash: rawHash,
                          status: "new",
                        },
                        { onConflict: "source_id,external_id" },
                      );

                    if (upsertError) {
                      console.warn(`    Failed to upsert candidate "${candidate.title}": ${upsertError.message}`);
                    } else {
                      queuedCount++;
                    }
                  } catch (err) {
                    console.warn(`    Error inserting candidate "${candidate.title}": ${err}`);
                  }
                }
                console.log(`    Queued ${queuedCount} valid candidates for normalization`);
              }
            }

            console.log(`    ${page.url}: ${candidates.length} candidates (${candidates.filter(c => c.is_valid).length} valid)`);
          }
        }

        // Update result
        const targetResult = {
          target_id: target.target_id,
          target_name: target.name,
          base_url: target.base_url,
          pages_fetched: collectionResult.pages_fetched,
          pages_cached_hit: collectionResult.pages_cached_hit,
          pages_blocked: collectionResult.pages_blocked,
          pages_error: collectionResult.pages_error,
          candidates_extracted: extractedCount,
          valid_candidates: validCount,
          candidates_queued: queuedCount,
          circuit_tripped: collectionResult.circuit_tripped,
          errors: collectionResult.errors,
          duration_ms: collectionResult.duration_ms,
        };

        results.push(targetResult);

        // Update summary
        summary.targets_processed++;
        summary.pages_fetched += collectionResult.pages_fetched;
        summary.pages_cached_hit += collectionResult.pages_cached_hit;
        summary.pages_blocked += collectionResult.pages_blocked;
        summary.pages_error += collectionResult.pages_error;
        summary.candidates_found += extractedCount;
        summary.valid_candidates += validCount;
        summary.candidates_queued += queuedCount;

        console.log(`  Result: ${collectionResult.pages_fetched} fetched, ${collectionResult.pages_cached_hit} cached, ${extractedCount} candidates, ${queuedCount} queued`);

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`${target.name}: ${errorMsg}`);
        console.error(`  Error processing ${target.name}: ${errorMsg}`);

        results.push({
          target_id: target.target_id,
          target_name: target.name,
          base_url: target.base_url,
          pages_fetched: 0,
          pages_cached_hit: 0,
          pages_blocked: 0,
          pages_error: 1,
          candidates_extracted: 0,
          valid_candidates: 0,
          circuit_tripped: false,
          errors: [errorMsg],
          duration_ms: 0,
        });

        summary.targets_skipped++;
      }
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    errors.push(errorMsg);
    console.error(`Fatal error: ${errorMsg}`);
  }

  // Calculate total duration
  summary.duration_ms = Date.now() - startTime;

  // Log overall health
  await logPipelineHealth(supabase, {
    stage: "ingest",
    source_name: "Web Collector",
    status: errors.length > 0 ? "warn" : "ok",
    items_processed: summary.candidates_found,
    items_failed: summary.pages_error,
    duration_ms: summary.duration_ms,
    details_json: {
      targets_processed: summary.targets_processed,
      targets_skipped: summary.targets_skipped,
      pages_fetched: summary.pages_fetched,
      pages_cached_hit: summary.pages_cached_hit,
      pages_blocked: summary.pages_blocked,
      valid_candidates: summary.valid_candidates,
      candidates_queued: summary.candidates_queued,
      candidates_blocklisted: summary.candidates_blocklisted,
      dry_run: dryRun,
      errors: errors.slice(0, 10),
    },
  });

  console.log(`\n=== Web Collector Complete ===`);
  console.log(`  Targets: ${summary.targets_processed} processed, ${summary.targets_skipped} skipped`);
  console.log(`  Pages: ${summary.pages_fetched} fetched, ${summary.pages_cached_hit} cached`);
  console.log(`  Candidates: ${summary.candidates_found} found, ${summary.valid_candidates} valid, ${summary.candidates_queued} queued, ${summary.candidates_blocklisted} blocklisted`);
  console.log(`  Duration: ${summary.duration_ms}ms`);

  return new Response(
    JSON.stringify({
      success: true,
      dry_run: dryRun,
      summary,
      results,
      errors: errors.length > 0 ? errors : undefined,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});

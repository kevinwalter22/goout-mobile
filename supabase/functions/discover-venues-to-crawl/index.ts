/**
 * discover-venues-to-crawl
 *
 * Phase 5.3 enqueue path. Reads explore_items that:
 *   - Have a non-null website_url
 *   - Are not soft-deleted
 *   - Pass the relevance gate (relevance_tier >= 2)
 *   - Are not effective-chain venues (COALESCE(is_chain_override, is_chain) = FALSE)
 *   - Are not in the design-doc exclusion list (gas_station, pharmacy, atm,
 *     bank, post_office, hospital, dentist, lawyer, accounting,
 *     insurance_agency, real_estate_agency, car_repair, car_dealer, lodging)
 *   - Do not already have a venue_crawl_state row for the (item, url) pair
 *
 * Inserts up to `max_per_run` new rows into venue_crawl_state. Each row
 * starts pending with next_eligible_at=NOW(), so ingest-venue-website
 * picks them up on the next tick.
 *
 * Auth: service-role only.
 *
 * Request body (all optional):
 *   { max_per_run?: number = 50,
 *     dry_run?: boolean = false }
 *
 * Response:
 *   { success: true,
 *     summary: { scanned, eligible, already_enqueued, inserted, dry_run } }
 *
 * Schedule: cron hourly (separate migration, NOT auto-applied — operator
 * enables when comfortable with the validation cohort yield).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logPipelineHealth } from "../_shared/health-log.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

const DEFAULT_MAX_PER_RUN = 50;

// Sub-category exclusion list (mirrors docs/llm_extraction_design.md §C).
// These are venues that effectively never host events; even if Google
// Places returns a website, the crawl yield is ~0 and the LLM-budget cost
// outweighs any signal.
const EXCLUDED_SUB_CATEGORIES = [
  "gas_station",
  "pharmacy",
  "atm",
  "bank",
  "post_office",
  "hospital",
  "dentist",
  "lawyer",
  "accounting",
  "insurance_agency",
  "real_estate_agency",
  "car_repair",
  "car_dealer",
  "lodging",
];

interface RequestConfig {
  max_per_run?: number;
  dry_run?: boolean;
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

  const startTime = Date.now();

  try {
    let config: RequestConfig = {};
    if (req.method === "POST") {
      try {
        config = await req.json();
      } catch {
        // Empty body OK
      }
    }

    const maxPerRun = Math.max(
      1,
      Math.min(config.max_per_run ?? DEFAULT_MAX_PER_RUN, 500),
    );
    const dryRun = config.dry_run === true;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── 1. Pull candidate explore_items ────────────────────────────────
    // Selection criteria, in order of selectivity:
    //   - website_url IS NOT NULL
    //   - deleted_at IS NULL
    //   - relevance_tier >= 2
    //   - sub_category NOT IN exclusion list
    //   - COALESCE(is_chain_override, is_chain) = FALSE
    //
    // PostgREST can't express COALESCE in a single filter chain, so we
    // pull a slight overdraft (max_per_run * 4) and filter chain rows
    // client-side. Cheap because the partial index on is_chain=TRUE makes
    // the chain check fast at scale.

    // The design doc referred to "website_url"; the actual column on
    // explore_items is `source_url`. For Google Places venues (kind='activity'),
    // source_url is set by the adapter from Google's websiteUri field and
    // therefore points to the venue's homepage — which is what we want to
    // crawl. For events (kind='event'), source_url is typically a ticket
    // page (Ticketmaster, etc.) which we explicitly do NOT want to crawl.
    const overdraft = maxPerRun * 4;
    const { data: candidates, error: candErr } = await supabase
      .from("explore_items")
      .select(
        "id, title, source_url, town, category, sub_category, is_chain, is_chain_override, normalized_confidence",
      )
      .eq("kind", "activity")
      .not("source_url", "is", null)
      .is("deleted_at", null)
      .gte("relevance_tier", 2)
      .not("sub_category", "in", `(${EXCLUDED_SUB_CATEGORIES.join(",")})`)
      .order("normalized_confidence", { ascending: false, nullsFirst: false })
      .limit(overdraft);

    if (candErr) {
      throw new Error(`Failed to query explore_items: ${candErr.message}`);
    }

    const allCandidates = candidates || [];

    // ── 2. Filter out effective-chain rows + invalid URLs ──────────────
    const eligible = allCandidates.filter((row) => {
      const effectiveChain = row.is_chain_override ?? row.is_chain ?? false;
      if (effectiveChain) return false;
      if (!row.source_url || typeof row.source_url !== "string") return false;
      // Reject non-http schemes (mailto:, tel:, etc.) and obviously broken URLs
      if (!/^https?:\/\//i.test(row.source_url)) return false;
      return true;
    });

    // ── 3. Check which (explore_item_id, website_url) pairs are already enqueued
    let alreadyEnqueued = 0;
    let toInsert: { explore_item_id: string; website_url: string }[] = [];

    if (eligible.length > 0) {
      const eligibleIds = eligible.map((e) => e.id);
      const { data: existing, error: existErr } = await supabase
        .from("venue_crawl_state")
        .select("explore_item_id, website_url")
        .in("explore_item_id", eligibleIds);

      if (existErr) {
        throw new Error(`Failed to query venue_crawl_state: ${existErr.message}`);
      }

      const existingPairs = new Set(
        (existing || []).map((r) => `${r.explore_item_id}|${r.website_url}`),
      );

      for (const row of eligible) {
        // We store the URL in venue_crawl_state.website_url (the storage
        // name from migration 131); the value comes from explore_items.source_url.
        const key = `${row.id}|${row.source_url}`;
        if (existingPairs.has(key)) {
          alreadyEnqueued++;
        } else {
          toInsert.push({
            explore_item_id: row.id,
            website_url: row.source_url,
          });
        }
        if (toInsert.length >= maxPerRun) break;
      }
    }

    // ── 4. Insert ──────────────────────────────────────────────────────
    let inserted = 0;
    if (!dryRun && toInsert.length > 0) {
      // Chunk inserts for large batches (PostgREST has a request-size limit)
      const CHUNK = 100;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        const { error: insErr } = await supabase
          .from("venue_crawl_state")
          .insert(chunk);
        if (insErr) {
          // Don't throw — partial inserts are fine; log and continue
          console.warn(
            `venue_crawl_state insert chunk ${i} failed: ${insErr.message}`,
          );
        } else {
          inserted += chunk.length;
        }
      }
    } else if (dryRun) {
      inserted = toInsert.length;
    }

    const durationMs = Date.now() - startTime;

    const summary = {
      scanned: allCandidates.length,
      eligible: eligible.length,
      already_enqueued: alreadyEnqueued,
      inserted,
      dry_run: dryRun,
    };

    await logPipelineHealth(supabase, {
      stage: "discover",
      source_name: "Auto-Discovered Venue",
      status: "ok",
      items_processed: inserted,
      items_failed: 0,
      duration_ms: durationMs,
      details_json: { ...summary, max_per_run: maxPerRun },
    });

    console.log(
      `discover-venues-to-crawl: scanned=${summary.scanned} ` +
        `eligible=${summary.eligible} already=${summary.already_enqueued} ` +
        `inserted=${summary.inserted} (${durationMs}ms)`,
    );

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("discover-venues-to-crawl error:", message);

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await logPipelineHealth(supabase, {
        stage: "discover",
        source_name: "Auto-Discovered Venue",
        status: "error",
        items_processed: 0,
        items_failed: 1,
        duration_ms: durationMs,
        details_json: { error: message },
      });
    } catch {
      // ignore
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

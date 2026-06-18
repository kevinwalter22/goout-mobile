/**
 * ingest-venue-website
 *
 * Phase 5.3 consumer. Claims N rows from venue_crawl_state, fetches each
 * venue's website (root + up to 2 events-like subpages), runs the Phase 5.1
 * LLM extractor, and queues candidates into event_ingest_raw under the
 * synthetic "Auto-Discovered Venue" source.
 *
 * Per-row lifecycle update on each crawl:
 *   - last_crawled_at, last_run_events_found, events_found_count cumulative
 *   - consecutive_empty_runs (0 if events>0, else += 1)
 *   - consecutive_errors (0 on success, else += 1)
 *   - llm_cost_cents_total += this run's cost
 *   - next_eligible_at + status per the backoff/disable rules below
 *
 * Backoff (empty-run, schedule from design doc §D):
 *   empty 0-1 → 7d
 *   empty 2-5 → 14d
 *   empty 6-11 → 30d + status='backing_off'
 *   empty ≥12 → status='disabled' (terminal)
 *
 * Error backoff (exponential, capped):
 *   errors 1 → 1h
 *   errors 2 → 2h
 *   …
 *   errors 5+ → status='disabled' (terminal)
 *
 * Per-venue spending cap:
 *   llm_cost_cents_total > VENUE_COST_CAP_CENTS (default 100 = $1)
 *   → status='disabled'
 *
 * Auth: service-role only.
 *
 * Request body (all optional):
 *   { max_per_run?: number = 5,
 *     target_id?: string (UUID — force a single venue_crawl_state row),
 *     dry_run?: boolean = false }
 *
 * Schedule: cron hourly (separate migration, NOT auto-applied — operator
 * enables when comfortable with the validation cohort yield).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logPipelineHealth } from "../_shared/health-log.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { isCivicContent } from "../_shared/civic-filter.ts";
import {
  extractEvents,
  type ExtractedEvent,
  type ExtractionHints,
} from "../_shared/llm-extractor.ts";
import type {
  EventCandidate,
  ExtractionEvidence,
} from "../_shared/web-collector.ts";

const DEFAULT_MAX_PER_RUN = 5;
const VENUE_COST_CAP_CENTS = 100;             // per-venue lifetime cap = $1
const LLM_CANDIDATE_CONFIDENCE = 75;
const LLM_FALLBACK_THRESHOLD_PER_PAGE = 2;    // (unused for venues, kept for parity)
const REQUEST_DELAY_MS = 6000;                // inter-page delay within a single venue crawl
const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_BYTES = 800_000;               // hard cap on per-page response size (~800KB)
const SUBPAGE_MAX = 2;
const USER_AGENT = "EudaBot/1.0 (auto-discovered-venue crawler)";

const SUBPAGE_PATTERNS = /\b(events?|calendar|whats[\-_]?on|programs?|shows?|happenings?)\b/i;

// Source name set in migration 131. Look up id by name at startup.
const AUTO_SOURCE_NAME = "Auto-Discovered Venue";

interface CrawlStateRow {
  id: string;
  explore_item_id: string;
  website_url: string;
  consecutive_empty_runs: number;
  consecutive_errors: number;
  llm_cost_cents_total: number;
  events_found_count: number;
}

interface ExploreItemContext {
  id: string;
  title: string;
  town: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
}

interface PerVenueResult {
  crawl_state_id: string;
  explore_item_id: string;
  website_url: string;
  pages_fetched: number;
  events_found: number;
  candidates_queued: number;
  candidates_civic_filtered: number;
  cost_cents: number;
  status: "ok" | "robots_blocked" | "fetch_error" | "extractor_error" | "budget_exhausted";
  error?: string;
  duration_ms: number;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function nextEligibleAfterEmpty(consecutive_empty_runs: number): Date {
  const now = Date.now();
  const day = 86400_000;
  if (consecutive_empty_runs >= 6) return new Date(now + 30 * day);
  if (consecutive_empty_runs >= 2) return new Date(now + 14 * day);
  return new Date(now + 7 * day);
}

function nextEligibleAfterError(consecutive_errors: number): Date {
  // Exponential: 1h, 2h, 4h, 8h, 16h. Capped at 16h since errors=5+ disables.
  const hours = Math.min(Math.pow(2, consecutive_errors - 1), 16);
  return new Date(Date.now() + hours * 3600_000);
}

function computeStatus(
  consecutive_empty_runs: number,
  consecutive_errors: number,
  llm_cost_cents_total: number,
): "active" | "backing_off" | "disabled" {
  if (llm_cost_cents_total > VENUE_COST_CAP_CENTS) return "disabled";
  if (consecutive_errors >= 5) return "disabled";
  if (consecutive_empty_runs >= 12) return "disabled";
  if (consecutive_empty_runs >= 6) return "backing_off";
  return "active";
}

async function fetchWithTimeout(
  url: string,
  ms: number,
): Promise<{ ok: boolean; status: number; html: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        html: "",
        error: `HTTP ${resp.status}`,
      };
    }
    // Read with size cap
    const reader = resp.body?.getReader();
    if (!reader) return { ok: true, status: resp.status, html: "" };
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTML_BYTES) {
        reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(bytes);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { ok: true, status: resp.status, html };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      html: "",
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

// Minimal robots.txt check — returns true if the bot is allowed to crawl
// the root path. Conservative on parse failures (allows). We're a polite
// low-volume crawler; this is mostly to honor explicit Disallow: / rules.
async function isRobotsAllowed(websiteUrl: string): Promise<boolean> {
  try {
    const u = new URL(websiteUrl);
    const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
    const r = await fetchWithTimeout(robotsUrl, 5000);
    if (!r.ok || !r.html) return true; // No robots.txt = allowed
    // Look for a blanket "Disallow: /" under any User-agent we'd match.
    // We don't implement full robots.txt parsing; just catch the common
    // explicit-block case.
    const lines = r.html.split("\n").map((l) => l.split("#")[0].trim());
    let block = false;
    let inMatching = false;
    for (const line of lines) {
      if (!line) {
        inMatching = false;
        continue;
      }
      const lower = line.toLowerCase();
      if (lower.startsWith("user-agent:")) {
        const agent = lower.slice("user-agent:".length).trim();
        inMatching = agent === "*" || agent === "eudabot";
        continue;
      }
      if (inMatching && lower.startsWith("disallow:")) {
        const path = lower.slice("disallow:".length).trim();
        if (path === "/" || path === "") {
          // "Disallow:" with empty path = allow all; "/" = block all
          if (path === "/") block = true;
        }
      }
    }
    return !block;
  } catch {
    return true;
  }
}

function findSubpages(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const base = new URL(baseUrl);
  const matches = html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi);
  for (const m of matches) {
    const href = m[1];
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    if (!SUBPAGE_PATTERNS.test(href)) continue;
    try {
      const u = new URL(href, baseUrl);
      if (u.hostname !== base.hostname) continue;       // same-domain only
      if (u.pathname === base.pathname && !u.search) continue; // skip self
      if (u.pathname.match(/\.(jpg|png|gif|svg|pdf|zip|mp4|webp)$/i)) continue;
      out.add(u.href);
      if (out.size >= SUBPAGE_MAX * 4) break;
    } catch {
      // ignore
    }
  }
  return [...out].slice(0, SUBPAGE_MAX);
}

/**
 * Same shape as ingest-web-collector's llmEventToCandidate. Duplicated
 * here to avoid coupling the two functions; if a third caller appears,
 * lift into _shared/.
 */
function llmEventToCandidate(
  ev: ExtractedEvent,
  pageUrl: string,
  ctx: ExploreItemContext,
): EventCandidate {
  const evidence: ExtractionEvidence[] = [
    {
      field: "title",
      source: "dom",
      value: ev.title,
      raw_snippet: ev.title_evidence,
    },
  ];
  if (ev.starts_at) {
    evidence.push({
      field: "starts_at",
      source: "dom",
      value: ev.starts_at,
      raw_snippet: ev.date_evidence ?? undefined,
    });
  }
  if (ev.recurrence_text) {
    evidence.push({ field: "recurrence_text", source: "dom", value: ev.recurrence_text });
  }
  if (ev.description) {
    evidence.push({ field: "description", source: "dom", value: ev.description });
  }

  let sourceUrl = pageUrl;
  if (ev.source_url_path) {
    try {
      sourceUrl = new URL(ev.source_url_path, pageUrl).href;
    } catch {
      // Keep pageUrl
    }
  }

  const hasTemporal = !!(ev.starts_at || ev.recurrence_text);

  const candidate: EventCandidate & {
    _llm_extracted?: boolean;
    _llm_title_evidence?: string;
    _llm_date_evidence?: string | null;
    _llm_price_text?: string | null;
    _target_kind?: string;
    _target_venue_name?: string;
    _target_town?: string;
    _target_default_category?: string;
  } = {
    title: ev.title,
    source_url: sourceUrl,
    starts_at: ev.starts_at ?? undefined,
    ends_at: ev.ends_at ?? undefined,
    recurrence_text: ev.recurrence_text ?? undefined,
    description_snippet: ev.description ?? undefined,
    // Inherit the parent venue's coordinates. LLM extraction does not derive
    // lat/lng from page HTML, so without this inheritance every venue-website
    // event is map-invisible. Inheriting from the explore_item that owns the
    // crawl is correct: the event is happening AT the venue.
    location_name: ctx.title,
    address: ctx.address ?? undefined,
    lat: ctx.lat ?? undefined,
    lng: ctx.lng ?? undefined,
    evidence,
    extraction_strategy: "html_dom",
    confidence: LLM_CANDIDATE_CONFIDENCE,
    validation_errors: hasTemporal ? [] : ["Missing temporal signal (LLM extraction)"],
    is_valid: hasTemporal,
    _llm_extracted: true,
    _llm_title_evidence: ev.title_evidence,
    _llm_date_evidence: ev.date_evidence,
    _llm_price_text: ev.price_text,
    // Auto-discovered provenance — these mirror the _target_* fields the
    // web_collector source-adapter reads for normalization context.
    _target_kind: "auto_discovered",
    _target_venue_name: ctx.title,
    _target_town: ctx.town ?? "",
    _target_default_category: ctx.category ?? "",
  };
  return candidate;
}

async function hasAnthropicBudget(
  supabase: any,
): Promise<{ ok: boolean; remaining: number }> {
  try {
    const { data, error } = await supabase.rpc("get_api_budget", {
      p_service: "anthropic_haiku",
    });
    if (error || !data || data.length === 0) return { ok: true, remaining: -1 };
    const remaining = data[0].requests_remaining ?? 0;
    return { ok: remaining > 0, remaining };
  } catch {
    return { ok: true, remaining: -1 };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────────────

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
    let cfg: { max_per_run?: number; target_id?: string; dry_run?: boolean } = {};
    if (req.method === "POST") {
      try {
        cfg = await req.json();
      } catch {
        // empty body ok
      }
    }

    const maxPerRun = Math.max(1, Math.min(cfg.max_per_run ?? DEFAULT_MAX_PER_RUN, 50));
    const targetId = cfg.target_id ?? null;
    const dryRun = cfg.dry_run === true;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Lookup synthetic source_id ───────────────────────────────────
    const { data: sourceRows, error: srcErr } = await supabase
      .from("event_sources")
      .select("id")
      .eq("name", AUTO_SOURCE_NAME)
      .limit(1);
    if (srcErr || !sourceRows || sourceRows.length === 0) {
      throw new Error(
        `Synthetic source '${AUTO_SOURCE_NAME}' not found — apply migration 131`,
      );
    }
    const sourceId = sourceRows[0].id;

    // ── Initial budget check ─────────────────────────────────────────
    const initialBudget = await hasAnthropicBudget(supabase);
    if (!initialBudget.ok) {
      console.log("ingest-venue-website: anthropic budget exhausted, skip run");
      await logPipelineHealth(supabase, {
        stage: "ingest",
        source_name: AUTO_SOURCE_NAME,
        status: "warn",
        items_processed: 0,
        items_failed: 0,
        duration_ms: Date.now() - startTime,
        details_json: { skipped: "budget_exhausted", remaining: initialBudget.remaining },
      });
      return new Response(
        JSON.stringify({ success: true, skipped: "budget_exhausted" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Claim rows ────────────────────────────────────────────────────
    let claimQuery = supabase
      .from("venue_crawl_state")
      .select(
        "id, explore_item_id, website_url, consecutive_empty_runs, consecutive_errors, llm_cost_cents_total, events_found_count",
      )
      .neq("status", "disabled")
      .lte("next_eligible_at", new Date().toISOString())
      .order("next_eligible_at", { ascending: true })
      .limit(maxPerRun);

    if (targetId) {
      claimQuery = supabase
        .from("venue_crawl_state")
        .select(
          "id, explore_item_id, website_url, consecutive_empty_runs, consecutive_errors, llm_cost_cents_total, events_found_count",
        )
        .eq("id", targetId);
    }

    const { data: rows, error: rowsErr } = await claimQuery;
    if (rowsErr) throw new Error(`claim query failed: ${rowsErr.message}`);
    const claimed: CrawlStateRow[] = (rows || []) as CrawlStateRow[];

    if (claimed.length === 0) {
      console.log("ingest-venue-website: no eligible rows");
      return new Response(
        JSON.stringify({ success: true, summary: { claimed: 0, processed: 0 } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Look up explore_items context for each row ───────────────────
    const itemIds = claimed.map((r) => r.explore_item_id);
    const { data: itemRows, error: itemErr } = await supabase
      .from("explore_items")
      .select("id, title, town, category, lat, lng, address")
      .in("id", itemIds);
    if (itemErr) throw new Error(`item context query failed: ${itemErr.message}`);
    const itemCtx = new Map<string, ExploreItemContext>(
      (itemRows || []).map((r: any) => [r.id, r]),
    );

    const results: PerVenueResult[] = [];
    let aggregateCostCents = 0;
    let aggregateEventsFound = 0;
    let aggregateCandidatesQueued = 0;
    let aggregateCandidatesCivicFiltered = 0;

    // ── Per-venue processing ─────────────────────────────────────────
    for (const row of claimed) {
      const venueStart = Date.now();
      const ctx = itemCtx.get(row.explore_item_id);
      const r: PerVenueResult = {
        crawl_state_id: row.id,
        explore_item_id: row.explore_item_id,
        website_url: row.website_url,
        pages_fetched: 0,
        events_found: 0,
        candidates_queued: 0,
        candidates_civic_filtered: 0,
        cost_cents: 0,
        status: "ok",
        duration_ms: 0,
      };

      try {
        // Per-iteration budget check
        const budget = await hasAnthropicBudget(supabase);
        if (!budget.ok) {
          r.status = "budget_exhausted";
          r.error = `remaining=${budget.remaining}`;
          // Don't bump consecutive_errors — this is a system constraint, not a venue problem.
          // Just delay this row by 1 day so it gets re-evaluated tomorrow.
          if (!dryRun) {
            await supabase
              .from("venue_crawl_state")
              .update({ next_eligible_at: new Date(Date.now() + 86400_000).toISOString() })
              .eq("id", row.id);
          }
          r.duration_ms = Date.now() - venueStart;
          results.push(r);
          continue;
        }

        // robots.txt
        const allowed = await isRobotsAllowed(row.website_url);
        if (!allowed) {
          r.status = "robots_blocked";
          r.error = "robots.txt blocks crawling";
          if (!dryRun) {
            const newErrors = row.consecutive_errors + 1;
            const newStatus = computeStatus(
              row.consecutive_empty_runs,
              newErrors,
              row.llm_cost_cents_total,
            );
            await supabase
              .from("venue_crawl_state")
              .update({
                consecutive_errors: newErrors,
                last_error: r.error,
                last_crawled_at: new Date().toISOString(),
                next_eligible_at: nextEligibleAfterError(newErrors).toISOString(),
                status: newStatus,
              })
              .eq("id", row.id);
          }
          r.duration_ms = Date.now() - venueStart;
          results.push(r);
          continue;
        }

        // Fetch root
        const rootRes = await fetchWithTimeout(row.website_url, FETCH_TIMEOUT_MS);
        if (!rootRes.ok || !rootRes.html) {
          throw new Error(`root fetch: ${rootRes.error ?? `HTTP ${rootRes.status}`}`);
        }
        r.pages_fetched++;

        // Discover subpages, fetch top SUBPAGE_MAX
        const subpages = findSubpages(rootRes.html, row.website_url);
        const fetchedPages: { url: string; html: string }[] = [
          { url: row.website_url, html: rootRes.html },
        ];
        for (const sp of subpages) {
          await new Promise((res) => setTimeout(res, REQUEST_DELAY_MS));
          const spRes = await fetchWithTimeout(sp, FETCH_TIMEOUT_MS);
          if (spRes.ok && spRes.html) {
            fetchedPages.push({ url: sp, html: spRes.html });
            r.pages_fetched++;
          }
        }

        // LLM extract per page
        const hints: ExtractionHints = {
          venue_name: ctx?.title ?? undefined,
          town: ctx?.town ?? undefined,
          default_category: ctx?.category ?? undefined,
        };

        const allCandidates: EventCandidate[] = [];
        for (const page of fetchedPages) {
          // Per-page budget re-check (each LLM call can cost cents)
          const b2 = await hasAnthropicBudget(supabase);
          if (!b2.ok) break;

          const ext = await extractEvents(page.html, hints, { supabase });
          r.cost_cents += ext.usage.cost_cents;
          for (const ev of ext.events) {
            allCandidates.push(llmEventToCandidate(ev, page.url, ctx!));
          }
        }

        // Civic-content filter — drop municipal-meeting nomenclature
        // before it reaches event_ingest_raw. Parades, ceremonies, and
        // festivals at municipal venues PASS; "Zoning Board Meeting",
        // "Public Hearing", "Town Council Workshop" etc. are rejected.
        // The venue (parent explore_item title) is included in the venue
        // check, which catches generic "Regular Meeting" titles when the
        // host is a town/village hall.
        const filteredCandidates: typeof allCandidates = [];
        for (const c of allCandidates) {
          const civic = isCivicContent(c.title, ctx?.title ?? null);
          if (civic.isCivic) {
            r.candidates_civic_filtered++;
            console.log(
              `  civic-filtered "${c.title}" at ${ctx?.title || "unknown venue"} (${civic.reason})`,
            );
            continue;
          }
          filteredCandidates.push(c);
        }

        const validCandidates = filteredCandidates.filter((c) => c.is_valid);
        r.events_found = filteredCandidates.length;

        // Upsert into event_ingest_raw
        if (!dryRun && validCandidates.length > 0) {
          const inserts = validCandidates.map((c) => ({
            source_id: sourceId,
            external_id: `${row.explore_item_id}::${c.source_url}::${c.title}`.substring(0, 200),
            fetched_at: new Date().toISOString(),
            raw_json: c,
            status: "new",
          }));
          // Chunk into batches of 50 to stay under PostgREST request-size limits
          const CHUNK = 50;
          for (let i = 0; i < inserts.length; i += CHUNK) {
            const chunk = inserts.slice(i, i + CHUNK);
            const { error: insErr } = await supabase
              .from("event_ingest_raw")
              .upsert(chunk, { onConflict: "source_id,external_id" });
            if (insErr) {
              console.warn(`event_ingest_raw upsert chunk failed: ${insErr.message}`);
            } else {
              r.candidates_queued += chunk.length;
            }
          }
        } else if (dryRun) {
          r.candidates_queued = validCandidates.length;
        }

        // Update venue_crawl_state
        if (!dryRun) {
          const newConsecutiveEmpty =
            r.events_found === 0 ? row.consecutive_empty_runs + 1 : 0;
          const newConsecutiveErrors = 0;
          const newCostTotal = row.llm_cost_cents_total + r.cost_cents;
          const newStatus = computeStatus(
            newConsecutiveEmpty,
            newConsecutiveErrors,
            newCostTotal,
          );
          const next =
            newStatus === "disabled"
              ? new Date(Date.now() + 365 * 86400_000) // far future
              : nextEligibleAfterEmpty(newConsecutiveEmpty);
          const updatePayload: Record<string, any> = {
            last_crawled_at: new Date().toISOString(),
            last_run_events_found: r.events_found,
            events_found_count: row.events_found_count + r.events_found,
            consecutive_empty_runs: newConsecutiveEmpty,
            consecutive_errors: 0,
            last_error: null,
            llm_cost_cents_total: newCostTotal,
            next_eligible_at: next.toISOString(),
            status: newStatus,
          };
          // Only set last_event_yield_at if this run found events; preserve
          // prior value otherwise (don't clobber to null).
          if (r.events_found > 0) {
            updatePayload.last_event_yield_at = new Date().toISOString();
          }
          const { error: upErr } = await supabase
            .from("venue_crawl_state")
            .update(updatePayload)
            .eq("id", row.id);
          if (upErr) {
            console.error(
              `venue_crawl_state update failed for ${row.id}: ${upErr.message}`,
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        r.status = "fetch_error";
        r.error = msg;
        if (!dryRun) {
          const newErrors = row.consecutive_errors + 1;
          const newStatus = computeStatus(
            row.consecutive_empty_runs,
            newErrors,
            row.llm_cost_cents_total,
          );
          await supabase
            .from("venue_crawl_state")
            .update({
              consecutive_errors: newErrors,
              last_error: msg,
              last_crawled_at: new Date().toISOString(),
              next_eligible_at: nextEligibleAfterError(newErrors).toISOString(),
              status: newStatus,
            })
            .eq("id", row.id);
        }
      }

      r.duration_ms = Date.now() - venueStart;
      results.push(r);
      aggregateCostCents += r.cost_cents;
      aggregateEventsFound += r.events_found;
      aggregateCandidatesQueued += r.candidates_queued;
      aggregateCandidatesCivicFiltered += r.candidates_civic_filtered;
    }

    const durationMs = Date.now() - startTime;
    const summary = {
      claimed: claimed.length,
      processed: results.length,
      pages_fetched: results.reduce((s, r) => s + r.pages_fetched, 0),
      events_found: aggregateEventsFound,
      candidates_queued: aggregateCandidatesQueued,
      candidates_civic_filtered: aggregateCandidatesCivicFiltered,
      cost_cents: aggregateCostCents,
      errors: results.filter((r) => r.status !== "ok").length,
      dry_run: dryRun,
    };

    await logPipelineHealth(supabase, {
      stage: "ingest",
      source_name: AUTO_SOURCE_NAME,
      status: summary.errors > 0 ? "warn" : "ok",
      items_processed: summary.candidates_queued,
      items_failed: summary.errors,
      duration_ms: durationMs,
      details_json: { ...summary, max_per_run: maxPerRun },
    });

    console.log(
      `ingest-venue-website: ${summary.processed} venues, ` +
        `${summary.pages_fetched} pages, ${summary.events_found} events, ` +
        `${summary.candidates_queued} queued, $${(summary.cost_cents / 100).toFixed(2)}, ` +
        `${summary.errors} errors (${durationMs}ms)`,
    );

    return new Response(
      JSON.stringify({ success: true, summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("ingest-venue-website error:", msg);
    await captureEdgeException(error, { function: "ingest-venue-website" });

    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await logPipelineHealth(supabase, {
        stage: "ingest",
        source_name: AUTO_SOURCE_NAME,
        status: "error",
        items_processed: 0,
        items_failed: 1,
        duration_ms: durationMs,
        details_json: { error: msg },
      });
    } catch {
      // ignore
    }

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

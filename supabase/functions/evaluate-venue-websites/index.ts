/**
 * Evaluate Venue Websites — Phase 1 Auto-Discovery Pipeline
 *
 * Consumes pending rows from venue_website_candidates, fetches up to 3 pages
 * per venue concurrently, detects structured event signals (JSON-LD, ICS, RSS)
 * and keyword signals, then creates collector_targets for venues with event content.
 *
 * Score thresholds (base score + page evidence):
 *   ≥70 + structural signal (jsonld/ics/rss) → enabled collector_target
 *   ≥50                                       → disabled collector_target (admin review)
 *   <50                                        → marked no_events
 *
 * Rules (same as WebCollector):
 *   - Robots.txt is always checked; blocked domains are skipped
 *   - EudaBot user agent with contact email
 *   - Venues are evaluated concurrently (different domains — no cross-domain delay needed)
 *   - Max 3 pages per venue, 10 venues per run, concurrency=5
 *
 * Schedule: Sunday 02:00 UTC via pg_cron (migration 121)
 * Manual invoke: POST /functions/v1/evaluate-venue-websites
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logPipelineHealth } from "../_shared/health-log.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

// ============================================================================
// Constants
// ============================================================================

const USER_AGENT = "EudaBot/1.0 (+https://euda.app/bot; bot@euda.app)";
const REQUEST_TIMEOUT_MS = 5_000;   // Per-page fetch timeout
const ROBOTS_TIMEOUT_MS  = 3_000;   // robots.txt fetch timeout
const MAX_PAGES_PER_VENUE = 3;      // homepage + 2 discovery paths
const DEFAULT_BATCH_SIZE = 10;
const CONCURRENCY = 5;              // Venues evaluated in parallel (different domains)

// Discovery paths tried for each venue (in order)
const DISCOVERY_PATHS = ["/", "/events", "/calendar"];

// Keywords that signal event/recurring content
const EVENT_KEYWORDS = [
  "trivia", "karaoke", "live music", "open mic", "comedy", "drag show",
  "bingo", "wing night", "burger night", "taco night", "happy hour",
  "every tuesday", "every wednesday", "every thursday", "every friday", "every saturday",
  "live entertainment", "weekly specials", "event calendar", "upcoming events",
  "schedule of events", "recurring", "live band", "dj night", "game night",
  "open jam", "acoustic", "entertainment schedule",
];

// ============================================================================
// Types
// ============================================================================

interface EvalConfig {
  batch_size?: number;
  min_score?: number;
  dry_run?: boolean;
}

interface PageSignals {
  url: string;
  has_jsonld_events: boolean;
  ics_links: string[];
  rss_links: string[];
  keywords_found: string[];
  fetch_error?: string;
}

interface VenueEvalResult {
  candidate_id: string;
  place_name: string;
  website_url: string;
  status: "has_events" | "no_events" | "error" | "blocked" | "skipped";
  final_score: number;
  detected_strategy: string | null;
  detected_event_urls: string[];
  keywords_found: string[];
  collector_target_id?: string;
  enabled?: boolean;
  error?: string;
}

// ============================================================================
// robots.txt helpers (minimal — production crawling uses WebCollector)
// ============================================================================

async function isRobotsAllowed(baseUrl: string): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", baseUrl).href;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ROBOTS_TIMEOUT_MS);
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 404) return true; // No robots.txt = allowed
    if (!res.ok) return false; // Conservative: block on error

    const text = await res.text();
    return !isDisallowedByRobots(text, "/", "EudaBot");
  } catch {
    return false; // Conservative: block on timeout/network error
  }
}

function isDisallowedByRobots(robotsTxt: string, path: string, agentName: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.trim());
  let active = false;
  for (const line of lines) {
    if (line.startsWith("#") || !line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const dir = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();
    if (dir === "user-agent") {
      active = val === "*" || val.toLowerCase() === agentName.toLowerCase();
    } else if (dir === "disallow" && active) {
      if (val === "/" || (val && path.startsWith(val))) return true;
    }
  }
  return false;
}

// ============================================================================
// Page fetching
// ============================================================================

async function fetchPage(url: string): Promise<{ html: string; ok: true } | { ok: false; error: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    return { ok: true, html };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "fetch failed" };
  }
}


// ============================================================================
// Signal detection
// ============================================================================

function detectJsonLdEvents(html: string): boolean {
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const types: string[] = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"] || ""];
        if (types.some((t) => t === "Event" || t.includes("Event"))) return true;
        if (item["@graph"]) {
          for (const g of item["@graph"]) {
            const gt: string[] = Array.isArray(g["@type"]) ? g["@type"] : [g["@type"] || ""];
            if (gt.some((t) => t === "Event" || t.includes("Event"))) return true;
          }
        }
      }
    } catch { /* ignore invalid JSON-LD */ }
  }
  return false;
}

function detectIcsLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];

  // <link rel="alternate" type="text/calendar" href="...">
  const linkRe = /<link[^>]*(?:type=["']text\/calendar["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*type=["']text\/calendar["'])[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1] || m[2];
    if (href) links.push(resolveUrl(href, baseUrl));
  }

  // <a href="...calendar.ics..."> or <a href="*.ics">
  const anchorRe = /<a[^>]*href=["']([^"']*\.ics[^"']*)["'][^>]*>/gi;
  while ((m = anchorRe.exec(html)) !== null) {
    links.push(resolveUrl(m[1], baseUrl));
  }

  return [...new Set(links)];
}

function detectRssLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const re = /<link[^>]*type=["']application\/(?:rss\+xml|atom\+xml)["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    links.push(resolveUrl(m[1], baseUrl));
  }
  return [...new Set(links)];
}

function detectKeywords(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
  return EVENT_KEYWORDS.filter((kw) => text.includes(kw));
}

function resolveUrl(href: string, base: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  try { return new URL(href, base).href; } catch { return href; }
}

// ============================================================================
// Score computation
// ============================================================================

function computeFinalScore(
  baseScore: number,
  signals: PageSignals[],
): { score: number; strategy: string | null; eventUrls: string[]; keywords: string[] } {
  let bonus = 0;
  let strategy: string | null = null;
  const eventUrls: string[] = [];
  const allKeywords = new Set<string>();

  for (const page of signals) {
    if (page.has_jsonld_events) {
      bonus = Math.max(bonus, 30);
      if (!strategy) strategy = "jsonld";
      eventUrls.push(page.url);
    }
    for (const link of page.ics_links) {
      bonus = Math.max(bonus, 25);
      if (!strategy || strategy === "html_dom") strategy = "ics";
      eventUrls.push(link);
    }
    for (const link of page.rss_links) {
      bonus = Math.max(bonus, 20);
      if (!strategy || strategy === "html_dom") strategy = "rss";
      eventUrls.push(link);
    }
    for (const kw of page.keywords_found) {
      allKeywords.add(kw);
      if (!strategy && page.keywords_found.length >= 2) strategy = "html_dom";
      if (!page.fetch_error && eventUrls.indexOf(page.url) < 0 && page.url !== "/") {
        eventUrls.push(page.url);
      }
    }
  }

  const keywordBonus = Math.min(allKeywords.size * 5, 20);
  const finalScore = Math.min(baseScore + bonus + keywordBonus, 100);

  return {
    score: finalScore,
    strategy,
    eventUrls: [...new Set(eventUrls)].slice(0, 5),
    keywords: [...allKeywords].slice(0, 10),
  };
}

// ============================================================================
// Evaluate a single venue candidate
// ============================================================================

async function evaluateCandidate(
  candidate: Record<string, any>,
  dry_run: boolean,
): Promise<{ signals: PageSignals[]; pages_tried: number }> {
  const baseUrl = (() => {
    try { return new URL(candidate.website_url).origin; }
    catch { return candidate.website_url; }
  })();

  const signals: PageSignals[] = [];
  let pagesTried = 0;

  for (const path of DISCOVERY_PATHS) {
    if (pagesTried >= MAX_PAGES_PER_VENUE) break;

    const url = path === "/" ? baseUrl : `${baseUrl}${path}`;

    if (dry_run) {
      signals.push({ url, has_jsonld_events: false, ics_links: [], rss_links: [], keywords_found: [] });
      pagesTried++;
      continue;
    }

    const result = await fetchPage(url);
    pagesTried++;

    if (!result.ok) {
      // Homepage failure is a hard stop; inner pages just get skipped
      if (path === "/") {
        signals.push({ url, has_jsonld_events: false, ics_links: [], rss_links: [], keywords_found: [], fetch_error: result.error });
        break;
      }
      // Non-404 errors on inner pages: still continue
      if (result.error.startsWith("HTTP 4") && result.error !== "HTTP 404") {
        signals.push({ url, has_jsonld_events: false, ics_links: [], rss_links: [], keywords_found: [], fetch_error: result.error });
      }
      continue;
    }

    const { html } = result;
    signals.push({
      url,
      has_jsonld_events: detectJsonLdEvents(html),
      ics_links: detectIcsLinks(html, baseUrl),
      rss_links: detectRssLinks(html, baseUrl),
      keywords_found: detectKeywords(html),
    });
  }

  return { signals, pages_tried: pagesTried };
}

// ============================================================================
// Create collector_target
// ============================================================================

async function createCollectorTarget(
  supabase: any,
  candidate: Record<string, any>,
  strategy: string | null,
  eventUrls: string[],
  isEnabled: boolean,
): Promise<string | null> {
  // Get web_collector source_id
  const { data: source } = await supabase
    .from("event_sources")
    .select("id")
    .eq("type", "web_collector")
    .limit(1)
    .single();

  if (!source) {
    console.error("No web_collector event_source found");
    return null;
  }

  const baseUrl = (() => {
    try { return new URL(candidate.website_url).origin; }
    catch { return candidate.website_url; }
  })();

  // Build discovery_urls: use detected event URLs if available, else defaults
  const discoveryPaths = eventUrls
    .filter((u) => {
      try {
        const parsed = new URL(u);
        // Only include same-origin paths (not external ICS/RSS)
        return parsed.origin === baseUrl;
      } catch { return false; }
    })
    .map((u) => new URL(u).pathname)
    .filter((p) => p !== "/")
    .slice(0, 4);

  if (discoveryPaths.length === 0) discoveryPaths.push("/events");

  // allowed_paths: first segment of each discovery path
  const allowedPaths = [...new Set(
    discoveryPaths.map((p) => {
      const parts = p.split("/").filter(Boolean);
      return parts.length > 0 ? `/${parts[0]}/` : "/";
    }),
  )];

  const parsingStrategy = strategy === "ics" ? "ics"
    : strategy === "jsonld" ? "jsonld"
    : strategy === "rss" ? "rss"
    : "hybrid";

  const { data: existing } = await supabase
    .from("collector_targets")
    .select("id")
    .eq("name", candidate.place_name)
    .single();

  if (existing) {
    // Target already exists (e.g. from a previous run or manual seed)
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from("collector_targets")
    .insert({
      name: candidate.place_name,
      base_url: baseUrl,
      discovery_urls: discoveryPaths,
      allowed_paths: allowedPaths,
      parsing_strategy: parsingStrategy,
      source_type: "venue",
      auto_discovered: true,
      discovery_source: "google_places",
      discovery_venue_item_id: candidate.explore_item_id,
      source_trust_tier: "silver",
      is_enabled: isEnabled,
      town: candidate.town || null,
      default_category: "entertainment",
      content_types: ["events"],
      site_config: JSON.stringify({ timezone: "America/New_York" }),
      source_id: source.id,
      crawl_frequency_minutes: isEnabled ? 720 : 1440, // 12h enabled, 24h disabled
    })
    .select("id")
    .single();

  if (error) {
    console.error(`Failed to create collector_target for ${candidate.place_name}: ${error.message}`);
    return null;
  }

  return inserted.id;
}

// ============================================================================
// Main handler
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

  let config: EvalConfig = {};
  if (req.method === "POST") {
    try { config = await req.json(); } catch { /* empty body OK */ }
  }

  const batchSize = config.batch_size ?? DEFAULT_BATCH_SIZE;
  const minScore = config.min_score ?? 0;
  const dryRun = config.dry_run ?? false;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  console.log(`evaluate-venue-websites: batch=${batchSize}, min_score=${minScore}, dry_run=${dryRun}`);

  const results: VenueEvalResult[] = [];
  let totalHttpRequests = 0;
  let targetsCreated = 0;
  let targetsEnabled = 0;

  try {
    // Claim next batch of pending candidates
    const { data: candidates, error: fetchErr } = await supabase
      .from("venue_website_candidates")
      .select("*")
      .eq("discovery_status", "pending")
      .gte("event_score", minScore)
      .order("event_score", { ascending: false })
      .limit(batchSize);

    if (fetchErr) throw fetchErr;
    if (!candidates || candidates.length === 0) {
      console.log("No pending candidates found");
      return new Response(JSON.stringify({ success: true, evaluated: 0, message: "No pending candidates" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing ${candidates.length} candidates (concurrency=${CONCURRENCY})`);

    // Process venues concurrently — each is a different domain so no cross-domain delay needed
    const processCandidateFn = async (candidate: Record<string, any>) => {
      console.log(`Evaluating: ${candidate.place_name} — ${candidate.website_url}`);

      // Mark as evaluating
      if (!dryRun) {
        await supabase
          .from("venue_website_candidates")
          .update({ discovery_status: "evaluating" })
          .eq("id", candidate.id);
      }

      // Check robots.txt
      const robotsOk = dryRun || await isRobotsAllowed(candidate.website_url);
      if (!robotsOk) {
        console.log(`  Blocked by robots.txt`);
        if (!dryRun) {
          await supabase
            .from("venue_website_candidates")
            .update({
              discovery_status: "blocked",
              blocked_reason: "robots.txt disallows EudaBot",
              evaluated_at: new Date().toISOString(),
            })
            .eq("id", candidate.id);
        }
        results.push({
          candidate_id: candidate.id,
          place_name: candidate.place_name,
          website_url: candidate.website_url,
          status: "blocked",
          final_score: candidate.event_score,
          detected_strategy: null,
          detected_event_urls: [],
          keywords_found: [],
          error: "robots.txt disallows EudaBot",
        });
        return;
      }

      // Evaluate pages
      let signals: PageSignals[];
      let pagesTried: number;
      try {
        ({ signals, pages_tried: pagesTried } = await evaluateCandidate(candidate, dryRun));
        totalHttpRequests += pagesTried;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "unknown error";
        console.error(`  Error evaluating ${candidate.place_name}: ${errMsg}`);
        if (!dryRun) {
          await supabase
            .from("venue_website_candidates")
            .update({
              discovery_status: "error",
              evaluation_result: { error: errMsg },
              evaluated_at: new Date().toISOString(),
            })
            .eq("id", candidate.id);
        }
        results.push({
          candidate_id: candidate.id,
          place_name: candidate.place_name,
          website_url: candidate.website_url,
          status: "error",
          final_score: candidate.event_score,
          detected_strategy: null,
          detected_event_urls: [],
          keywords_found: [],
          error: errMsg,
        });
        return;
      }

      // Compute final score and signals
      const { score: finalScore, strategy, eventUrls, keywords } = computeFinalScore(
        candidate.event_score,
        signals,
      );

      console.log(`  Score: ${candidate.event_score} → ${finalScore} | strategy: ${strategy} | keywords: ${keywords.join(", ") || "none"}`);

      const hasFetchError = signals[0]?.fetch_error != null && eventUrls.length === 0;

      if (hasFetchError) {
        // Homepage completely unreachable
        if (!dryRun) {
          await supabase
            .from("venue_website_candidates")
            .update({
              discovery_status: "error",
              evaluation_result: { fetch_error: signals[0]?.fetch_error, pages_tried: pagesTried },
              evaluated_at: new Date().toISOString(),
            })
            .eq("id", candidate.id);
        }
        results.push({
          candidate_id: candidate.id,
          place_name: candidate.place_name,
          website_url: candidate.website_url,
          status: "error",
          final_score: finalScore,
          detected_strategy: null,
          detected_event_urls: [],
          keywords_found: keywords,
          error: signals[0]?.fetch_error,
        });
        return;
      }

      // Decision
      let newStatus: "has_events" | "no_events";
      let collectorTargetId: string | null = null;
      let targetEnabled = false;

      if (finalScore >= 50 && (strategy !== null || keywords.length >= 2)) {
        newStatus = "has_events";
        targetEnabled = finalScore >= 70 && strategy !== null && strategy !== "html_dom";

        if (!dryRun) {
          collectorTargetId = await createCollectorTarget(
            supabase, candidate, strategy, eventUrls, targetEnabled,
          );
          targetsCreated++;
          if (targetEnabled) targetsEnabled++;
        } else {
          console.log(`  [DRY RUN] Would create ${targetEnabled ? "enabled" : "disabled"} collector_target`);
        }
      } else {
        newStatus = "no_events";
      }

      if (!dryRun) {
        const updatePayload: Record<string, any> = {
          discovery_status: collectorTargetId
            ? (targetEnabled ? "added_as_target" : "has_events")
            : newStatus,
          evaluation_result: {
            pages_checked: pagesTried,
            pages_with_signals: signals.filter((s) => s.has_jsonld_events || s.ics_links.length > 0 || s.rss_links.length > 0 || s.keywords_found.length >= 2).length,
          },
          detected_strategy: strategy,
          detected_event_urls: eventUrls,
          event_signal_keywords: keywords,
          evaluated_at: new Date().toISOString(),
        };
        if (collectorTargetId) {
          updatePayload.collector_target_id = collectorTargetId;
        }

        await supabase
          .from("venue_website_candidates")
          .update(updatePayload)
          .eq("id", candidate.id);
      }

      results.push({
        candidate_id: candidate.id,
        place_name: candidate.place_name,
        website_url: candidate.website_url,
        status: newStatus,
        final_score: finalScore,
        detected_strategy: strategy,
        detected_event_urls: eventUrls,
        keywords_found: keywords,
        collector_target_id: collectorTargetId || undefined,
        enabled: targetEnabled,
      });
    }; // end processCandidateFn

    // Run candidates concurrently in chunks of CONCURRENCY
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const chunk = candidates.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(processCandidateFn));
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "unknown error";
    console.error("Fatal error:", errMsg);

    await logPipelineHealth(supabase, {
      stage: "evaluate_venues",
      source_name: "evaluate-venue-websites",
      status: "error",
      items_processed: results.length,
      items_failed: 1,
      duration_ms: Date.now() - startTime,
      details_json: { error: errMsg },
    });

    return new Response(JSON.stringify({ success: false, error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const summary = {
    evaluated: results.length,
    has_events: results.filter((r) => r.status === "has_events" || r.detected_strategy).length,
    no_events: results.filter((r) => r.status === "no_events").length,
    blocked: results.filter((r) => r.status === "blocked").length,
    errors: results.filter((r) => r.status === "error").length,
    targets_created: targetsCreated,
    targets_enabled: targetsEnabled,
    total_http_requests: totalHttpRequests,
    duration_ms: Date.now() - startTime,
  };

  console.log(`\nDone: ${JSON.stringify(summary)}`);

  await logPipelineHealth(supabase, {
    stage: "evaluate_venues",
    source_name: "evaluate-venue-websites",
    status: summary.errors > summary.evaluated / 2 ? "warn" : "ok",
    items_processed: summary.evaluated,
    items_failed: summary.errors,
    duration_ms: summary.duration_ms,
    details_json: summary,
  });

  return new Response(
    JSON.stringify({ success: true, summary, results: dryRun ? results : undefined }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

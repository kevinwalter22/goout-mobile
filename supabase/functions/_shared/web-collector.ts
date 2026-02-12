/**
 * Web Collector Framework (Enhanced for Wave 4)
 *
 * Production-grade web collector with:
 * - Integration with collector_targets table
 * - Page caching with content hash change detection
 * - robots.txt enforcement with caching
 * - Circuit breaker (auto-disables on repeated errors)
 * - Rate limiting between requests
 * - Health logging for every collection cycle
 *
 * NON-NEGOTIABLE RULES:
 * - NO captcha bypass or stealth fingerprinting
 * - NO scraping social media or login-required pages (Facebook/Instagram/TikTok)
 * - Respect robots.txt — if disallowed, do not fetch
 * - Every collector MUST be disable-able via DB kill switch
 * - AI only operates on CACHED content, never live browsing
 *
 * Usage:
 *   import { WebCollector, CollectorTarget } from "../_shared/web-collector.ts";
 *
 *   const collector = new WebCollector(supabase);
 *   const targets = await collector.getEnabledTargets();
 *
 *   for (const target of targets) {
 *     const result = await collector.collectTarget(target);
 *   }
 */

import { logPipelineHealth } from "./health-log.ts";
import { createHash } from "https://deno.land/std@0.208.0/crypto/mod.ts";

// ============================================================================
// Types
// ============================================================================

export type ParsingStrategy = "jsonld" | "ics" | "rss" | "html_dom" | "hybrid";
export type CircuitBreakerState = "closed" | "open" | "half_open";

export interface CollectorTarget {
  target_id: string;
  name: string;
  base_url: string;
  discovery_urls: string[];
  allowed_paths: string[];
  parsing_strategy: ParsingStrategy;
  dom_selectors: Record<string, string>;
  user_agent: string;
  rate_limit_rpm: number;
  request_delay_ms: number;
  max_pages_per_run: number;
  minutes_since_last_run: number | null;
  crawl_frequency_minutes: number;
  source_id: string | null;
  // Hyperlocal metadata (Phase A)
  town: string | null;
  venue_name: string | null;
  default_category: string | null;
  content_types: string[];
  site_config: Record<string, any>;
}

export interface PageCacheEntry {
  id: string;
  target_id: string;
  url: string;
  url_hash: string;
  content_hash: string;
  content_type: string | null;
  raw_html: string | null;
  http_status: number | null;
  extracted_candidates: EventCandidate[] | null;
  extraction_strategy: ParsingStrategy | null;
  extraction_errors: string[] | null;
  fetched_at: string;
  last_changed_at: string;
}

export interface FetchResult {
  url: string;
  status: "fetched" | "cached_hit" | "blocked_by_robots" | "error" | "rate_limited";
  content_hash?: string;
  changed: boolean;
  html?: string;
  error?: string;
}

export interface EventCandidate {
  // Required fields
  title: string;
  source_url: string;

  // Temporal (at least one required)
  starts_at?: string;
  ends_at?: string;
  recurrence_text?: string;  // e.g., "Every Tuesday at 7pm"

  // Location
  location_name?: string;
  address?: string;
  lat?: number;
  lng?: number;

  // Content
  description_snippet?: string;
  image_url?: string;

  // Extraction metadata
  evidence: ExtractionEvidence[];
  extraction_strategy: ParsingStrategy;
  confidence: number;  // 0-100

  // Validation
  validation_errors: string[];
  is_valid: boolean;
}

export interface ExtractionEvidence {
  field: string;
  source: "jsonld" | "ics" | "rss" | "dom" | "meta";
  value: string;
  selector?: string;
  raw_snippet?: string;  // HTML/text snippet used
}

export interface CollectionResult {
  target: CollectorTarget;
  pages_fetched: number;
  pages_cached_hit: number;
  pages_blocked: number;
  pages_error: number;
  candidates_found: number;
  valid_candidates: number;
  duration_ms: number;
  circuit_tripped: boolean;
  errors: string[];
}

// ============================================================================
// Robots.txt Parser
// ============================================================================

interface RobotsResult {
  allowed: boolean;
  fetchedAt: number;
  raw?: string;
}

async function fetchRobotsTxt(
  baseUrl: string,
  userAgent: string,
  timeoutMs: number = 10000,
): Promise<RobotsResult> {
  const robotsUrl = new URL("/robots.txt", baseUrl).href;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": userAgent },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      // No robots.txt = assume allowed (standard behavior)
      if (response.status === 404) {
        return { allowed: true, fetchedAt: Date.now() };
      }
      // Other errors = be conservative, block
      return {
        allowed: false,
        fetchedAt: Date.now(),
        raw: `HTTP ${response.status}`,
      };
    }

    const text = await response.text();
    return { allowed: true, fetchedAt: Date.now(), raw: text.substring(0, 5000) };
  } catch (err) {
    console.warn(`robots.txt fetch failed for ${baseUrl}: ${err}`);
    return {
      allowed: false,
      fetchedAt: Date.now(),
      raw: `Error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

function isPathAllowedByRobots(
  robotsTxt: string,
  path: string,
  userAgent: string,
): boolean {
  const lines = robotsTxt.split("\n").map((l) => l.trim());

  let currentAgentMatches = false;
  let hasSpecificRule = false;
  let defaultAllowed = true;
  let specificAllowed = true;

  const agentName = userAgent.split("/")[0].toLowerCase();

  for (const line of lines) {
    if (line.startsWith("#") || line === "") continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const directive = line.substring(0, colonIndex).trim().toLowerCase();
    const value = line.substring(colonIndex + 1).trim();

    if (directive === "user-agent") {
      const agent = value.toLowerCase();
      currentAgentMatches = agent === "*" || agent === agentName;
    } else if (directive === "disallow" && currentAgentMatches) {
      if (value === "/") {
        defaultAllowed = false;
      } else if (value && path.startsWith(value)) {
        hasSpecificRule = true;
        specificAllowed = false;
      }
    } else if (directive === "allow" && currentAgentMatches) {
      if (value && path.startsWith(value)) {
        hasSpecificRule = true;
        specificAllowed = true;
      }
    }
  }

  return hasSpecificRule ? specificAllowed : defaultAllowed;
}

// ============================================================================
// Hash Utilities
// ============================================================================

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================================
// Web Collector Class
// ============================================================================

export class WebCollector {
  private supabase: any;
  private robotsCache: Map<string, RobotsResult> = new Map();
  private consecutiveErrors: number = 0;
  private startTime: number = Date.now();

  constructor(supabase: any) {
    this.supabase = supabase;
  }

  /**
   * Get all enabled collector targets that are ready to run
   */
  async getEnabledTargets(): Promise<CollectorTarget[]> {
    const { data, error } = await this.supabase.rpc("get_enabled_collector_targets");

    if (error) {
      console.error("Failed to get enabled targets:", error);
      return [];
    }

    return data || [];
  }

  /**
   * Collect all pages for a single target
   */
  async collectTarget(target: CollectorTarget): Promise<CollectionResult> {
    const result: CollectionResult = {
      target,
      pages_fetched: 0,
      pages_cached_hit: 0,
      pages_blocked: 0,
      pages_error: 0,
      candidates_found: 0,
      valid_candidates: 0,
      duration_ms: 0,
      circuit_tripped: false,
      errors: [],
    };

    const startTime = Date.now();
    this.consecutiveErrors = 0;

    try {
      // 1. Check/refresh robots.txt
      const robotsOk = await this.checkRobotsTxt(target);
      if (!robotsOk) {
        result.pages_blocked = target.discovery_urls.length;
        result.errors.push("robots.txt disallows crawling");
        await this.completeRun(target, result);
        return result;
      }

      // 2. Fetch each discovery URL
      let pagesFetched = 0;
      for (const discoveryPath of target.discovery_urls) {
        if (pagesFetched >= target.max_pages_per_run) {
          console.log(`Reached max pages per run (${target.max_pages_per_run})`);
          break;
        }

        // Check if path is allowed
        if (!this.isPathAllowed(target, discoveryPath)) {
          result.pages_blocked++;
          result.errors.push(`Path not in allowed_paths: ${discoveryPath}`);
          continue;
        }

        const fullUrl = new URL(discoveryPath, target.base_url).href;

        // Rate limit delay
        if (pagesFetched > 0) {
          await this.delay(target.request_delay_ms);
        }

        // Fetch with cache check
        const fetchResult = await this.fetchPageWithCache(target, fullUrl);

        if (fetchResult.status === "fetched") {
          result.pages_fetched++;
          pagesFetched++;
        } else if (fetchResult.status === "cached_hit") {
          result.pages_cached_hit++;
        } else if (fetchResult.status === "blocked_by_robots") {
          result.pages_blocked++;
        } else if (fetchResult.status === "error") {
          result.pages_error++;
          result.errors.push(fetchResult.error || `Failed to fetch ${fullUrl}`);
        }

        // Check circuit breaker
        if (this.consecutiveErrors >= target.max_pages_per_run) {
          result.circuit_tripped = true;
          await this.tripCircuitBreaker(target, "Too many consecutive errors");
          break;
        }
      }

      // 3. Get candidates from cache
      const { data: cachedPages } = await this.supabase
        .from("collector_page_cache")
        .select("extracted_candidates")
        .eq("target_id", target.target_id)
        .not("extracted_candidates", "is", null);

      if (cachedPages) {
        for (const page of cachedPages) {
          const candidates = page.extracted_candidates as EventCandidate[] || [];
          result.candidates_found += candidates.length;
          result.valid_candidates += candidates.filter((c) => c.is_valid).length;
        }
      }

    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : "Unknown error");
    }

    result.duration_ms = Date.now() - startTime;
    await this.completeRun(target, result);

    return result;
  }

  /**
   * Check robots.txt for a target (with caching)
   */
  private async checkRobotsTxt(target: CollectorTarget): Promise<boolean> {
    // Check in-memory cache first
    let robotsResult = this.robotsCache.get(target.base_url);

    // Check DB cache (24 hour TTL)
    if (!robotsResult) {
      const { data: targetData } = await this.supabase
        .from("collector_targets")
        .select("robots_txt_cache, robots_txt_fetched_at, robots_txt_allows_crawl")
        .eq("id", target.target_id)
        .single();

      if (targetData?.robots_txt_fetched_at) {
        const fetchedAt = new Date(targetData.robots_txt_fetched_at).getTime();
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

        if (fetchedAt > dayAgo) {
          robotsResult = {
            allowed: targetData.robots_txt_allows_crawl,
            fetchedAt,
            raw: targetData.robots_txt_cache,
          };
          this.robotsCache.set(target.base_url, robotsResult);
        }
      }
    }

    // Fetch fresh if not cached or expired
    if (!robotsResult) {
      robotsResult = await fetchRobotsTxt(target.base_url, target.user_agent);
      this.robotsCache.set(target.base_url, robotsResult);

      // Store in DB
      await this.supabase.rpc("update_robots_cache", {
        p_target_id: target.target_id,
        p_robots_txt: robotsResult.raw || "",
        p_allows_crawl: robotsResult.allowed,
      });
    }

    return robotsResult.allowed;
  }

  /**
   * Check if a path is in the target's allowed_paths
   */
  private isPathAllowed(target: CollectorTarget, path: string): boolean {
    // Empty allowed_paths = allow all (for targets that explicitly want this)
    if (target.allowed_paths.length === 0) {
      return true;
    }

    return target.allowed_paths.some((allowedPath) =>
      path.startsWith(allowedPath)
    );
  }

  /**
   * Fetch a page with content hash change detection
   */
  async fetchPageWithCache(
    target: CollectorTarget,
    url: string,
  ): Promise<FetchResult> {
    const urlHash = await sha256(url);

    // Check robots.txt for this specific path
    const robotsResult = this.robotsCache.get(target.base_url);
    if (robotsResult?.raw) {
      const urlObj = new URL(url);
      if (!isPathAllowedByRobots(robotsResult.raw, urlObj.pathname, target.user_agent)) {
        return {
          url,
          status: "blocked_by_robots",
          changed: false,
        };
      }
    }

    // Check existing cache
    const { data: existingCache } = await this.supabase
      .from("collector_page_cache")
      .select("*")
      .eq("target_id", target.target_id)
      .eq("url_hash", urlHash)
      .single();

    // Build conditional request headers (ETag / If-Modified-Since)
    const requestHeaders: Record<string, string> = {
      "User-Agent": target.user_agent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (existingCache?.etag) {
      requestHeaders["If-None-Match"] = existingCache.etag;
    }
    if (existingCache?.last_modified) {
      requestHeaders["If-Modified-Since"] = existingCache.last_modified;
    }

    // Fetch the page
    let html: string;
    let httpStatus: number;
    let contentType: string | null = null;
    let responseEtag: string | null = null;
    let responseLastModified: string | null = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        headers: requestHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      httpStatus = response.status;
      contentType = response.headers.get("Content-Type");
      responseEtag = response.headers.get("ETag");
      responseLastModified = response.headers.get("Last-Modified");

      // Handle 304 Not Modified — server confirmed content unchanged
      if (httpStatus === 304 && existingCache) {
        const unchanged = (existingCache.consecutive_unchanged || 0) + 1;
        await this.supabase
          .from("collector_page_cache")
          .update({
            last_checked_at: new Date().toISOString(),
            consecutive_unchanged: unchanged,
          })
          .eq("id", existingCache.id);
        this.consecutiveErrors = 0;
        return {
          url,
          status: "cached_hit",
          content_hash: existingCache.content_hash,
          changed: false,
        };
      }

      // Check for fatal errors
      if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
        this.consecutiveErrors++;
        return {
          url,
          status: "error",
          changed: false,
          error: `HTTP ${httpStatus}`,
        };
      }

      if (!response.ok) {
        this.consecutiveErrors++;
        return {
          url,
          status: "error",
          changed: false,
          error: `HTTP ${httpStatus}`,
        };
      }

      html = await response.text();
      this.consecutiveErrors = 0; // Reset on success

    } catch (err) {
      this.consecutiveErrors++;
      return {
        url,
        status: "error",
        changed: false,
        error: err instanceof Error ? err.message : "Fetch failed",
      };
    }

    // Compute content hash
    const contentHash = await sha256(html);

    // Check if content changed
    const changed = !existingCache || existingCache.content_hash !== contentHash;

    if (!changed && existingCache) {
      // Content hash identical — update last_checked_at + consecutive_unchanged
      const unchanged = (existingCache.consecutive_unchanged || 0) + 1;
      await this.supabase
        .from("collector_page_cache")
        .update({
          last_checked_at: new Date().toISOString(),
          consecutive_unchanged: unchanged,
          // Save ETag/Last-Modified for future conditional requests
          ...(responseEtag ? { etag: responseEtag } : {}),
          ...(responseLastModified ? { last_modified: responseLastModified } : {}),
        })
        .eq("id", existingCache.id);

      return {
        url,
        status: "cached_hit",
        content_hash: contentHash,
        changed: false,
      };
    }

    // Store/update cache — content is new or changed
    const cacheEntry = {
      target_id: target.target_id,
      url,
      url_hash: urlHash,
      content_hash: contentHash,
      content_type: contentType,
      raw_html: html,
      http_status: httpStatus,
      fetched_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      last_changed_at: new Date().toISOString(),
      consecutive_unchanged: 0, // Reset on content change
      // Save ETag/Last-Modified for conditional requests
      etag: responseEtag || null,
      last_modified: responseLastModified || null,
      // Clear old extraction results since content changed
      extracted_candidates: null,
      extraction_strategy: null,
      extraction_errors: null,
    };

    if (existingCache) {
      await this.supabase
        .from("collector_page_cache")
        .update(cacheEntry)
        .eq("id", existingCache.id);
    } else {
      await this.supabase
        .from("collector_page_cache")
        .insert(cacheEntry);
    }

    return {
      url,
      status: "fetched",
      content_hash: contentHash,
      changed: true,
      html,
    };
  }

  /**
   * Get cached HTML for a URL (for extraction)
   */
  async getCachedPage(targetId: string, url: string): Promise<PageCacheEntry | null> {
    const urlHash = await sha256(url);

    const { data } = await this.supabase
      .from("collector_page_cache")
      .select("*")
      .eq("target_id", targetId)
      .eq("url_hash", urlHash)
      .single();

    return data;
  }

  /**
   * Update extraction results in cache
   */
  async updateExtractionResults(
    cacheId: string,
    candidates: EventCandidate[],
    strategy: ParsingStrategy,
    errors: string[] = [],
  ): Promise<void> {
    await this.supabase
      .from("collector_page_cache")
      .update({
        extracted_candidates: candidates,
        extraction_strategy: strategy,
        extraction_errors: errors,
      })
      .eq("id", cacheId);
  }

  /**
   * Trip the circuit breaker for a target
   */
  private async tripCircuitBreaker(target: CollectorTarget, reason: string): Promise<void> {
    await this.supabase.rpc("trip_circuit_breaker", {
      p_target_id: target.target_id,
      p_reason: reason,
    });
    console.error(`Circuit breaker TRIPPED for ${target.name}: ${reason}`);
  }

  /**
   * Complete a collection run
   */
  private async completeRun(target: CollectorTarget, result: CollectionResult): Promise<void> {
    await this.supabase.rpc("complete_collector_run", {
      p_target_id: target.target_id,
      p_pages_fetched: result.pages_fetched,
      p_items_found: result.candidates_found,
      p_errors: result.pages_error,
      p_circuit_trip: result.circuit_tripped,
    });

    // Log health
    await logPipelineHealth(this.supabase, {
      stage: "web_collect",
      source_name: target.name,
      status: result.circuit_tripped ? "error" : result.pages_error > 0 ? "warn" : "ok",
      items_processed: result.pages_fetched + result.pages_cached_hit,
      items_failed: result.pages_error + result.pages_blocked,
      duration_ms: result.duration_ms,
      details_json: {
        pages_fetched: result.pages_fetched,
        pages_cached_hit: result.pages_cached_hit,
        pages_blocked: result.pages_blocked,
        pages_error: result.pages_error,
        candidates_found: result.candidates_found,
        valid_candidates: result.valid_candidates,
        circuit_tripped: result.circuit_tripped,
        errors: result.errors.slice(0, 10), // Limit to first 10 errors
      },
    });
  }

  /**
   * Utility: delay for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Return a standard "disabled" response
   */
  disabledResponse(reason?: string): Response {
    return new Response(
      JSON.stringify({
        success: true,
        status: "disabled",
        reason: reason || "No enabled targets or blocked by robots.txt",
        summary: {
          targets_processed: 0,
          pages_fetched: 0,
          pages_cached_hit: 0,
          candidates_found: 0,
          errors: 0,
        },
      }),
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      },
    );
  }
}

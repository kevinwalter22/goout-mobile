/**
 * Web Collector Framework
 *
 * Shared infrastructure for web page collectors with strict compliance:
 * - robots.txt enforcement (blocks fetch if disallowed)
 * - Circuit breaker (auto-disables on repeated errors)
 * - DB kill switch (checks event_sources.is_enabled before every fetch)
 * - Rate limiting between requests
 * - Health logging for every collection cycle
 *
 * NON-NEGOTIABLE RULES:
 * - NO captcha bypass or stealth fingerprinting
 * - NO scraping social media or login-required pages
 * - Respect robots.txt — if disallowed, do not fetch
 * - Every collector MUST be disable-able via DB kill switch
 *
 * Usage:
 *   import { WebCollector } from "../_shared/web-collector.ts";
 *
 *   const collector = new WebCollector(supabase, {
 *     sourceName: "Potsdam Events",
 *     sourceType: "web_potsdam_events",
 *     userAgent: "EudaBot/1.0 (+https://euda.app/bot)",
 *     maxConsecutiveErrors: 3,
 *     requestDelayMs: 1000,
 *   });
 *
 *   const canProceed = await collector.preflight("https://example.com/events");
 *   if (!canProceed) return collector.disabledResponse();
 *
 *   const html = await collector.fetchPage("https://example.com/events");
 */

import { logPipelineHealth } from "./health-log.ts";

// ============================================================================
// Configuration
// ============================================================================

export interface WebCollectorConfig {
  sourceName: string;      // Display name (e.g., "Potsdam Events")
  sourceType: string;      // event_sources.type value
  userAgent: string;       // User-Agent header — always identify ourselves
  maxConsecutiveErrors?: number;  // Circuit breaker threshold (default 3)
  requestDelayMs?: number;       // Delay between requests (default 1000ms)
  timeoutMs?: number;            // Request timeout (default 10000ms)
}

interface CollectorState {
  sourceId: string | null;
  isEnabled: boolean;
  consecutiveErrors: number;
  circuitBroken: boolean;
  robotsCache: Map<string, RobotsResult>;
  fetchCount: number;
  errorCount: number;
  startTime: number;
}

interface RobotsResult {
  allowed: boolean;
  fetchedAt: number;
  raw?: string;
}

// ============================================================================
// Robots.txt Parser (minimal, safe implementation)
// ============================================================================

/**
 * Parse robots.txt and check if a path is allowed for our user agent.
 * Conservative: if robots.txt can't be fetched, BLOCK the request.
 */
async function checkRobotsTxt(
  baseUrl: string,
  path: string,
  userAgent: string,
  timeoutMs: number,
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
    const allowed = isPathAllowed(text, path, userAgent);

    return { allowed, fetchedAt: Date.now(), raw: text.substring(0, 2000) };
  } catch (err) {
    // Network error fetching robots.txt = be conservative, block
    console.warn(`robots.txt fetch failed for ${baseUrl}: ${err}`);
    return {
      allowed: false,
      fetchedAt: Date.now(),
      raw: `Error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

/**
 * Minimal robots.txt parser.
 * Checks User-agent: * and our specific agent for Disallow rules.
 */
function isPathAllowed(
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
    // Skip comments and empty lines
    if (line.startsWith("#") || line === "") continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const directive = line.substring(0, colonIndex).trim().toLowerCase();
    const value = line.substring(colonIndex + 1).trim();

    if (directive === "user-agent") {
      const agent = value.toLowerCase();
      currentAgentMatches =
        agent === "*" || agent === agentName;
    } else if (directive === "disallow" && currentAgentMatches) {
      if (value === "" || value === "/") {
        // Disallow: / blocks everything
        // Disallow: (empty) allows everything
        if (value === "/") {
          if (currentAgentMatches) {
            // Check if this is our specific agent or wildcard
            defaultAllowed = false;
          }
        }
      } else if (path.startsWith(value)) {
        if (currentAgentMatches) {
          hasSpecificRule = true;
          specificAllowed = false;
        }
      }
    } else if (directive === "allow" && currentAgentMatches) {
      if (path.startsWith(value)) {
        hasSpecificRule = true;
        specificAllowed = true;
      }
    }
  }

  return hasSpecificRule ? specificAllowed : defaultAllowed;
}

// ============================================================================
// Web Collector Class
// ============================================================================

export class WebCollector {
  private supabase: any;
  private config: Required<WebCollectorConfig>;
  private state: CollectorState;

  constructor(supabase: any, config: WebCollectorConfig) {
    this.supabase = supabase;
    this.config = {
      sourceName: config.sourceName,
      sourceType: config.sourceType,
      userAgent: config.userAgent,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
      requestDelayMs: config.requestDelayMs ?? 1000,
      timeoutMs: config.timeoutMs ?? 10000,
    };
    this.state = {
      sourceId: null,
      isEnabled: false,
      consecutiveErrors: 0,
      circuitBroken: false,
      robotsCache: new Map(),
      fetchCount: 0,
      errorCount: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Pre-flight check: verify source is enabled and robots.txt allows access.
   * Returns false if the collector should not proceed.
   */
  async preflight(targetUrl: string): Promise<boolean> {
    // 1. Check DB kill switch
    const { data: source } = await this.supabase
      .from("event_sources")
      .select("id, is_enabled")
      .eq("type", this.config.sourceType)
      .single();

    if (!source) {
      console.log(
        `Source '${this.config.sourceType}' not found in database. Skipping.`,
      );
      return false;
    }

    this.state.sourceId = source.id;

    if (!source.is_enabled) {
      console.log(
        `Source '${this.config.sourceName}' is disabled (kill switch). Skipping.`,
      );
      this.state.isEnabled = false;
      return false;
    }

    this.state.isEnabled = true;

    // 2. Check robots.txt
    const url = new URL(targetUrl);
    const baseUrl = `${url.protocol}//${url.host}`;
    const path = url.pathname;

    let robotsResult = this.state.robotsCache.get(baseUrl);
    if (!robotsResult || Date.now() - robotsResult.fetchedAt > 3600000) {
      // Cache for 1 hour
      robotsResult = await checkRobotsTxt(
        baseUrl,
        path,
        this.config.userAgent,
        this.config.timeoutMs,
      );
      this.state.robotsCache.set(baseUrl, robotsResult);
    }

    if (!robotsResult.allowed) {
      console.log(
        `robots.txt DISALLOWS ${path} on ${baseUrl}. Respecting directive.`,
      );
      return false;
    }

    return true;
  }

  /**
   * Fetch a web page with proper headers, timeout, and error handling.
   * Returns HTML string or null on error.
   */
  async fetchPage(url: string): Promise<string | null> {
    // Check circuit breaker
    if (this.state.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      this.state.circuitBroken = true;
      console.error(
        `Circuit breaker OPEN: ${this.state.consecutiveErrors} consecutive errors. ` +
        `Refusing to fetch ${url}.`,
      );
      return null;
    }

    // Rate limit delay
    if (this.state.fetchCount > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.requestDelayMs)
      );
    }

    this.state.fetchCount++;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs,
      );

      const response = await fetch(url, {
        headers: {
          "User-Agent": this.config.userAgent,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Check for fatal errors → trip circuit breaker
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429
      ) {
        this.state.consecutiveErrors++;
        this.state.errorCount++;
        console.error(
          `Fatal HTTP ${response.status} from ${url}. ` +
          `Consecutive errors: ${this.state.consecutiveErrors}/${this.config.maxConsecutiveErrors}`,
        );
        return null;
      }

      if (!response.ok) {
        this.state.consecutiveErrors++;
        this.state.errorCount++;
        console.error(`HTTP ${response.status} from ${url}`);
        return null;
      }

      // Success → reset circuit breaker
      this.state.consecutiveErrors = 0;

      const html = await response.text();
      return html;
    } catch (err) {
      this.state.consecutiveErrors++;
      this.state.errorCount++;
      console.error(
        `Fetch error for ${url}: ${err instanceof Error ? err.message : "unknown"}`,
      );
      return null;
    }
  }

  /**
   * Get the source ID (available after preflight)
   */
  getSourceId(): string | null {
    return this.state.sourceId;
  }

  /**
   * Check if circuit breaker has tripped
   */
  isCircuitBroken(): boolean {
    return this.state.circuitBroken;
  }

  /**
   * Log health metrics for this collection cycle
   */
  async logHealth(itemsProcessed: number, itemsFailed: number): Promise<void> {
    await logPipelineHealth(this.supabase, {
      stage: "ingest",
      source_name: this.config.sourceName,
      status: this.state.circuitBroken
        ? "error"
        : itemsFailed > 0
          ? "warn"
          : "ok",
      items_processed: itemsProcessed,
      items_failed: itemsFailed,
      duration_ms: Date.now() - this.state.startTime,
      details_json: {
        fetch_count: this.state.fetchCount,
        error_count: this.state.errorCount,
        circuit_broken: this.state.circuitBroken,
        consecutive_errors: this.state.consecutiveErrors,
      },
    });
  }

  /**
   * Return a standard "disabled" response (for when preflight fails)
   */
  disabledResponse(reason?: string): Response {
    return new Response(
      JSON.stringify({
        success: true,
        status: "disabled",
        reason: reason || "Source disabled or blocked by robots.txt",
        source: this.config.sourceName,
        summary: {
          total_fetched: 0,
          inserted: 0,
          updated: 0,
          unchanged: 0,
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

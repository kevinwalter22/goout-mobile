/**
 * Verify Collector Targets
 *
 * Dry-run script that fetches each configured target's discovery URLs
 * and reports what structured event data is available. Does NOT write
 * to the database.
 *
 * Usage:
 *   npx tsx scripts/verifyCollectorTargets.ts              # enabled targets only
 *   npx tsx scripts/verifyCollectorTargets.ts --all         # all targets
 *   npx tsx scripts/verifyCollectorTargets.ts --name "SLC Arts"  # specific target
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load env
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const USER_AGENT = "EudaBot/1.0 (+https://euda.app/bot; bot@euda.app)";

interface TargetRow {
  id: string;
  name: string;
  base_url: string;
  discovery_urls: string[] | null;
  allowed_paths: string[] | null;
  parsing_strategy: string;
  source_type: string | null;
  town: string | null;
  venue_name: string | null;
  default_category: string | null;
  is_enabled: boolean;
  circuit_breaker: string;
  last_run_at: string | null;
  total_items_collected: number;
}

interface DiscoveryResult {
  url: string;
  status: number | null;
  contentLength: number;
  contentType: string | null;
  hasJsonLd: boolean;
  jsonLdEventCount: number;
  hasIcs: boolean;
  icsEventCount: number;
  hasRss: boolean;
  rssItemCount: number;
  hasMicrodata: boolean;
  domEventElements: number;
  sampleEvents: string[];
  error: string | null;
}

async function fetchAndAnalyze(url: string): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    url,
    status: null,
    contentLength: 0,
    contentType: null,
    hasJsonLd: false,
    jsonLdEventCount: 0,
    hasIcs: false,
    icsEventCount: 0,
    hasRss: false,
    rssItemCount: 0,
    hasMicrodata: false,
    domEventElements: 0,
    sampleEvents: [],
    error: null,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,text/calendar;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);
    result.status = response.status;
    result.contentType = response.headers.get("Content-Type");

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const html = await response.text();
    result.contentLength = html.length;

    // --- JSON-LD detection ---
    result.hasJsonLd = html.includes("application/ld+json");
    if (result.hasJsonLd) {
      const jsonLdBlocks =
        html.match(
          /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
        ) || [];

      for (const block of jsonLdBlocks) {
        const content = block.match(
          /<script[^>]*>([\s\S]*?)<\/script>/i
        )?.[1];
        if (!content) continue;

        try {
          const data = JSON.parse(content.trim());
          const items = Array.isArray(data) ? data : [data];

          for (const item of items) {
            // Handle @graph
            const checkItems = item["@graph"]
              ? [...items, ...item["@graph"]]
              : [item];

            for (const check of checkItems) {
              const type = check["@type"];
              if (!type) continue;
              const types = Array.isArray(type) ? type : [type];
              if (types.some((t: string) => t === "Event" || t.includes("Event"))) {
                result.jsonLdEventCount++;
                if (result.sampleEvents.length < 5 && check.name) {
                  const dateStr = check.startDate
                    ? ` @ ${check.startDate}`
                    : "";
                  result.sampleEvents.push(`${check.name}${dateStr}`);
                }
              }
            }
          }
        } catch {
          // Invalid JSON-LD
        }
      }
    }

    // --- ICS detection ---
    result.hasIcs =
      html.includes("BEGIN:VCALENDAR") || url.endsWith(".ics");
    if (result.hasIcs) {
      const veventMatches = html.match(/BEGIN:VEVENT/g);
      result.icsEventCount = veventMatches?.length || 0;

      // Extract sample ICS events
      if (result.icsEventCount > 0) {
        const summaryMatches = html.match(/SUMMARY[^:]*:(.+)/g) || [];
        for (const m of summaryMatches.slice(0, 5)) {
          const title = m.replace(/SUMMARY[^:]*:/, "").trim();
          if (title && result.sampleEvents.length < 5) {
            result.sampleEvents.push(title);
          }
        }
      }
    }

    // --- RSS detection ---
    result.hasRss =
      html.includes("<rss") ||
      html.includes("<feed") ||
      html.includes("<channel>");
    if (result.hasRss) {
      const itemMatches = html.match(/<item>/g) || html.match(/<entry>/g);
      result.rssItemCount = itemMatches?.length || 0;
    }

    // --- Microdata detection ---
    result.hasMicrodata =
      html.includes("itemtype") && html.includes("Event");

    // --- DOM event element count ---
    const eventClassMatches = html.match(/class="[^"]*event[^"]*"/gi);
    result.domEventElements = eventClassMatches?.length || 0;
  } catch (err) {
    result.error =
      err instanceof Error ? err.message : "Unknown fetch error";
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const checkAll = args.includes("--all");
  const nameIdx = args.indexOf("--name");
  const targetName = nameIdx >= 0 ? args[nameIdx + 1] : null;

  // Fetch targets
  let query = supabase
    .from("collector_targets")
    .select(
      "id, name, base_url, discovery_urls, allowed_paths, parsing_strategy, source_type, town, venue_name, default_category, is_enabled, circuit_breaker, last_run_at, total_items_collected"
    )
    .order("name");

  if (targetName) {
    query = query.eq("name", targetName);
  } else if (!checkAll) {
    query = query.eq("is_enabled", true);
  }

  const { data: targets, error } = await query;

  if (error) {
    console.error("Failed to fetch targets:", error.message);
    process.exit(1);
  }

  if (!targets || targets.length === 0) {
    console.log(
      "\nNo targets found. Use --all to include disabled targets."
    );
    return;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Collector Target Verification`);
  console.log(`  ${targets.length} target(s) to check`);
  console.log(`${"=".repeat(60)}\n`);

  let totalTargets = 0;
  let reachableTargets = 0;
  let targetsWithEvents = 0;

  for (const target of targets as TargetRow[]) {
    totalTargets++;
    const discoveryUrls = target.discovery_urls || [];

    console.log(
      `--- ${target.name} [${target.source_type || "untyped"}] ---`
    );
    console.log(`  Base URL:    ${target.base_url}`);
    console.log(`  Strategy:    ${target.parsing_strategy}`);
    console.log(`  Enabled:     ${target.is_enabled}`);
    console.log(`  Town:        ${target.town || "-"}`);
    console.log(`  Category:    ${target.default_category || "-"}`);
    console.log(
      `  Breaker:     ${target.circuit_breaker}`
    );
    console.log(
      `  Last run:    ${target.last_run_at || "never"}`
    );
    console.log(
      `  Total items: ${target.total_items_collected}`
    );
    console.log(
      `  Discovery:   ${discoveryUrls.length > 0 ? discoveryUrls.join(", ") : "(none)"}`
    );

    if (discoveryUrls.length === 0) {
      console.log(`  WARNING: No discovery URLs configured\n`);
      continue;
    }

    let targetHasEvents = false;
    let targetReachable = false;

    for (const discoveryPath of discoveryUrls) {
      let fullUrl: string;
      try {
        fullUrl = new URL(discoveryPath, target.base_url).href;
      } catch {
        console.log(`  SKIP: Invalid URL ${discoveryPath}`);
        continue;
      }

      console.log(`\n  Fetching: ${fullUrl}`);
      const result = await fetchAndAnalyze(fullUrl);

      if (result.error) {
        console.log(`  ERROR: ${result.error}`);
        continue;
      }

      targetReachable = true;
      console.log(
        `  HTTP ${result.status} | ${result.contentType || "unknown"} | ${(result.contentLength / 1024).toFixed(1)} KB`
      );

      // Structured data summary
      const signals: string[] = [];
      if (result.hasJsonLd)
        signals.push(`JSON-LD (${result.jsonLdEventCount} events)`);
      if (result.hasIcs)
        signals.push(`ICS (${result.icsEventCount} events)`);
      if (result.hasRss)
        signals.push(`RSS (${result.rssItemCount} items)`);
      if (result.hasMicrodata) signals.push("Microdata");
      if (result.domEventElements > 0)
        signals.push(`DOM (${result.domEventElements} .event elements)`);

      if (signals.length > 0) {
        console.log(`  Signals: ${signals.join(" | ")}`);
      } else {
        console.log(`  Signals: NONE detected`);
      }

      // Sample events
      if (result.sampleEvents.length > 0) {
        targetHasEvents = true;
        console.log(`  Sample events:`);
        for (const evt of result.sampleEvents) {
          console.log(`    - ${evt}`);
        }
      }
    }

    if (targetReachable) reachableTargets++;
    if (targetHasEvents) targetsWithEvents++;

    // Recommendation
    const rec = !targetReachable
      ? "UNREACHABLE - check base_url"
      : !targetHasEvents
        ? "NO EVENTS DETECTED - may need different discovery_urls or parsing_strategy"
        : target.is_enabled
          ? "ACTIVE"
          : "READY TO ENABLE";
    console.log(`\n  >> ${rec}\n`);

    // Small delay between targets
    await new Promise((r) => setTimeout(r, 500));
  }

  // Summary
  console.log(`${"=".repeat(60)}`);
  console.log(`  Summary`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Total targets:       ${totalTargets}`);
  console.log(`  Reachable:           ${reachableTargets}`);
  console.log(`  With events found:   ${targetsWithEvents}`);
  console.log(
    `  Unreachable:         ${totalTargets - reachableTargets}`
  );
  console.log(
    `  No events detected:  ${reachableTargets - targetsWithEvents}`
  );
  console.log("");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

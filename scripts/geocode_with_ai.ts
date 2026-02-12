/**
 * AI-Assisted Geocoding Script
 *
 * Uses Claude to intelligently geocode explore_items with ambiguous addresses.
 *
 * Pipeline:
 * 1. Claude normalizes/enhances the address with local context
 * 2. Nominatim geocodes the enhanced address
 * 3. If geocoding fails, Claude provides approximate coordinates
 *
 * Usage:
 *   npx tsx scripts/geocode_with_ai.ts
 *
 * Required environment variables:
 *   SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 */

import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

// Initialize Supabase client with service role
const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing required environment variables:");
  console.error("  SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL");
  console.error("  SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!anthropicApiKey) {
  console.error("Missing ANTHROPIC_API_KEY environment variable");
  console.error("Add it to your .env.local file");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Nominatim API endpoint
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Rate limits
const NOMINATIM_DELAY_MS = 1100; // 1.1 seconds for Nominatim
const CLAUDE_DELAY_MS = 100; // Small delay between Claude calls

interface ExploreItem {
  id: string;
  title: string;
  location_name: string | null;
  address: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
}

interface GeocodingReport {
  total: number;
  geocoded: number;
  failed: number;
  skipped: number;
  errors: string[];
}

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Call Claude API
 */
async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 500
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: maxTokens,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.content[0]?.text || "";
}

/**
 * Use Claude to normalize and enhance an address
 */
async function enhanceAddressWithClaude(item: ExploreItem): Promise<string> {
  const systemPrompt = `You are a geocoding assistant specializing in the North Country region of New York State, particularly the Potsdam, Canton, and Adirondacks area.

Your task is to take location information and return a single, well-formatted address string that will work with OpenStreetMap's Nominatim geocoder.

Rules:
1. Always add "NY" or "New York" to addresses in this region
2. For hiking trails, use the trailhead location, not the summit
3. For parks, use the main entrance or parking area
4. For businesses, include the street address if known
5. For lakes/mountains, provide the nearest town or access point
6. If the location is ambiguous, use your knowledge to pick the most likely one in the Potsdam/Adirondacks area
7. Return ONLY the enhanced address string, nothing else`;

  const userPrompt = `Location to geocode:
- Title: ${item.title}
- Location Name: ${item.location_name || "not provided"}
- Address: ${item.address || "not provided"}
- Town: ${item.town || "not provided"}

Return a single geocodable address string:`;

  try {
    const enhanced = await callClaude(systemPrompt, userPrompt, 100);
    return enhanced.trim().replace(/^["']|["']$/g, ""); // Remove quotes if present
  } catch (error) {
    console.error(`  Claude enhancement failed:`, error instanceof Error ? error.message : error);
    // Fall back to original address
    return [item.address, item.town].filter(Boolean).join(", ");
  }
}

/**
 * Use Claude to get coordinates directly when geocoding fails
 */
async function getCoordinatesFromClaude(item: ExploreItem): Promise<{ lat: number; lng: number } | null> {
  const systemPrompt = `You are a geocoding assistant with knowledge of the North Country region of New York State, particularly Potsdam, Canton, Lake Placid, and the Adirondacks.

When given a location, provide the approximate latitude and longitude coordinates.

IMPORTANT:
- Return ONLY valid JSON in this exact format: {"lat": 44.6697, "lng": -74.9814}
- Use your knowledge of the area to provide accurate coordinates
- For hiking trails, use trailhead coordinates
- For towns, use the town center
- If you're not confident about the exact location, provide your best estimate for the general area
- Do NOT include any explanation, just the JSON`;

  const userPrompt = `Get coordinates for:
- Title: ${item.title}
- Location Name: ${item.location_name || "not provided"}
- Address: ${item.address || "not provided"}
- Town: ${item.town || "not provided"}

Return JSON only:`;

  try {
    const response = await callClaude(systemPrompt, userPrompt, 50);

    // Extract JSON from response
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      return null;
    }

    const coords = JSON.parse(jsonMatch[0]);

    if (typeof coords.lat === "number" && typeof coords.lng === "number") {
      // Validate coordinates are in reasonable range for NY
      if (coords.lat >= 40 && coords.lat <= 46 && coords.lng >= -80 && coords.lng <= -72) {
        return { lat: coords.lat, lng: coords.lng };
      }
    }

    return null;
  } catch (error) {
    console.error(`  Claude coordinates failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Geocode an address using Nominatim
 */
async function geocodeWithNominatim(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address.trim()) {
    return null;
  }

  const params = new URLSearchParams({
    q: address,
    format: "json",
    limit: "1",
    addressdetails: "0",
  });

  try {
    const response = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: {
        "User-Agent": "EudaApp/1.0 (geocoding script)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const results = await response.json();

    if (results.length === 0) {
      return null;
    }

    const lat = parseFloat(results[0].lat);
    const lng = parseFloat(results[0].lon);

    if (isNaN(lat) || isNaN(lng)) {
      return null;
    }

    return { lat, lng };
  } catch (error) {
    console.error(`  Nominatim error:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main geocoding pipeline for a single item
 */
async function geocodeItem(item: ExploreItem): Promise<{ lat: number; lng: number; method: string } | null> {
  // Step 1: Enhance address with Claude
  console.log(`    Step 1: Enhancing address with Claude...`);
  const enhancedAddress = await enhanceAddressWithClaude(item);
  console.log(`    Enhanced: "${enhancedAddress}"`);

  await sleep(CLAUDE_DELAY_MS);

  // Step 2: Try geocoding with Nominatim
  console.log(`    Step 2: Geocoding with Nominatim...`);
  await sleep(NOMINATIM_DELAY_MS);
  const nominatimResult = await geocodeWithNominatim(enhancedAddress);

  if (nominatimResult) {
    return { ...nominatimResult, method: "nominatim" };
  }

  // Step 3: Fallback to Claude for direct coordinates
  console.log(`    Step 3: Getting coordinates from Claude...`);
  await sleep(CLAUDE_DELAY_MS);
  const claudeResult = await getCoordinatesFromClaude(item);

  if (claudeResult) {
    return { ...claudeResult, method: "claude" };
  }

  return null;
}

/**
 * Main function
 */
async function main() {
  console.log("=".repeat(60));
  console.log("AI-Assisted Geocoding");
  console.log("=".repeat(60));
  console.log("\nPipeline:");
  console.log("  1. Claude enhances address with local context");
  console.log("  2. Nominatim geocodes enhanced address");
  console.log("  3. Claude provides coordinates if geocoding fails\n");

  // Fetch explore_items that need geocoding
  console.log("Fetching items that need geocoding...");

  const { data: items, error: fetchError } = await supabase
    .from("explore_items")
    .select("id, title, address, town, location_name, lat, lng")
    .or("lat.is.null,lng.is.null");

  if (fetchError) {
    console.error("Failed to fetch items:", fetchError.message);
    process.exit(1);
  }

  if (!items || items.length === 0) {
    console.log("\nNo items need geocoding. All items already have coordinates.");
    return;
  }

  console.log(`Found ${items.length} items to geocode\n`);

  // Initialize report
  const report: GeocodingReport = {
    total: items.length,
    geocoded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const methodCounts = { nominatim: 0, claude: 0 };

  // Process each item
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as ExploreItem;

    console.log(`\n[${i + 1}/${items.length}] "${item.title}"`);
    console.log(`  Location: ${item.location_name || "N/A"}`);
    console.log(`  Address: ${item.address || "N/A"}`);
    console.log(`  Town: ${item.town || "N/A"}`);

    // Skip items with no location info at all
    if (!item.address && !item.location_name && !item.town) {
      console.log(`  ⏭ Skipping - no location data`);
      report.skipped++;
      continue;
    }

    try {
      const result = await geocodeItem(item);

      if (result) {
        // Update the database
        const { error: updateError } = await supabase
          .from("explore_items")
          .update({ lat: result.lat, lng: result.lng })
          .eq("id", item.id);

        if (updateError) {
          console.log(`  ✗ Failed to update: ${updateError.message}`);
          report.failed++;
          report.errors.push(`${item.title}: Update failed - ${updateError.message}`);
        } else {
          console.log(`  ✓ Success via ${result.method}: ${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`);
          report.geocoded++;
          methodCounts[result.method as keyof typeof methodCounts]++;
        }
      } else {
        console.log(`  ✗ Could not geocode`);
        report.failed++;
        report.errors.push(`${item.title}: All geocoding methods failed`);
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error instanceof Error ? error.message : error}`);
      report.failed++;
      report.errors.push(`${item.title}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // Print report
  console.log("\n" + "=".repeat(60));
  console.log("GEOCODING REPORT");
  console.log("=".repeat(60));
  console.log(`Total items:        ${report.total}`);
  console.log(`Successfully coded: ${report.geocoded}`);
  console.log(`  - via Nominatim:  ${methodCounts.nominatim}`);
  console.log(`  - via Claude:     ${methodCounts.claude}`);
  console.log(`Failed:             ${report.failed}`);
  console.log(`Skipped:            ${report.skipped}`);
  console.log("=".repeat(60));

  if (report.errors.length > 0 && report.errors.length <= 10) {
    console.log("\nFailed items:");
    report.errors.forEach((err) => console.log(`  - ${err}`));
  } else if (report.errors.length > 10) {
    console.log(`\n${report.errors.length} items failed. First 10:`);
    report.errors.slice(0, 10).forEach((err) => console.log(`  - ${err}`));
  }

  if (report.geocoded > 0) {
    console.log(`\n✓ Successfully geocoded ${report.geocoded} items!`);
  }

  // Estimate costs
  const estimatedTokensPerItem = 200; // ~100 input + 100 output per Claude call
  const callsPerItem = report.geocoded > 0 ? (report.geocoded + report.failed - report.skipped) * 1.5 : 0; // avg 1.5 calls
  const totalTokens = callsPerItem * estimatedTokensPerItem;
  const costPerMillion = 0.25 + 1.25; // Haiku input + output
  const estimatedCost = (totalTokens / 1_000_000) * costPerMillion;

  console.log(`\nEstimated Claude API cost: ~$${estimatedCost.toFixed(4)}`);
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

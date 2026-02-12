/**
 * Geocode Explore Items Script
 *
 * This script geocodes explore_items that have addresses but no lat/lng coordinates.
 * Uses OpenStreetMap Nominatim API (free, no API key required).
 *
 * Rate limit: 1 request per second (Nominatim policy)
 *
 * Usage:
 *   npx tsx scripts/geocode_explore_items.ts
 *
 * Required environment variables:
 *   SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

// Initialize Supabase client with service role
const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing required environment variables:");
  console.error("  SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL");
  console.error("  SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Nominatim API endpoint
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Rate limit delay (Nominatim requires 1 second between requests)
const RATE_LIMIT_MS = 1100; // 1.1 seconds to be safe

interface GeocodeResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface GeocodingReport {
  total: number;
  geocoded: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * Geocode an address using Nominatim
 */
async function geocodeAddress(address: string, town?: string | null): Promise<{ lat: number; lng: number } | null> {
  // Build the search query
  const query = [address, town].filter(Boolean).join(", ");

  if (!query.trim()) {
    return null;
  }

  const params = new URLSearchParams({
    q: query,
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

    const results: GeocodeResult[] = await response.json();

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
    console.error(`  Geocoding error for "${query}":`, error instanceof Error ? error.message : error);
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
 * Main function
 */
async function main() {
  console.log("=".repeat(60));
  console.log("Geocode Explore Items");
  console.log("=".repeat(60));

  // Fetch explore_items that need geocoding
  console.log("\nFetching items that need geocoding...");

  const { data: items, error: fetchError } = await supabase
    .from("explore_items")
    .select("id, title, address, town, location_name, lat, lng")
    .or("lat.is.null,lng.is.null")
    .not("address", "is", null);

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

  // Process each item
  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Build address for geocoding
    const addressParts = [
      item.address,
      item.town,
    ].filter(Boolean);

    if (addressParts.length === 0) {
      console.log(`  [${i + 1}/${items.length}] Skipping "${item.title}" - no address data`);
      report.skipped++;
      continue;
    }

    const fullAddress = addressParts.join(", ");
    console.log(`  [${i + 1}/${items.length}] Geocoding "${item.title}"`);
    console.log(`              Address: ${fullAddress}`);

    // Geocode the address
    const coords = await geocodeAddress(item.address, item.town);

    if (coords) {
      // Update the database
      const { error: updateError } = await supabase
        .from("explore_items")
        .update({ lat: coords.lat, lng: coords.lng })
        .eq("id", item.id);

      if (updateError) {
        console.log(`              ✗ Failed to update: ${updateError.message}`);
        report.failed++;
        report.errors.push(`${item.title}: Update failed - ${updateError.message}`);
      } else {
        console.log(`              ✓ Found: ${coords.lat}, ${coords.lng}`);
        report.geocoded++;
      }
    } else {
      console.log(`              ✗ Not found`);
      report.failed++;
      report.errors.push(`${item.title}: Address not found - "${fullAddress}"`);
    }

    // Rate limit - wait before next request
    if (i < items.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  // Print report
  console.log("\n" + "=".repeat(60));
  console.log("GEOCODING REPORT");
  console.log("=".repeat(60));
  console.log(`Total items:    ${report.total}`);
  console.log(`Geocoded:       ${report.geocoded}`);
  console.log(`Failed:         ${report.failed}`);
  console.log(`Skipped:        ${report.skipped}`);
  console.log("=".repeat(60));

  if (report.errors.length > 0 && report.errors.length <= 10) {
    console.log("\nFailed items:");
    report.errors.forEach((err) => console.log(`  - ${err}`));
  } else if (report.errors.length > 10) {
    console.log(`\n${report.errors.length} items failed. First 10:`);
    report.errors.slice(0, 10).forEach((err) => console.log(`  - ${err}`));
    console.log(`  ... and ${report.errors.length - 10} more`);
  }

  if (report.geocoded > 0) {
    console.log(`\n✓ Successfully geocoded ${report.geocoded} items!`);
  }

  if (report.failed > 0) {
    console.log(`\n⚠ ${report.failed} items could not be geocoded.`);
    console.log("  These items may have incomplete or incorrect addresses.");
    console.log("  You can manually set coordinates in the Supabase dashboard.");
  }
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

/**
 * Import Curated Events from CSV
 *
 * This script imports the Euda Potsdam Master Database CSV into the
 * event ingestion system (event_ingest_raw + explore_items).
 *
 * Usage:
 *   npx ts-node scripts/import_curated_events.ts
 *
 * Required environment variables:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (not anon key!)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

// Load environment variables
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

// Types
interface CSVRow {
  ID: string;
  "Event Name": string;
  Category: string;
  "Sub-Category": string;
  "Hook Line": string;
  Location: string;
  Address: string;
  "Longitude and Latitude": string;
  Town: string;
  "Distance (mi)": string;
  Schedule: string;
  Time: string;
  Recurrence: string;
  Season: string;
  "Est. Cost": string;
  Effort: string;
  "Target Audience": string;
  "User Tips": string;
  "Verification Method": string;
  "Verification Difficulty": string;
  "XP Value": string;
  "Badge Eligibility": string;
  "Crew Formation": string;
  "Is Anchor": string;
  "Is Hidden Gem": string;
  "Priority (1-5)": string;
  Source: string;
  Audit_Confidence: string;
}

interface ImportReport {
  totalRows: number;
  skippedEmpty: number;
  inserted: number;
  updated: number;
  failed: number;
  missingLatLng: number;
  missingCategory: number;
  errors: string[];
}

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

// ============================================================================
// Normalization Functions
// ============================================================================

/**
 * Clean text by removing Windows-1252 characters and trimming
 */
function cleanText(text: string | undefined | null): string | null {
  if (!text || typeof text !== "string") return null;

  // Replace common Windows-1252 / mojibake characters
  let cleaned = text
    .replace(/–/g, "-") // en-dash
    .replace(/—/g, "-") // em-dash
    .replace(/'/g, "'") // smart quote
    .replace(/'/g, "'") // smart quote
    .replace(/"/g, '"') // smart quote
    .replace(/"/g, '"') // smart quote
    .replace(/…/g, "...") // ellipsis
    .replace(/°/g, " degrees ") // degree symbol issues
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/\uFFFD/g, "") // replacement character
    .replace(/�/g, "-") // common mojibake
    .trim();

  return cleaned || null;
}

/**
 * Parse "Longitude and Latitude" field into { lat, lng }
 * Handles formats:
 *   - "44.19661528761782, -74.87251709305421" (comma-separated)
 *   - "43.656012 -74.832907" (space-separated)
 *   - Empty or malformed
 */
function parseLatLng(value: string | undefined | null): { lat: number | null; lng: number | null } {
  if (!value || typeof value !== "string") {
    return { lat: null, lng: null };
  }

  const cleaned = value.trim();
  if (!cleaned) {
    return { lat: null, lng: null };
  }

  // Try comma-separated first
  let parts: string[];
  if (cleaned.includes(",")) {
    parts = cleaned.split(",").map((p) => p.trim());
  } else {
    // Try space-separated
    parts = cleaned.split(/\s+/).filter((p) => p);
  }

  if (parts.length < 2) {
    return { lat: null, lng: null };
  }

  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);

  // Validate reasonable lat/lng ranges for North Country NY area
  if (isNaN(lat) || isNaN(lng)) {
    return { lat: null, lng: null };
  }

  // Basic sanity check (should be in NY/Adirondacks area roughly)
  if (lat < 40 || lat > 50 || lng < -80 || lng > -70) {
    // Outside expected range but still valid floats - keep them
    console.warn(`  Warning: Coordinates outside expected range: ${lat}, ${lng}`);
  }

  return { lat, lng };
}

/**
 * Map "Est. Cost" to price_bucket enum
 */
function mapPriceBucket(value: string | undefined | null): string {
  if (!value || typeof value !== "string") return "unknown";

  const cleaned = value.trim().toLowerCase();

  if (cleaned === "free" || cleaned === "$0" || cleaned === "0") {
    return "free";
  }
  if (cleaned === "free+rental" || cleaned.includes("free")) {
    return "free"; // Free base with optional rental
  }
  if (cleaned === "$") {
    return "$";
  }
  if (cleaned === "$$") {
    return "$$";
  }
  if (cleaned === "$$$" || cleaned === "$$$$") {
    return "$$$";
  }

  return "unknown";
}

/**
 * Map "Effort" to effort_level enum
 */
function mapEffort(value: string | undefined | null): string {
  if (!value || typeof value !== "string") return "unknown";

  const cleaned = value.trim().toLowerCase();

  if (cleaned === "low" || cleaned === "easy") {
    return "low";
  }
  if (cleaned === "medium" || cleaned === "moderate") {
    return "medium";
  }
  if (cleaned === "high" || cleaned === "hard" || cleaned === "difficult") {
    return "high";
  }

  return "unknown";
}

/**
 * Parse boolean from TRUE/FALSE/Yes/No string
 */
function parseBoolean(value: string | undefined | null): boolean {
  if (!value || typeof value !== "string") return false;

  const cleaned = value.trim().toLowerCase();
  return cleaned === "true" || cleaned === "yes" || cleaned === "1";
}

/**
 * Parse XP Value as integer with fallback
 */
function parseXpValue(value: string | undefined | null, defaultXp: number = 50): number {
  if (!value || typeof value !== "string") return defaultXp;

  const parsed = parseInt(value.trim(), 10);
  return isNaN(parsed) ? defaultXp : parsed;
}

/**
 * Parse priority (1-5) as integer
 */
function parsePriority(value: string | undefined | null): number {
  if (!value || typeof value !== "string") return 0;

  const parsed = parseInt(value.trim(), 10);
  if (isNaN(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed)); // Clamp 0-5
}

/**
 * Map category to item kind
 */
function mapKind(category: string | undefined | null): string {
  if (!category) return "activity";

  const cleaned = category.trim().toLowerCase();

  // Events are typically time-bound
  if (
    cleaned.includes("event") ||
    cleaned.includes("festival") ||
    cleaned.includes("concert") ||
    cleaned.includes("game") ||
    cleaned.includes("performance")
  ) {
    return "event";
  }

  // Most things in this CSV are activities (ongoing/repeatable)
  return "activity";
}

/**
 * Map confidence from Audit_Confidence field
 */
function mapConfidence(value: string | undefined | null): number {
  if (!value || typeof value !== "string") return 50;

  const cleaned = value.trim().toUpperCase();

  switch (cleaned) {
    case "HIGH":
      return 90;
    case "MEDIUM":
      return 70;
    case "LOW":
      return 40;
    case "FLAG":
      return 30;
    default:
      return 50;
  }
}

/**
 * Generate SHA256 hash of row data for deduplication
 */
function hashRow(row: CSVRow): string {
  const content = JSON.stringify(row);
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ============================================================================
// Main Import Logic
// ============================================================================

async function getOrCreateSource(): Promise<string> {
  // Check if curated_csv source exists
  const { data: existing } = await supabase
    .from("event_sources")
    .select("id")
    .eq("name", "Euda Potsdam Master CSV")
    .single();

  if (existing) {
    return existing.id;
  }

  // Create new source
  const { data: created, error } = await supabase
    .from("event_sources")
    .insert({
      name: "Euda Potsdam Master CSV",
      type: "curated_csv",
      is_enabled: true,
      config_json: {
        file: "src/types/Euda_Potsdam_Master_Database(Events Master).csv",
        description: "Curated events and activities for Potsdam/North Country area",
      },
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create event source: ${error.message}`);
  }

  return created!.id;
}

async function importRow(
  row: CSVRow,
  sourceId: string,
  report: ImportReport
): Promise<"inserted" | "updated" | "failed" | "skipped"> {
  // Skip empty rows (no ID or Event Name)
  if (!row.ID || !row["Event Name"]) {
    return "skipped";
  }

  const externalId = `csv_${row.ID}`;
  const rawHash = hashRow(row);

  try {
    // Step 1: Upsert into event_ingest_raw
    const { error: rawError } = await supabase.from("event_ingest_raw").upsert(
      {
        source_id: sourceId,
        external_id: externalId,
        raw_json: row,
        raw_hash: rawHash,
        status: "normalized", // We're normalizing immediately
        fetched_at: new Date().toISOString(),
      },
      {
        onConflict: "source_id,external_id",
      }
    );

    if (rawError) {
      throw new Error(`Raw insert failed: ${rawError.message}`);
    }

    // Step 2: Parse and normalize
    const { lat, lng } = parseLatLng(row["Longitude and Latitude"]);

    if (!lat || !lng) {
      report.missingLatLng++;
    }

    if (!row.Category) {
      report.missingCategory++;
    }

    // Build normalized explore_item
    const exploreItem = {
      source_id: sourceId,
      external_id: externalId,
      kind: mapKind(row.Category),
      title: cleanText(row["Event Name"])!,
      description: cleanText(row["User Tips"]), // Use tips as description
      hook_line: cleanText(row["Hook Line"]),
      category: cleanText(row.Category),
      sub_category: cleanText(row["Sub-Category"]),
      location_name: cleanText(row.Location),
      address: cleanText(row.Address),
      town: cleanText(row.Town),
      lat,
      lng,
      // Time fields - store as-is, don't parse dates
      starts_at: null, // Activities don't have fixed start times
      ends_at: null,
      schedule_text: cleanText(row.Schedule),
      time_text: cleanText(row.Time),
      recurrence: cleanText(row.Recurrence),
      season: cleanText(row.Season),
      // Pricing and effort
      price_bucket: mapPriceBucket(row["Est. Cost"]),
      effort: mapEffort(row.Effort),
      // Gamification
      xp_value: parseXpValue(row["XP Value"]),
      priority: parsePriority(row["Priority (1-5)"]),
      // Flags
      is_anchor: parseBoolean(row["Is Anchor"]),
      is_hidden_gem: parseBoolean(row["Is Hidden Gem"]),
      // Quality
      normalized_confidence: mapConfidence(row.Audit_Confidence),
      source_url: null, // CSV doesn't have URLs
    };

    // Step 3: Check if exists to determine insert vs update
    const { data: existingItem } = await supabase
      .from("explore_items")
      .select("id")
      .eq("source_id", sourceId)
      .eq("external_id", externalId)
      .single();

    const isUpdate = !!existingItem;

    // Step 4: Upsert into explore_items
    const { error: itemError } = await supabase.from("explore_items").upsert(exploreItem, {
      onConflict: "source_id,external_id",
    });

    if (itemError) {
      throw new Error(`Explore item upsert failed: ${itemError.message}`);
    }

    return isUpdate ? "updated" : "inserted";
  } catch (error) {
    report.errors.push(`Row ${row.ID}: ${error instanceof Error ? error.message : String(error)}`);
    return "failed";
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Euda Curated Events Import");
  console.log("=".repeat(60));

  // Read CSV file
  const csvPath = path.join(__dirname, "../src/types/Euda_Potsdam_Master_Database(Events Master).csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`\nReading: ${csvPath}`);

  const csvContent = fs.readFileSync(csvPath, "utf-8");

  // Parse CSV
  const rows: CSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Found ${rows.length} rows in CSV\n`);

  // Initialize report
  const report: ImportReport = {
    totalRows: rows.length,
    skippedEmpty: 0,
    inserted: 0,
    updated: 0,
    failed: 0,
    missingLatLng: 0,
    missingCategory: 0,
    errors: [],
  };

  // Get or create source
  console.log("Getting/creating event source...");
  const sourceId = await getOrCreateSource();
  console.log(`Source ID: ${sourceId}\n`);

  // Process rows
  console.log("Importing rows...");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const result = await importRow(row, sourceId, report);

    switch (result) {
      case "inserted":
        report.inserted++;
        break;
      case "updated":
        report.updated++;
        break;
      case "failed":
        report.failed++;
        break;
      case "skipped":
        report.skippedEmpty++;
        break;
    }

    // Progress indicator
    if ((i + 1) % 25 === 0 || i === rows.length - 1) {
      process.stdout.write(`\r  Processed ${i + 1}/${rows.length} rows...`);
    }
  }

  console.log("\n");

  // Print report
  console.log("=".repeat(60));
  console.log("IMPORT REPORT");
  console.log("=".repeat(60));
  console.log(`Total rows in CSV:     ${report.totalRows}`);
  console.log(`Skipped (empty):       ${report.skippedEmpty}`);
  console.log(`Inserted:              ${report.inserted}`);
  console.log(`Updated:               ${report.updated}`);
  console.log(`Failed:                ${report.failed}`);
  console.log("-".repeat(60));
  console.log(`Missing lat/lng:       ${report.missingLatLng}`);
  console.log(`Missing category:      ${report.missingCategory}`);
  console.log("=".repeat(60));

  if (report.errors.length > 0) {
    console.log("\nERRORS:");
    report.errors.forEach((err) => console.log(`  - ${err}`));
  }

  if (report.failed === 0) {
    console.log("\n✓ Import completed successfully!");
  } else {
    console.log(`\n⚠ Import completed with ${report.failed} errors`);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

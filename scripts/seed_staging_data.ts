/**
 * Seed the STAGING Supabase project with a small, valid set of test
 * explore_items so the app isn't empty when pointed at staging.
 *
 * Usage:
 *   STAGING_SUPABASE_URL=https://<ref>.supabase.co \
 *   STAGING_SERVICE_ROLE_KEY=<staging-service-role-key> \
 *   npx tsx scripts/seed_staging_data.ts
 *
 * Or put STAGING_SUPABASE_URL / STAGING_SERVICE_ROLE_KEY in .env.staging
 * (gitignored) and run the script — it loads that file automatically.
 *
 * Safety: this script writes with the service-role key (bypasses RLS), so it
 * REFUSES to run against the known production project ref. Staging only.
 *
 * Idempotent: rows use fixed UUIDs and are upserted on `id`, so re-running
 * updates rather than duplicates.
 */
import * as dotenv from "dotenv";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(__dirname, "../.env.staging") });

const PROD_REF = "lkmntknpaiaiqvupzjbz"; // never seed this project

const url = process.env.STAGING_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const serviceKey =
  process.env.STAGING_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !serviceKey) {
  console.error(
    "Missing STAGING_SUPABASE_URL or STAGING_SERVICE_ROLE_KEY. " +
      "Set them in .env.staging or the environment.",
  );
  process.exit(1);
}

if (url.includes(PROD_REF)) {
  console.error(
    `REFUSING TO RUN: target URL points at the production project (${PROD_REF}). ` +
      "This script only seeds staging.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// Fixed UUIDs → idempotent upserts. Coordinates are real Warwick/Bethel-area
// points so location-based queries return something sensible.
const SEED_ITEMS = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "event",
    title: "[STAGING] Warwick Library Open House",
    description: "Test event seeded into staging. Not real.",
    category: "community",
    location_name: "Albert Wisner Public Library",
    town: "Warwick",
    address: "1 McFarland Dr, Warwick, NY 10990",
    lat: 41.2557,
    lng: -74.3601,
    starts_at: "2026-07-01T18:00:00Z",
    source_url: "https://example.com/staging/warwick-library",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    kind: "event",
    title: "[STAGING] Bethel Woods Summer Concert",
    description: "Test event seeded into staging. Not real.",
    category: "music",
    location_name: "Bethel Woods Center for the Arts",
    town: "Bethel",
    address: "200 Hurd Rd, Bethel, NY 12720",
    lat: 41.7012,
    lng: -74.8746,
    starts_at: "2026-07-15T23:00:00Z",
    source_url: "https://example.com/staging/bethel-concert",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    kind: "activity",
    title: "[STAGING] Sugar Loaf Artisan Walk",
    description: "Test recurring activity seeded into staging. Not real.",
    category: "outdoors",
    location_name: "Sugar Loaf Village",
    town: "Sugar Loaf",
    lat: 41.2876,
    lng: -74.2965,
    schedule_text: "Every Saturday 10am-4pm",
    recurrence: "weekly",
    source_url: "https://example.com/staging/sugar-loaf-walk",
  },
  // Portland, ME items — so staging has visible content for testers there
  // (the 50mi distance gate hides the NY items when you're in Maine).
  {
    id: "00000000-0000-4000-8000-000000000004",
    kind: "event",
    title: "[STAGING] State Theatre Live Show",
    description: "Test event seeded into staging. Not real.",
    category: "music",
    location_name: "State Theatre",
    town: "Portland",
    address: "609 Congress St, Portland, ME 04101",
    lat: 43.6536,
    lng: -70.2634,
    starts_at: "2026-06-25T23:00:00Z",
    source_url: "https://example.com/staging/portland-state-theatre",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    kind: "event",
    title: "[STAGING] Thompson's Point Outdoor Concert",
    description: "Test event seeded into staging. Not real.",
    category: "music",
    location_name: "Thompson's Point",
    town: "Portland",
    address: "Thompson's Point Rd, Portland, ME 04102",
    lat: 43.6431,
    lng: -70.2926,
    starts_at: "2026-06-28T22:30:00Z",
    source_url: "https://example.com/staging/portland-thompsons-point",
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    kind: "activity",
    title: "[STAGING] Eastern Promenade Trail Walk",
    description: "Test recurring activity seeded into staging. Not real.",
    category: "outdoors",
    location_name: "Eastern Promenade",
    town: "Portland",
    lat: 43.6679,
    lng: -70.2403,
    schedule_text: "Daily, sunrise to sunset",
    recurrence: "daily",
    source_url: "https://example.com/staging/portland-eastern-prom",
  },
];

async function main() {
  console.log(`Seeding ${SEED_ITEMS.length} test items into ${url} ...`);
  const { error } = await supabase
    .from("explore_items")
    .upsert(SEED_ITEMS, { onConflict: "id" });

  if (error) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  }

  const { count } = await supabase
    .from("explore_items")
    .select("id", { count: "exact", head: true })
    .like("source_url", "https://example.com/staging/%");

  console.log(`✓ Seed complete. Staging now has ${count ?? "?"} seeded test items.`);
}

main();

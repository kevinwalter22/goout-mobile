// Phase P-A: run the initial Google Places ingest for Portland, then normalize.
// Diagnostic/operational: invokes prod edge functions via service-role.
// Run: npx tsx scripts/portland_gp_ingest.ts
import * as dotenv from "dotenv"; import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const LAT = 43.6591, LNG = -70.2568;
const GP_TYPES = [
  "restaurant", "cafe", "bar", "bakery", "gym", "spa", "park", "campground",
  "museum", "library", "art_gallery", "movie_theater", "bowling_alley",
  "night_club", "shopping_mall", "book_store", "tourist_attraction",
  "performing_arts_theater", "marina", "historical_landmark",
];

(async () => {
  console.log("Invoking ingest-google-places (Portland, radius 32km)...");
  const t0 = Date.now();
  const { data: gp, error: gpErr } = await s.functions.invoke("ingest-google-places", {
    body: { lat: LAT, lng: LNG, radius_meters: 32000, included_types: GP_TYPES },
  });
  if (gpErr) { console.log("GP ingest ERROR:", gpErr.message); }
  console.log(`GP ingest done in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log("GP result:", JSON.stringify(gp)?.slice(0, 800));

  // Normalize the new google_places raw rows in batches
  console.log("\nNormalizing google_places candidates...");
  for (let i = 0; i < 8; i++) {
    const { data: norm, error: nErr } = await s.functions.invoke("normalize-raw-events", {
      body: { source_type: "api_google_places", batch_size: 100 },
    });
    if (nErr) { console.log("normalize ERR:", nErr.message); break; }
    const r: any = norm || {};
    console.log(`  batch ${i + 1}: ${JSON.stringify(r).slice(0, 240)}`);
    const processed = r.processed ?? r.normalized ?? 0;
    if (!processed) break;
  }

  // Count Portland bbox items now
  const b = { latMin: 43.45, latMax: 43.95, lngMin: -70.55, lngMax: -69.95 };
  const { count } = await s.from("explore_items").select("id", { count: "exact", head: true })
    .gte("lat", b.latMin).lte("lat", b.latMax).gte("lng", b.lngMin).lte("lng", b.lngMax).is("deleted_at", null);
  console.log(`\nPortland rectangle items now: ${count ?? 0}`);

  const { data: bud } = await s.rpc("get_api_budget", { p_service: "google_places" });
  console.log("Google Places budget:", JSON.stringify((bud as any)?.[0]));
})();

// Phase P-A: create Portland fetch_partitions (idempotent) for the 3 API sources.
// Center = downtown Portland, ME. Radii chosen to honor the approved catalog
// rectangle (lat 43.45–43.95, lng -70.55 to -69.95):
//   - events (TM/PHQ): radius covers the full rectangle (Brunswick<->Biddeford)
//   - Google Places venue sweep: tighter 20mi dense-core; edges via P-C targets
// Run: npx tsx scripts/portland_pa_setup.ts
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

const PARTITIONS = [
  {
    source_id: "a3770888-4650-4de1-8df6-fe4cdfa4eae4", // Google Places
    partition_label: "portland-activities",
    config_json: { lat: LAT, lng: LNG, radius_meters: 32000, included_types: GP_TYPES },
    priority: 5, fetch_interval_minutes: 720,
  },
  {
    source_id: "651086c3-4ac5-49a5-be73-12ae3bc7eafb", // Ticketmaster
    partition_label: "portland-25mi",
    config_json: { lat: LAT, lng: LNG, radius: 25, radius_unit: "miles", days_ahead: 90 },
    priority: 10, fetch_interval_minutes: 360,
  },
  {
    source_id: "6c7d5ca6-0f10-4335-97ca-c0e3ae02ed0c", // PredictHQ
    partition_label: "portland-events",
    config_json: {
      lat: LAT, lng: LNG, radius_km: 40, min_rank: 20, days_ahead: 90,
      categories: ["community", "concerts", "conferences", "expos", "festivals", "performing-arts", "sports"],
    },
    priority: 8, fetch_interval_minutes: 720,
  },
];

(async () => {
  for (const p of PARTITIONS) {
    const { data: existing } = await (s as any).from("fetch_partitions")
      .select("id, is_enabled").eq("partition_label", p.partition_label).maybeSingle();
    if (existing) {
      const { error } = await (s as any).from("fetch_partitions")
        .update({ config_json: p.config_json, priority: p.priority, fetch_interval_minutes: p.fetch_interval_minutes, is_enabled: true })
        .eq("id", existing.id);
      console.log(error ? `UPDATE ERR ${p.partition_label}: ${error.message}` : `updated ${p.partition_label} (enabled)`);
    } else {
      const { error } = await (s as any).from("fetch_partitions").insert({ ...p, is_enabled: true });
      console.log(error ? `INSERT ERR ${p.partition_label}: ${error.message}` : `created ${p.partition_label} (enabled)`);
    }
  }
  const { data } = await (s as any).from("fetch_partitions")
    .select("partition_label, is_enabled, priority, config_json").ilike("partition_label", "portland%");
  console.log("\nPortland partitions now:");
  for (const r of data || []) console.log(`  [${r.is_enabled ? "ON" : "off"}] ${r.partition_label} p=${r.priority} ${JSON.stringify(r.config_json)}`);
})();

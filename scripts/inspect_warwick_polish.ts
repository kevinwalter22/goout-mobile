// Production polish session — single inspection pass covering:
//   1. Potsdam leak: find a Potsdam Elite Events row + check coords + starts_at
//   2. NYC leak: find Ticketmaster/PredictHQ rows with NYC coords; trace to partition
//   3. Image coverage: Warwick-bbox coverage stats
//   4. Phase 5.3 cron health: cache-place-photos recent runs
//   5. anthropic_haiku spend (for Phase 5.3 bump decision)
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Warwick bbox (matches the discover-venues-to-crawl Warwick call)
const WARWICK = { lat: 41.2545, lng: -74.359 };
const BBOX = { min_lat: 40.75, max_lat: 41.75, min_lng: -75.0, max_lng: -73.7 };

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
  console.log("═══ Issue 1: Potsdam leak ═══\n");
  const { data: prom } = await supabase
    .from("explore_items")
    .select("id, title, kind, town, lat, lng, starts_at, location_name, source_id, deleted_at")
    .ilike("title", "%prom fit%")
    .limit(5);
  console.log(`'prom fit' matches: ${prom?.length || 0}`);
  for (const r of prom || []) {
    console.log(`  ${r.id} | ${r.title} | town=${r.town} | starts_at=${r.starts_at} | lat/lng=${r.lat}/${r.lng} | venue=${r.location_name} | deleted=${r.deleted_at}`);
  }

  const { data: elite } = await supabase
    .from("explore_items")
    .select("id, title, town, lat, lng, starts_at, location_name, source_id")
    .ilike("location_name", "%elite event%")
    .limit(10);
  console.log(`\n'elite event' venue matches: ${elite?.length || 0}`);
  for (const r of elite || []) {
    const dist = r.lat && r.lng ? distanceMiles(WARWICK.lat, WARWICK.lng, r.lat, r.lng).toFixed(0) : "null";
    console.log(`  ${r.title} | venue=${r.location_name} | ${dist}mi from Warwick | starts=${r.starts_at}`);
  }

  console.log("\n# Count of past events still live in catalog (kind=event, starts_at < NOW(), not deleted)");
  const { count: pastEvents } = await supabase
    .from("explore_items")
    .select("id", { count: "exact", head: true })
    .eq("kind", "event")
    .lt("starts_at", new Date().toISOString())
    .is("deleted_at", null);
  console.log(`  ${pastEvents} past events live`);

  console.log("\n# Count of null-coord live items by source");
  const { data: srcs } = await supabase.from("event_sources").select("id, name");
  for (const s of srcs || []) {
    const { count: nullCount } = await supabase
      .from("explore_items")
      .select("id", { count: "exact", head: true })
      .eq("source_id", s.id)
      .is("lat", null)
      .is("deleted_at", null);
    if ((nullCount || 0) > 0) {
      console.log(`  ${s.name.padEnd(40)} | ${nullCount} null-coord live items`);
    }
  }

  console.log("\n\n═══ Issue 3: NYC leak ═══\n");
  // NYC center ~40.75, -74.0
  const NYC = { lat: 40.75, lng: -74.0 };
  const { data: tm } = await supabase
    .from("explore_items")
    .select("id, title, town, lat, lng, source_id, location_name")
    .eq("source_id", srcs?.find((s) => s.name === "Ticketmaster")?.id)
    .gte("lat", 40.5).lte("lat", 41.0)
    .gte("lng", -74.3).lte("lng", -73.7)
    .is("deleted_at", null)
    .limit(20);
  console.log(`Ticketmaster rows near NYC (40.5-41.0, -74.3 to -73.7): ${tm?.length || 0}`);
  for (const r of (tm || []).slice(0, 10)) {
    const distNYC = r.lat && r.lng ? distanceMiles(NYC.lat, NYC.lng, r.lat, r.lng).toFixed(0) : "null";
    const distWarwick = r.lat && r.lng ? distanceMiles(WARWICK.lat, WARWICK.lng, r.lat, r.lng).toFixed(0) : "null";
    console.log(`  ${r.title?.slice(0, 60)} | venue=${r.location_name} | ${distNYC}mi from NYC | ${distWarwick}mi from Warwick`);
  }

  const { data: phq } = await supabase
    .from("explore_items")
    .select("id, title, town, lat, lng, location_name")
    .eq("source_id", srcs?.find((s) => s.name === "PredictHQ")?.id)
    .gte("lat", 40.5).lte("lat", 41.0)
    .gte("lng", -74.3).lte("lng", -73.7)
    .is("deleted_at", null)
    .limit(20);
  console.log(`\nPredictHQ rows near NYC: ${phq?.length || 0}`);
  for (const r of (phq || []).slice(0, 10)) {
    const distWarwick = r.lat && r.lng ? distanceMiles(WARWICK.lat, WARWICK.lng, r.lat, r.lng).toFixed(0) : "null";
    console.log(`  ${r.title?.slice(0, 60)} | venue=${r.location_name} | ${distWarwick}mi from Warwick`);
  }

  console.log("\n# fetch_partitions");
  const { data: parts } = await supabase
    .from("fetch_partitions")
    .select("*")
    .eq("is_enabled", true)
    .order("partition_label");
  for (const p of parts || []) {
    console.log(`  ${p.partition_label.padEnd(40)} | source_type=${p.source_type} | cfg=${JSON.stringify(p.config_json).slice(0, 200)}`);
  }

  console.log("\n\n═══ Issue 4: Image coverage ═══\n");
  // Warwick bbox + has lat/lng + is Google Places
  const gpSrc = srcs?.find((s) => s.name === "Google Places")?.id;
  const { count: warwickGP } = await supabase
    .from("explore_items")
    .select("id", { count: "exact", head: true })
    .eq("source_id", gpSrc)
    .gte("lat", BBOX.min_lat).lte("lat", BBOX.max_lat)
    .gte("lng", BBOX.min_lng).lte("lng", BBOX.max_lng)
    .is("deleted_at", null);
  const { count: warwickGPwithImage } = await supabase
    .from("explore_items")
    .select("id", { count: "exact", head: true })
    .eq("source_id", gpSrc)
    .gte("lat", BBOX.min_lat).lte("lat", BBOX.max_lat)
    .gte("lng", BBOX.min_lng).lte("lng", BBOX.max_lng)
    .not("image_url", "is", null)
    .is("deleted_at", null);
  console.log(`Warwick-bbox Google Places: ${warwickGP} total, ${warwickGPwithImage} with image (${(100 * (warwickGPwithImage || 0) / Math.max(1, warwickGP || 1)).toFixed(1)}%)`);

  console.log("\n# Warwick Drive-In Theater specifically");
  const { data: drivein } = await supabase
    .from("explore_items")
    .select("id, title, external_id, image_url, image_thumb_url, image_cached_at, image_search_attempted_at")
    .ilike("title", "%warwick drive%")
    .limit(5);
  for (const r of drivein || []) {
    console.log(`  ${r.id} | ${r.title} | ext=${r.external_id?.slice(0, 50)} | img=${r.image_url ? "YES" : "NO"} | searched=${r.image_search_attempted_at}`);
    if (r.id) {
      const { data: pd } = await supabase
        .from("place_details_cache")
        .select("photos")
        .eq("explore_item_id", r.id)
        .single();
      console.log(`    place_details_cache.photos: ${pd ? (pd.photos as any[])?.length + " photos" : "no cache row"}`);
    }
  }

  console.log("\n\n═══ Issue 5: Phase 5.3 budget + venue_crawl_state ═══\n");
  const { data: budget } = await supabase.rpc("get_api_budget", { p_service: "anthropic_haiku" });
  console.log(`anthropic_haiku budget: ${JSON.stringify(budget)}`);

  const { count: warwickVCS } = await supabase
    .from("venue_crawl_state")
    .select("id", { count: "exact", head: true });
  const { count: crawledVCS } = await supabase
    .from("venue_crawl_state")
    .select("id", { count: "exact", head: true })
    .not("last_crawled_at", "is", null);
  console.log(`venue_crawl_state total=${warwickVCS}, crawled=${crawledVCS}`);

  // How many Warwick-bbox venues have website_url but no venue_crawl_state?
  const { data: warwickVenues } = await supabase
    .from("explore_items")
    .select("id, source_url")
    .eq("source_id", gpSrc)
    .gte("lat", BBOX.min_lat).lte("lat", BBOX.max_lat)
    .gte("lng", BBOX.min_lng).lte("lng", BBOX.max_lng)
    .not("source_url", "is", null)
    .is("deleted_at", null)
    .gte("relevance_tier", 2)
    .limit(2000);
  console.log(`Warwick-bbox GP venues with source_url + relevance_tier>=2: ${warwickVenues?.length || 0}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

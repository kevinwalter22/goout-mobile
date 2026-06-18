import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { count: total } = await supabase
    .from("venue_crawl_state")
    .select("id", { count: "exact", head: true });
  const { count: crawled } = await supabase
    .from("venue_crawl_state")
    .select("id", { count: "exact", head: true })
    .not("last_crawled_at", "is", null);
  const { count: yielded } = await supabase
    .from("venue_crawl_state")
    .select("id", { count: "exact", head: true })
    .gt("events_found_count", 0);

  console.log(`venue_crawl_state total=${total}, last_crawled_at NOT NULL=${crawled}, events_found_count>0=${yielded}`);

  const { data: top } = await supabase
    .from("venue_crawl_state")
    .select("explore_item_id, website_url, last_crawled_at, last_run_events_found, events_found_count, status")
    .gt("events_found_count", 0)
    .order("events_found_count", { ascending: false })
    .limit(10);
  console.log("\nTop yielding venues:");
  for (const r of top || []) {
    console.log(`  ${r.website_url.slice(0, 60)} | found=${r.events_found_count} status=${r.status}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

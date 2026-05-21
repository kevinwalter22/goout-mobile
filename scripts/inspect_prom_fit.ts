// Why is "prom fit" passing the past-event filter?
import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data } = await supabase
    .from("explore_items")
    .select("*")
    .ilike("title", "%prom fit%")
    .single();
  console.log("Full row:");
  for (const [k, v] of Object.entries(data || {})) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    let display = typeof v === "object" ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 200);
    console.log(`  ${k.padEnd(35)} = ${display}`);
  }

  console.log("\nPast-event filter trace:");
  const r = data as any;
  const now = new Date();
  const pastCutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  console.log(`  starts_at IS NULL?       ${r.starts_at == null}`);
  console.log(`  ends_at >= now?          ${r.ends_at ? new Date(r.ends_at) >= now : "ends_at is null"}`);
  console.log(`  ends_at IS NULL?         ${r.ends_at == null}`);
  console.log(`  starts_at >= pastCutoff? ${r.starts_at ? new Date(r.starts_at) >= pastCutoff : "starts_at is null"}`);
  console.log(`  → passes filter?         ${r.starts_at == null || (r.ends_at && new Date(r.ends_at) >= now) || (r.ends_at == null && new Date(r.starts_at) >= pastCutoff)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

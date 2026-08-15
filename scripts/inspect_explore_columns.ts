import * as dotenv from "dotenv";
import * as path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const { data, error } = await supabase.from("explore_items").select("*").limit(1);
  if (error) { console.error(error); return; }
  console.log("Columns:");
  for (const k of Object.keys(data?.[0] || {}).sort()) console.log("  " + k);
})();

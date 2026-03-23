/**
 * Reset Stuck Enrichment Jobs
 *
 * Finds enrichment_queue jobs stuck in 'running' state for > 60 minutes
 * and resets them to 'queued' so they can be retried.
 *
 * Usage: npx tsx scripts/reset-stuck-enrichment.ts
 *        npx tsx scripts/reset-stuck-enrichment.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lkmntknpaiaiqvupzjbz.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY not set in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const STUCK_THRESHOLD_MINUTES = 60;
const isDryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`[reset-stuck-enrichment] Checking for jobs running > ${STUCK_THRESHOLD_MINUTES} minutes...`);
  if (isDryRun) console.log("  (DRY RUN — no changes will be made)\n");

  // 1. Find stuck jobs
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();

  const { data: stuckJobs, error: findError } = await supabase
    .from("enrichment_queue")
    .select("id, explore_item_id, started_at, attempts, status")
    .eq("status", "running")
    .lt("started_at", cutoff);

  if (findError) {
    console.error("Error querying enrichment_queue:", findError.message);
    process.exit(1);
  }

  if (!stuckJobs || stuckJobs.length === 0) {
    console.log("No stuck jobs found. Queue is healthy.");
    return;
  }

  console.log(`Found ${stuckJobs.length} stuck job(s):\n`);
  for (const job of stuckJobs) {
    const ageMin = Math.round((Date.now() - new Date(job.started_at).getTime()) / 60000);
    console.log(`  id=${job.id}  item=${job.explore_item_id}  running for ${ageMin}m  attempts=${job.attempts}`);
  }

  if (isDryRun) {
    console.log("\nDry run complete. Run without --dry-run to reset these jobs.");
    return;
  }

  // 2. Reset stuck jobs to queued
  const stuckIds = stuckJobs.map((j) => j.id);
  const { error: resetError, count } = await supabase
    .from("enrichment_queue")
    .update({
      status: "queued",
      started_at: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", stuckIds);

  if (resetError) {
    console.error("\nError resetting jobs:", resetError.message);
    process.exit(1);
  }

  console.log(`\nReset ${count ?? stuckIds.length} job(s) to 'queued'.`);

  // 3. Summary of queue state
  const { data: summary } = await supabase
    .from("enrichment_queue")
    .select("status")
    .limit(5000);

  if (summary) {
    const counts: Record<string, number> = {};
    for (const row of summary) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    }
    console.log("\nQueue status after reset:");
    for (const [status, count] of Object.entries(counts).sort()) {
      console.log(`  ${status}: ${count}`);
    }
  }
}

main().catch(console.error);

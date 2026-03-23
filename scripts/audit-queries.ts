/**
 * Audit Queries - Run SQL quantification queries for the quality audit
 *
 * Usage: npx tsx scripts/audit-queries.ts
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lkmntknpaiaiqvupzjbz.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Use service_role to bypass RLS entirely
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log("Using service_role key to bypass RLS");

  console.log("\n=== QUERY 1: Total feed-eligible items ===");
  const { count: totalCount } = await supabase
    .from("explore_items")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("is_admin_suppressed", false)
    .gte("priority", 0)
    .eq("is_duplicate", false);
  console.log(`Total feed-eligible items: ${totalCount}`);

  console.log("\n=== QUERY 2: Tag coverage distribution ===");
  const { data: allItems } = await supabase
    .from("explore_items")
    .select("id, tags, normalized_confidence, relevance_tier, llm_enriched_at, audience_fit, is_event_venue, enrichment_version, kind, category, review_status, is_admin_suppressed")
    .is("deleted_at", null)
    .eq("is_admin_suppressed", false)
    .gte("priority", 0)
    .eq("is_duplicate", false)
    .limit(2000);

  if (!allItems || allItems.length === 0) {
    console.log("No items returned - likely RLS blocking. Try setting ADMIN_EMAIL and ADMIN_PASSWORD.");
    return;
  }

  console.log(`Fetched ${allItems.length} items`);

  // Tag distribution
  const tagBuckets = { "0 tags": 0, "1-2 tags": 0, "3-4 tags": 0, "5-7 tags": 0, "8+ tags": 0 };
  for (const item of allItems) {
    const tagCount = item.tags?.length ?? 0;
    if (tagCount === 0) tagBuckets["0 tags"]++;
    else if (tagCount <= 2) tagBuckets["1-2 tags"]++;
    else if (tagCount <= 4) tagBuckets["3-4 tags"]++;
    else if (tagCount <= 7) tagBuckets["5-7 tags"]++;
    else tagBuckets["8+ tags"]++;
  }
  const total = allItems.length;
  for (const [bucket, count] of Object.entries(tagBuckets)) {
    console.log(`  ${bucket}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 3: Unenriched items in feed ===");
  const unenriched = allItems.filter(i => !i.llm_enriched_at);
  const sparseTagItems = allItems.filter(i => (i.tags?.length ?? 0) < 3);
  console.log(`  Not enriched (llm_enriched_at IS NULL): ${unenriched.length} (${((unenriched.length / total) * 100).toFixed(1)}%)`);
  console.log(`  Tags < 3: ${sparseTagItems.length} (${((sparseTagItems.length / total) * 100).toFixed(1)}%)`);
  console.log(`  Tags < 5: ${allItems.filter(i => (i.tags?.length ?? 0) < 5).length} (${((allItems.filter(i => (i.tags?.length ?? 0) < 5).length / total) * 100).toFixed(1)}%)`);

  console.log("\n=== QUERY 4: Confidence distribution ===");
  const confBuckets = { "NULL": 0, "0-39": 0, "40-54": 0, "55-69": 0, "70-79": 0, "80-100": 0 };
  for (const item of allItems) {
    const conf = item.normalized_confidence;
    if (conf == null) confBuckets["NULL"]++;
    else if (conf < 40) confBuckets["0-39"]++;
    else if (conf < 55) confBuckets["40-54"]++;
    else if (conf < 70) confBuckets["55-69"]++;
    else if (conf < 80) confBuckets["70-79"]++;
    else confBuckets["80-100"]++;
  }
  for (const [bucket, count] of Object.entries(confBuckets)) {
    console.log(`  confidence ${bucket}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 5: Relevance tier distribution ===");
  const tierBuckets: Record<string, number> = {};
  for (const item of allItems) {
    const tier = String(item.relevance_tier ?? "NULL");
    tierBuckets[tier] = (tierBuckets[tier] || 0) + 1;
  }
  for (const [tier, count] of Object.entries(tierBuckets).sort()) {
    console.log(`  tier ${tier}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 6: Audience fit distribution ===");
  const audienceBuckets: Record<string, number> = {};
  for (const item of allItems) {
    const fit = item.audience_fit || "NULL";
    audienceBuckets[fit] = (audienceBuckets[fit] || 0) + 1;
  }
  for (const [fit, count] of Object.entries(audienceBuckets).sort()) {
    console.log(`  ${fit}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 7: is_event_venue distribution ===");
  const venueBuckets: Record<string, number> = {};
  for (const item of allItems) {
    const v = String(item.is_event_venue ?? "NULL");
    venueBuckets[v] = (venueBuckets[v] || 0) + 1;
  }
  for (const [v, count] of Object.entries(venueBuckets)) {
    console.log(`  is_event_venue=${v}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 8: enrichment_version distribution ===");
  const verBuckets: Record<string, number> = {};
  for (const item of allItems) {
    const v = String(item.enrichment_version ?? "NULL");
    verBuckets[v] = (verBuckets[v] || 0) + 1;
  }
  for (const [v, count] of Object.entries(verBuckets)) {
    console.log(`  enrichment_version=${v}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 9: Review status distribution ===");
  const reviewBuckets: Record<string, number> = {};
  for (const item of allItems) {
    const status = item.review_status || "NULL";
    reviewBuckets[status] = (reviewBuckets[status] || 0) + 1;
  }
  for (const [status, count] of Object.entries(reviewBuckets)) {
    console.log(`  review_status=${status}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 10: Category distribution ===");
  const catBuckets: Record<string, number> = {};
  for (const item of allItems) {
    const cat = item.category || "NULL";
    catBuckets[cat] = (catBuckets[cat] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(catBuckets).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 11: Kind distribution ===");
  const kindBuckets: Record<string, number> = {};
  for (const item of allItems) {
    const kind = item.kind || "NULL";
    kindBuckets[kind] = (kindBuckets[kind] || 0) + 1;
  }
  for (const [kind, count] of Object.entries(kindBuckets)) {
    console.log(`  ${kind}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  console.log("\n=== QUERY 12: Card-eligible items (tier >= 2, tags >= 3) ===");
  const cardEligible = allItems.filter(i =>
    (i.relevance_tier ?? 2) >= 2 &&
    (i.tags?.length ?? 0) >= 3
  );
  console.log(`  Card-eligible: ${cardEligible.length} of ${total} (${((cardEligible.length / total) * 100).toFixed(1)}%)`);

  console.log("\n=== QUERY 13: Enrichment queue health ===");
  const { data: queueData } = await supabase
    .from("enrichment_queue")
    .select("status, attempts")
    .limit(2000);

  if (queueData && queueData.length > 0) {
    const queueBuckets: Record<string, { count: number; totalAttempts: number }> = {};
    for (const job of queueData) {
      const status = job.status || "unknown";
      if (!queueBuckets[status]) queueBuckets[status] = { count: 0, totalAttempts: 0 };
      queueBuckets[status].count++;
      queueBuckets[status].totalAttempts += job.attempts || 0;
    }
    for (const [status, data] of Object.entries(queueBuckets)) {
      console.log(`  ${status}: ${data.count} items, avg attempts: ${(data.totalAttempts / data.count).toFixed(1)}`);
    }
  } else {
    console.log("  No enrichment queue data available (may be RLS restricted)");
  }

  // Clean up: Group formation simulation
  console.log("\n=== QUERY 14: Tag frequency (top 20 tags across feed items) ===");
  const tagFreq: Record<string, number> = {};
  for (const item of allItems) {
    if (item.tags) {
      for (const tag of item.tags) {
        tagFreq[tag] = (tagFreq[tag] || 0) + 1;
      }
    }
  }
  const sortedTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [tag, count] of sortedTags) {
    console.log(`  ${tag}: ${count} items`);
  }

  console.log("\n=== QUERY 15: Items with NULL confidence that would bypass quality gate ===");
  const nullConfInFeed = allItems.filter(i => i.normalized_confidence === null);
  console.log(`  Items with NULL confidence in feed: ${nullConfInFeed.length} (${((nullConfInFeed.length / total) * 100).toFixed(1)}%)`);
  const nullConfUnenriched = nullConfInFeed.filter(i => !i.llm_enriched_at);
  console.log(`  Of those, unenriched: ${nullConfUnenriched.length}`);

  console.log("\n=== DONE ===");
}

main().catch(console.error);

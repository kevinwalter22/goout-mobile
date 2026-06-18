/**
 * normalize-raw-events worker — end-to-end ingest of one raw web-collector
 * candidate into a normalized explore_items row.
 *
 * Flow exercised: insert event_ingest_raw (a trigger auto-enqueues a
 * normalization job) → invoke the worker → assert the adapter + normalizeFields
 * produced a correct explore_items row (category inferred, town extracted,
 * relevance tier set).
 *
 * ISOLATION CAVEAT: claim_normalization_job pulls the oldest QUEUED job
 * globally, not by namespace. This is safe on staging because the ingest crons
 * are inert there (app_config has no url/key rows, so nothing else enqueues).
 * We invoke with a small max_items and assert on our specific external_id, and
 * the worker is idempotent. Do not run this against a busy queue.
 */
import { adminClient } from "./_helpers/client";
import { assertStagingEnv } from "./_helpers/env";
import { newNamespace } from "./_helpers/namespace";
import { cleanupNamespace, trackItem } from "./_helpers/seed";

const admin = adminClient();
const ns = newNamespace("normalize");
const { url, serviceRoleKey } = assertStagingEnv();

const sourceUrl = `https://euda-test.invalid/${ns}/trivia`;
const externalId = `web:euda-test.invalid/${ns}/trivia`;

let sourceId: string;
let rawId: string;

beforeAll(async () => {
  const { data: src, error: srcErr } = await admin
    .from("event_sources")
    .insert({ name: `[euda-it] ${ns}`, type: "web_collector", is_enabled: true } as any)
    .select("id")
    .single();
  if (srcErr) throw srcErr;
  sourceId = src!.id;

  const candidate = {
    title: `[euda-it] ${ns} Trivia Night`,
    source_url: sourceUrl,
    starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    description_snippet: "Weekly trivia night — bring a team",
    location_name: "Test Tavern",
    address: "1 Main St, Warwick, NY 10990",
    evidence: [],
    extraction_strategy: "jsonld",
    confidence: 75,
    validation_errors: [],
    is_valid: true,
    _target_town: "Warwick",
  };

  const { data: raw, error: rawErr } = await admin
    .from("event_ingest_raw")
    .insert({
      source_id: sourceId,
      external_id: externalId,
      fetched_at: new Date().toISOString(),
      raw_json: candidate,
      raw_hash: `hash_${ns}`,
      status: "new",
    } as any)
    .select("id")
    .single();
  if (rawErr) throw rawErr;
  rawId = raw!.id;
});

afterAll(async () => {
  // Explicit teardown of pipeline rows (not covered by cleanupNamespace).
  await admin.from("explore_items").delete().eq("external_id", externalId);
  await admin.from("event_normalization_jobs").delete().eq("raw_id", rawId);
  await admin.from("event_ingest_raw").delete().eq("id", rawId);
  await admin.from("event_sources").delete().eq("id", sourceId);
  await cleanupNamespace(admin, ns);
});

describe("normalize-raw-events worker", () => {
  it("auto-enqueues a normalization job when raw is inserted", async () => {
    const { count } = await admin
      .from("event_normalization_jobs")
      .select("id", { count: "exact", head: true })
      .eq("raw_id", rawId);
    expect(count).toBe(1);
  });

  it("normalizes the raw candidate into an explore_items row", async () => {
    const res = await fetch(`${url}/functions/v1/normalize-raw-events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_items: 5, batch_size: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const { data: item, error } = await admin
      .from("explore_items")
      .select("id, title, category, kind, town, source_id, relevance_tier")
      .eq("external_id", externalId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(item).not.toBeNull();
    if (item) trackItem(ns, item.id);

    // "trivia" → adapter category 'recreation', which normalizeFields
    // canonicalizes to the DB category "Sports & Recreation"; web event with a
    // starts_at → kind 'event'; town extracted from the address.
    expect(item!.category).toBe("Sports & Recreation");
    expect(item!.kind).toBe("event");
    expect(item!.town).toBe("Warwick");
    expect(item!.source_id).toBe(sourceId);
    expect(item!.relevance_tier).toBeGreaterThanOrEqual(1);
  });

  it("marks the raw row normalized after processing", async () => {
    const { data } = await admin
      .from("event_ingest_raw")
      .select("status")
      .eq("id", rawId)
      .single();
    expect(data?.status).toBe("normalized");
  });
});

/**
 * normalize-raw-events worker — end-to-end ingest of one raw web-collector
 * candidate into a normalized explore_items row.
 *
 * Flow exercised: insert event_ingest_raw (a trigger auto-enqueues a
 * normalization job) → invoke the worker → assert the adapter + normalizeFields
 * produced a correct explore_items row (category inferred, town extracted,
 * relevance tier set).
 *
 * ISOLATION: claim_normalization_job pulls the oldest QUEUED job globally, not
 * by namespace. Staging is NO LONGER inert (API ingestion was restored; crawls
 * run against staging), so a backlog of older queued jobs can starve this row.
 * beforeAll back-dates this test's job to the front of the queue so it is claimed
 * first regardless of backlog depth, and the assertions poll on end-state (this
 * invocation OR the staging normalize cron may do the work). The worker is
 * idempotent. See the ISOLATION HARDENING note in beforeAll.
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

  // ISOLATION HARDENING: staging is no longer guaranteed inert — API ingestion
  // was restored and crawls run against staging, so a backlog of older queued
  // jobs (e.g. hundreds of Google Places rows) can starve this row within the
  // worker's small max_items window (the original ISOLATION CAVEAT above no
  // longer holds). claim_normalization_job takes the OLDEST queued job
  // (ORDER BY created_at ASC), so back-date THIS job to the front of the queue.
  // Then whichever worker runs next — this test's own invocation OR staging's
  // normalize cron — claims it first; the assertions below check end-state, not
  // who did the work, so either path passes.
  const { error: bumpErr } = await admin
    .from("event_normalization_jobs")
    .update({ created_at: "1970-01-01T00:00:00Z" } as any)
    .eq("raw_id", rawId);
  if (bumpErr) throw bumpErr;
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

    // Poll briefly: the back-dated job is claimed first, but it may be processed
    // by THIS invocation or by staging's own normalize cron (which could have
    // grabbed it a moment earlier). Assert on end-state, tolerating that timing.
    let item: any = null;
    for (let i = 0; i < 10 && !item; i++) {
      const { data, error } = await admin
        .from("explore_items")
        .select("id, title, category, kind, town, source_id, relevance_tier")
        .eq("external_id", externalId)
        .maybeSingle();
      expect(error).toBeNull();
      if (data) { item = data; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
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
    // Runs after the normalize test above (which already polled until the row
    // surfaced), so the raw status has flipped; a short poll absorbs any residual
    // ordering between the explore_items upsert and the raw-status update.
    let status: string | undefined;
    for (let i = 0; i < 6; i++) {
      const { data } = await admin
        .from("event_ingest_raw")
        .select("status")
        .eq("id", rawId)
        .single();
      status = data?.status;
      if (status === "normalized") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(status).toBe("normalized");
  });
});

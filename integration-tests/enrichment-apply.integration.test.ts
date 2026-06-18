/**
 * apply_enrichment RPC — the write-back path the enrichment queue uses to merge
 * LLM output onto an explore_item (migration 098). The contract that matters:
 *   - NULL params are no-ops (COALESCE) — never clobber an existing value
 *   - description is only written when it is currently NULL (never overwritten)
 *   - price_bucket / audience_fit treat 'unknown' as a no-op
 *   - a real value updates the field; llm_enriched_at is stamped
 *
 * Getting this wrong silently corrupts good data, so it is asserted end-to-end
 * against staging.
 */
import { adminClient } from "./_helpers/client";
import { newNamespace } from "./_helpers/namespace";
import { insertExploreItem, cleanupNamespace } from "./_helpers/seed";

const admin = adminClient();
const ns = newNamespace("enrich");

// apply_enrichment has several historical overloads (6/8/10/14-arg). A partial
// named-arg call is ambiguous and PostgREST refuses it ("could not choose the
// best candidate"). The real caller (run-enrichment-queue) always sends the
// full arg list, so we do too — this uniquely resolves to the migration-098
// 14-arg function.
async function applyEnrichment(
  id: string,
  over: Record<string, unknown> = {},
): Promise<void> {
  const params = {
    p_explore_item_id: id,
    p_hook_line: null,
    p_tags: null,
    p_recurrence: null,
    p_starts_at: null,
    p_ends_at: null,
    p_availability_json: null,
    p_price_bucket: null,
    p_description: null,
    p_time_text: null,
    p_provenance: null,
    p_audience_fit: null,
    p_is_event_venue: null,
    p_enrichment_version: null,
    ...over,
  };
  const { error } = await admin.rpc("apply_enrichment", params as any);
  if (error) throw new Error(`apply_enrichment failed: ${error.message}`);
}

async function getItem(id: string) {
  const { data, error } = await admin
    .from("explore_items")
    .select("hook_line, tags, description, is_event_venue, price_bucket, audience_fit, enrichment_version, llm_enriched_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as any;
}

afterAll(async () => {
  await cleanupNamespace(admin, ns);
});

describe("apply_enrichment", () => {
  it("writes provided fields and stamps llm_enriched_at", async () => {
    const { id } = await insertExploreItem(admin, ns, { price_bucket: "unknown" });
    await applyEnrichment(id, {
      p_hook_line: "Live jazz every Friday",
      p_tags: ["music", "live_music"],
      p_description: "A cozy spot.",
      p_is_event_venue: true,
      p_audience_fit: "youth_general",
      p_enrichment_version: 1,
    });

    const item = await getItem(id);
    expect(item.hook_line).toBe("Live jazz every Friday");
    expect(item.tags).toEqual(["music", "live_music"]);
    expect(item.description).toBe("A cozy spot.");
    expect(item.is_event_venue).toBe(true);
    expect(item.audience_fit).toBe("youth_general");
    expect(item.enrichment_version).toBe(1);
    expect(item.llm_enriched_at).toBeTruthy();
  });

  it("treats NULL params as no-ops (never clobbers existing values)", async () => {
    const { id } = await insertExploreItem(admin, ns);
    await applyEnrichment(id, { p_hook_line: "Original hook", p_tags: ["a", "b"] });

    await applyEnrichment(id, { p_is_event_venue: true }); // everything else null → no-op

    const item = await getItem(id);
    expect(item.hook_line).toBe("Original hook");
    expect(item.tags).toEqual(["a", "b"]);
    expect(item.is_event_venue).toBe(true);
  });

  it("does not overwrite a description that is already set", async () => {
    const { id } = await insertExploreItem(admin, ns);
    await applyEnrichment(id, { p_description: "First description" });
    await applyEnrichment(id, { p_description: "Second description (should be ignored)" });

    const item = await getItem(id);
    expect(item.description).toBe("First description");
  });

  it("treats 'unknown' price_bucket / audience_fit as a no-op but applies real values", async () => {
    const { id } = await insertExploreItem(admin, ns, { price_bucket: "unknown" });

    // 'unknown' is a no-op → stays 'unknown'
    await applyEnrichment(id, { p_price_bucket: "unknown", p_audience_fit: "unknown" });
    let item = await getItem(id);
    expect(item.price_bucket).toBe("unknown");

    // a real value applies
    await applyEnrichment(id, { p_price_bucket: "$$" });
    item = await getItem(id);
    expect(item.price_bucket).toBe("$$");

    // 'unknown' again does not revert it
    await applyEnrichment(id, { p_price_bucket: "unknown" });
    item = await getItem(id);
    expect(item.price_bucket).toBe("$$");
  });
});

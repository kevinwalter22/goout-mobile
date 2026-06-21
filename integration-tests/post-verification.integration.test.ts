/**
 * Post creation — geo+time verification invariant (migration 137) and the
 * engagement_log fire-off.
 *
 * This is the app's "proof you were there" guarantee and it is DB-enforced
 * (137 is sacred). The two triggers under test:
 *   - enforce_post_verification (BEFORE INSERT): a post linked to an
 *     explore_item MUST carry verified_at_event = TRUE + verified_lat/lng/at.
 *   - log_post_at_event (AFTER INSERT): a verified explore_item post produces
 *     exactly one engagement_log 'post_at_event' row carrying the verified
 *     coords; unverified / standalone posts produce none.
 *
 * Posts are inserted with the service-role client: RLS is bypassed but the
 * triggers still fire — which is precisely what we're validating.
 */
import { adminClient } from "./_helpers/client";
import { newNamespace } from "./_helpers/namespace";
import { createTestUser, insertExploreItem, cleanupNamespace } from "./_helpers/seed";

const admin = adminClient();
const ns = newNamespace("post137");

let userId: string;
let itemId: string;

beforeAll(async () => {
  userId = (await createTestUser(admin, ns)).id;
  itemId = (await insertExploreItem(admin, ns, { title: "verification target" })).id;
});

afterAll(async () => {
  await cleanupNamespace(admin, ns);
});

function basePost(overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    photo_path: "test/photo.jpg",
    camera_mode: "back",
    ...overrides,
  };
}

describe("enforce_post_verification (BEFORE INSERT)", () => {
  it("rejects an explore_item-linked post with no verification fields", async () => {
    const { data, error } = await admin
      .from("posts")
      .insert(basePost({ explore_item_id: itemId }) as any)
      .select("id")
      .single();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/invariant violation/i);
  });

  it("rejects a post that claims verified_at_event but omits the coords", async () => {
    const { error } = await admin
      .from("posts")
      .insert(
        basePost({
          explore_item_id: itemId,
          verified_at_event: true,
          // verified_lat / verified_lng / verified_at intentionally missing
        }) as any,
      )
      .select("id")
      .single();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/verified_lat|verified_lng|verified_at|invariant/i);
  });

  it("accepts a fully-verified explore_item post", async () => {
    const { data, error } = await admin
      .from("posts")
      .insert(
        basePost({
          explore_item_id: itemId,
          verified_lat: 41.2557,
          verified_lng: -74.3601,
          verified_at: new Date().toISOString(),
          verified_at_event: true,
        }) as any,
      )
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("accepts a standalone post (no explore_item_id) with no verification", async () => {
    const { data, error } = await admin
      .from("posts")
      .insert(basePost() as any)
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });
});

describe("log_post_at_event (AFTER INSERT) — engagement_log fire-off", () => {
  it("writes one post_at_event row carrying the verified coords for a verified post", async () => {
    const verifiedAt = new Date().toISOString();
    const { data: post, error } = await admin
      .from("posts")
      .insert(
        basePost({
          explore_item_id: itemId,
          verified_lat: 41.25,
          verified_lng: -74.36,
          verified_at: verifiedAt,
          verified_at_event: true,
        }) as any,
      )
      .select("id")
      .single();
    expect(error).toBeNull();

    const { data: rows } = await admin
      .from("engagement_log")
      .select("event_type, user_id, explore_item_id, user_location, post_id")
      .eq("post_id", post!.id);

    expect(rows).toHaveLength(1);
    const row = rows![0] as any;
    expect(row.event_type).toBe("post_at_event");
    expect(row.user_id).toBe(userId);
    expect(row.explore_item_id).toBe(itemId);
    expect(Number(row.user_location.lat)).toBeCloseTo(41.25, 5);
    expect(Number(row.user_location.lng)).toBeCloseTo(-74.36, 5);
  });

  it("writes NO engagement_log row for a standalone post", async () => {
    const { data: post, error } = await admin
      .from("posts")
      .insert(basePost() as any)
      .select("id")
      .single();
    expect(error).toBeNull();

    const { count } = await admin
      .from("engagement_log")
      .select("id", { count: "exact", head: true })
      .eq("post_id", post!.id);
    expect(count).toBe(0);
  });
});

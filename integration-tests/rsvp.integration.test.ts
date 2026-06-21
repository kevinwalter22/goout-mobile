/**
 * RSVP + un-RSVP flow on explore_item_rsvps, under RLS.
 *
 * Note on "save/unsave": the app has no separate saves table — save/unsave exist
 * only as engagement event types (telemetry). The persistent "I'm going / I'm
 * not going" action is the RSVP, so that is the round-trip validated here,
 * including the RLS guarantees the client relies on:
 *   - a user can create and delete their OWN rsvp
 *   - the UNIQUE(user_id, explore_item_id) constraint makes RSVP idempotent
 *   - a user CANNOT create an rsvp on another user's behalf (WITH CHECK)
 *   - any authenticated user can read rsvps (going counts)
 */
import { adminClient, authedClient } from "./_helpers/client";
import { newNamespace } from "./_helpers/namespace";
import { createTestUser, insertExploreItem, cleanupNamespace } from "./_helpers/seed";
import type { SupabaseClient } from "@supabase/supabase-js";

const admin = adminClient();
const ns = newNamespace("rsvp");

let userA: { id: string; email: string; password: string };
let userB: { id: string; email: string; password: string };
let itemId: string;
let clientA: SupabaseClient;

beforeAll(async () => {
  userA = await createTestUser(admin, ns, "a");
  userB = await createTestUser(admin, ns, "b");
  itemId = (await insertExploreItem(admin, ns, { kind: "event" })).id;
  clientA = (await authedClient(userA.email, userA.password)).client;
});

afterAll(async () => {
  await cleanupNamespace(admin, ns);
});

describe("RSVP round-trip", () => {
  it("a user can RSVP to an item", async () => {
    const { error } = await clientA
      .from("explore_item_rsvps")
      .insert({ user_id: userA.id, explore_item_id: itemId } as any);
    expect(error).toBeNull();

    const { count } = await admin
      .from("explore_item_rsvps")
      .select("id", { count: "exact", head: true })
      .eq("explore_item_id", itemId);
    expect(count).toBe(1);
  });

  it("a duplicate RSVP is rejected by the unique constraint", async () => {
    const { error } = await clientA
      .from("explore_item_rsvps")
      .insert({ user_id: userA.id, explore_item_id: itemId } as any);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505"); // unique_violation
  });

  it("a user can un-RSVP (delete) their own RSVP", async () => {
    const { error } = await clientA
      .from("explore_item_rsvps")
      .delete()
      .eq("user_id", userA.id)
      .eq("explore_item_id", itemId);
    expect(error).toBeNull();

    const { count } = await admin
      .from("explore_item_rsvps")
      .select("id", { count: "exact", head: true })
      .eq("explore_item_id", itemId);
    expect(count).toBe(0);
  });
});

describe("RSVP RLS", () => {
  it("a user cannot create an RSVP on another user's behalf", async () => {
    const { data, error } = await clientA
      .from("explore_item_rsvps")
      .insert({ user_id: userB.id, explore_item_id: itemId } as any)
      .select("id");
    // RLS WITH CHECK (auth.uid() = user_id) blocks the insert.
    expect(error).not.toBeNull();
    expect(data).toBeNull();

    const { count } = await admin
      .from("explore_item_rsvps")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userB.id);
    expect(count).toBe(0);
  });

  it("an authenticated user can read RSVPs (going count visibility)", async () => {
    await clientA
      .from("explore_item_rsvps")
      .insert({ user_id: userA.id, explore_item_id: itemId } as any);

    const { client: clientB } = await authedClient(userB.email, userB.password);
    const { data, error } = await clientB
      .from("explore_item_rsvps")
      .select("id")
      .eq("explore_item_id", itemId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });
});

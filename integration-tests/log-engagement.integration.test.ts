/**
 * log-engagement edge function — server-side validation of the engagement
 * batch endpoint. The client buffer (covered by the unit suite) decides what to
 * send; this endpoint is the authority on what is allowed IN.
 *
 * Contract (see supabase/functions/log-engagement/index.ts):
 *   - requires a valid user JWT
 *   - user_id on every event must match the caller
 *   - event_type must be in the allowlist (post_at_event is trigger-only)
 *   - occurred_at within the last 24h and not >60s in the future
 *   - empty batch / batch > 200 rejected
 *   - valid events insert under the caller's RLS; bad ones are reported in
 *     `rejected` without poisoning the batch
 *
 * Raw fetch (not supabase.functions.invoke) so we can assert HTTP status codes.
 */
import { adminClient, authedClient } from "./_helpers/client";
import { assertStagingEnv } from "./_helpers/env";
import { newNamespace } from "./_helpers/namespace";
import { createTestUser, insertExploreItem, cleanupNamespace } from "./_helpers/seed";

const admin = adminClient();
const ns = newNamespace("logeng");
const { url, anonKey } = assertStagingEnv();

let userId: string;
let itemId: string;
let token: string;

beforeAll(async () => {
  const user = await createTestUser(admin, ns);
  userId = user.id;
  itemId = (await insertExploreItem(admin, ns)).id;
  token = (await authedClient(user.email, user.password)).accessToken;
});

afterAll(async () => {
  await cleanupNamespace(admin, ns);
});

async function callLogEngagement(events: unknown[]): Promise<{ status: number; body: any }> {
  const res = await fetch(`${url}/functions/v1/log-engagement`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ events }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function ev(over: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    explore_item_id: itemId,
    event_type: "tap",
    occurred_at: new Date().toISOString(),
    session_id: "00000000-0000-4000-8000-0000000000aa",
    feed_context: "explore_list",
    ...over,
  };
}

describe("log-engagement — happy path", () => {
  it("inserts a valid batch and persists the rows", async () => {
    const { status, body } = await callLogEngagement([ev(), ev({ event_type: "save" })]);
    expect(status).toBe(200);
    expect(body.inserted).toBe(2);

    const { count } = await admin
      .from("engagement_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe("log-engagement — validation", () => {
  it("rejects an empty batch with 400", async () => {
    const { status, body } = await callLogEngagement([]);
    expect(status).toBe(400);
    expect(body.error).toBe("empty_batch");
  });

  it("rejects a user_id that does not match the caller", async () => {
    const { status, body } = await callLogEngagement([
      ev({ user_id: "00000000-0000-4000-8000-0000000000ff" }),
    ]);
    expect(status).toBe(400);
    expect(body.rejected?.[0]?.reason).toBe("user_id_mismatch");
  });

  it("rejects the trigger-only post_at_event type", async () => {
    const { status, body } = await callLogEngagement([ev({ event_type: "post_at_event" })]);
    expect(status).toBe(400);
    expect(body.rejected?.[0]?.reason).toBe("invalid_event_type");
  });

  it("rejects a stale (>24h) timestamp", async () => {
    const { status, body } = await callLogEngagement([
      ev({ occurred_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }),
    ]);
    expect(status).toBe(400);
    expect(body.rejected?.[0]?.reason).toBe("stale_or_future_timestamp");
  });

  it("inserts valid events and reports invalid ones in the same batch", async () => {
    const { status, body } = await callLogEngagement([
      ev(), // valid
      ev({ event_type: "not_a_real_type" }), // invalid
    ]);
    expect(status).toBe(200);
    expect(body.inserted).toBe(1);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].reason).toBe("invalid_event_type");
  });

  it("requires authentication (401 without a JWT)", async () => {
    const res = await fetch(`${url}/functions/v1/log-engagement`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ events: [ev()] }),
    });
    expect(res.status).toBe(401);
  });
});

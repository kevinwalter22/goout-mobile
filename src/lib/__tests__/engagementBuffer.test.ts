/**
 * engagementBuffer coverage — the client-side sampling + dedup + flush logic
 * that decides which engagement events ever reach the server. Getting this wrong
 * silently skews the data the Phase 1 ranker trains on, so the contract is:
 *   - conversion + intermediate events: always logged (100%)
 *   - impressions: 100% on cold start / for previously-engaged items, else 25%
 *   - same (item, impression) within 5 min: dropped
 *   - flush at 50 events, on a 15s timer, or explicitly; failures persist
 *
 * Supabase, AsyncStorage and the session counter are mocked so the logic runs in
 * the unit suite with no network.
 */

const mockInvoke = jest.fn();
const mockGetSessionCount = jest.fn();
const mockStore = new Map<string, string>();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
jest.mock("../sessionId", () => ({
  getSessionCount: () => mockGetSessionCount(),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (k: string) => Promise.resolve(mockStore.get(k) ?? null),
    setItem: (k: string, v: string) => {
      mockStore.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      mockStore.delete(k);
      return Promise.resolve();
    },
  },
}));

import {
  logEngagement,
  flushEngagement,
  replayPersistedEvents,
  _resetForTests,
  type EngagementEvent,
  type EngagementEventType,
} from "../engagementBuffer";

const PERSIST_KEY = "@euda_engagement_buffer_v1";

function ev(
  type: EngagementEventType,
  itemId: string | null = "item-1",
  over: Partial<EngagementEvent> = {},
): EngagementEvent {
  return {
    user_id: "u1",
    explore_item_id: itemId,
    event_type: type,
    occurred_at: new Date().toISOString(),
    session_id: "s1",
    feed_context: "explore_list",
    ...over,
  };
}

/** Force a flush and return every event that was sent to the edge function. */
async function flushedEvents(): Promise<EngagementEvent[]> {
  await flushEngagement();
  return mockInvoke.mock.calls.flatMap(
    (c) => (c[1] as any)?.body?.events ?? [],
  );
}

beforeEach(() => {
  _resetForTests();
  mockStore.clear();
  mockInvoke.mockReset().mockResolvedValue({ error: null });
  mockGetSessionCount.mockReset().mockResolvedValue(100); // past cold start
  jest.spyOn(Math, "random").mockReturnValue(0); // < 0.25 → sampled in by default
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("sampling", () => {
  it("always logs conversion events (rsvp/save/share)", async () => {
    mockGetSessionCount.mockResolvedValue(999);
    jest.spyOn(Math, "random").mockReturnValue(0.99); // would drop an impression
    await logEngagement(ev("rsvp"));
    await logEngagement(ev("save", "item-2"));
    await logEngagement(ev("share", "item-3"));
    const sent = await flushedEvents();
    expect(sent.map((e) => e.event_type).sort()).toEqual(["rsvp", "save", "share"]);
  });

  it("logs impressions at 100% during cold start (session <= 10)", async () => {
    mockGetSessionCount.mockResolvedValue(3);
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    await logEngagement(ev("impression"));
    expect((await flushedEvents()).length).toBe(1);
  });

  it("drops a sampled-out impression past cold start (random >= 0.25)", async () => {
    mockGetSessionCount.mockResolvedValue(50);
    jest.spyOn(Math, "random").mockReturnValue(0.9);
    await logEngagement(ev("impression"));
    expect((await flushedEvents()).length).toBe(0);
  });

  it("keeps a sampled-in impression past cold start (random < 0.25)", async () => {
    mockGetSessionCount.mockResolvedValue(50);
    jest.spyOn(Math, "random").mockReturnValue(0.1);
    await logEngagement(ev("impression"));
    expect((await flushedEvents()).length).toBe(1);
  });

  it("logs impressions at 100% for a previously-engaged item", async () => {
    mockGetSessionCount.mockResolvedValue(50);
    jest.spyOn(Math, "random").mockReturnValue(0.99); // would otherwise drop
    await logEngagement(ev("tap", "item-7")); // marks item-7 as engaged
    await logEngagement(ev("impression", "item-7"));
    const sent = await flushedEvents();
    expect(sent.filter((e) => e.event_type === "impression").length).toBe(1);
  });
});

describe("dedup window", () => {
  it("drops a second impression for the same item within 5 minutes", async () => {
    mockGetSessionCount.mockResolvedValue(3); // cold start → sampling passes
    await logEngagement(ev("impression", "dup"));
    await logEngagement(ev("impression", "dup"));
    expect((await flushedEvents()).length).toBe(1);
  });

  it("allows the same impression again after the 5-minute window", async () => {
    mockGetSessionCount.mockResolvedValue(3);
    const base = 1_000_000;
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(base);
    await logEngagement(ev("impression", "dup"));
    nowSpy.mockReturnValue(base + 6 * 60 * 1000); // 6 min later
    await logEngagement(ev("impression", "dup"));
    expect((await flushedEvents()).length).toBe(2);
  });

  it("does not dedup conversion events", async () => {
    await logEngagement(ev("save", "x"));
    await logEngagement(ev("save", "x"));
    expect((await flushedEvents()).length).toBe(2);
  });
});

describe("flush triggers", () => {
  it("flushes automatically once 50 events are buffered", async () => {
    mockGetSessionCount.mockResolvedValue(3);
    for (let i = 0; i < 50; i++) {
      await logEngagement(ev("tap", `item-${i}`));
    }
    // Auto-flush already fired at the 50th event.
    expect(mockInvoke).toHaveBeenCalled();
    const sent = mockInvoke.mock.calls.flatMap((c) => (c[1] as any).body.events);
    expect(sent.length).toBe(50);
  });

  it("explicit flush sends nothing when the buffer is empty", async () => {
    await flushEngagement();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("failure persistence + replay", () => {
  it("persists the batch to AsyncStorage when the flush fails", async () => {
    mockGetSessionCount.mockResolvedValue(3);
    mockInvoke.mockResolvedValue({ error: { message: "boom" } });
    await logEngagement(ev("tap", "p1"));
    await flushEngagement();
    const persisted = JSON.parse(mockStore.get(PERSIST_KEY) ?? "[]");
    expect(persisted).toHaveLength(1);
    expect(persisted[0].explore_item_id).toBe("p1");
  });

  it("replays fresh persisted events and clears the store", async () => {
    const fresh = ev("tap", "fresh", { occurred_at: new Date().toISOString() });
    mockStore.set(PERSIST_KEY, JSON.stringify([fresh]));
    mockInvoke.mockResolvedValue({ error: null });
    await replayPersistedEvents();
    expect(mockInvoke).toHaveBeenCalled();
    const sent = mockInvoke.mock.calls.flatMap((c) => (c[1] as any).body.events);
    expect(sent.map((e: EngagementEvent) => e.explore_item_id)).toContain("fresh");
    expect(mockStore.get(PERSIST_KEY)).toBeUndefined();
  });

  it("drops persisted events older than 24h on replay", async () => {
    const stale = ev("tap", "stale", {
      occurred_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    mockStore.set(PERSIST_KEY, JSON.stringify([stale]));
    await replayPersistedEvents();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockStore.get(PERSIST_KEY)).toBeUndefined();
  });
});

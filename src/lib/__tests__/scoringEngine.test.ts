/**
 * scoreItem / scoreAndRankItems coverage — the end-to-end ranker, with special
 * attention to the CHAIN PENALTY (the 0.5x post-weight multiplier from
 * migration 130 and its two escape hatches: active search and a friend signal).
 *
 * Complements scoring.test.ts (which covers the community-feedback and freshness
 * signal functions in isolation). Here we exercise the full weighted sum and the
 * gating/penalty logic that sits on top of it.
 */
import { scoreItem, scoreAndRankItems, createDefaultContext, type ScoringContext } from "../scoring";
import { RECOMMENDER_CONFIG } from "../../config/recommenderConfig";
import type { ExploreItem } from "../../types/database";

function makeItem(id: string, overrides?: Partial<ExploreItem> & Record<string, unknown>): ExploreItem {
  return {
    id,
    title: "Test Item",
    kind: "event",
    description: null,
    hook_line: null,
    category: "Community",
    sub_category: null,
    tags: [],
    price_bucket: null,
    starts_at: null,
    ends_at: null,
    lat: null,
    lng: null,
    location_name: null,
    address: null,
    town: null,
    image_url: null,
    image_thumb_url: null,
    image_source: null,
    source_url: null,
    is_anchor: false,
    priority: 50,
    schedule_text: null,
    availability_json: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as any;
}

function ctx(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return createDefaultContext(overrides);
}

describe("scoreItem — structure & invariants", () => {
  it("returns the original item plus recommendScore + scoreBreakdown", () => {
    const item = makeItem("a");
    const scored = scoreItem(item, ctx());
    expect(scored.id).toBe("a");
    expect(typeof scored.recommendScore).toBe("number");
    expect(scored.recommendScore).toBe(scored.scoreBreakdown.total);
  });

  it("recommendScore stays within [0, 1] for typical inputs", () => {
    const item = makeItem("a", {
      lat: 41.25,
      lng: -74.36,
      starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      tags: ["music"],
    } as any);
    const scored = scoreItem(item, ctx({ userLocation: { lat: 41.25, lng: -74.36 } }));
    expect(scored.recommendScore).toBeGreaterThanOrEqual(0);
    expect(scored.recommendScore).toBeLessThanOrEqual(1);
  });

  it("total equals the weighted sum of the breakdown signals (no chain penalty)", () => {
    const item = makeItem("a", { lat: 41.25, lng: -74.36 } as any);
    const c = ctx({ userLocation: { lat: 41.25, lng: -74.36 } });
    const b = scoreItem(item, c).scoreBreakdown;
    const { WEIGHTS } = RECOMMENDER_CONFIG;
    const expected =
      b.timeMatch * WEIGHTS.TIME_MATCH +
      b.distance * WEIGHTS.DISTANCE +
      b.openNow * WEIGHTS.OPEN_NOW +
      b.friendsGoing * WEIGHTS.FRIENDS_GOING +
      b.tagAffinity * WEIGHTS.TAG_AFFINITY +
      b.weather * WEIGHTS.WEATHER +
      b.contextIntent * WEIGHTS.CONTEXT_INTENT +
      b.typeAffinity * WEIGHTS.TYPE_AFFINITY +
      b.quality * WEIGHTS.QUALITY +
      b.communityFeedback * WEIGHTS.COMMUNITY_FEEDBACK +
      b.freshness * WEIGHTS.FRESHNESS +
      b.friendCreated * WEIGHTS.FRIEND_CREATED;
    expect(b.chainPenalty).toBe(1.0);
    expect(b.total).toBeCloseTo(expected, 10);
  });
});

describe("chain penalty", () => {
  function scoreTwice(itemOverrides: Record<string, unknown>, ctxOverrides: Partial<ScoringContext> = {}) {
    const base = makeItem("chain-1", { lat: 41.25, lng: -74.36, ...itemOverrides } as any);
    const plain = makeItem("plain-1", { lat: 41.25, lng: -74.36 } as any);
    const c = ctx({ userLocation: { lat: 41.25, lng: -74.36 }, ...ctxOverrides });
    return {
      chain: scoreItem(base, c).scoreBreakdown,
      plain: scoreItem(plain, c).scoreBreakdown,
    };
  }

  it("halves the total for a chain venue (chainPenalty = 0.5)", () => {
    const { chain } = scoreTwice({ is_chain: true });
    expect(chain.chainPenalty).toBe(0.5);
  });

  it("does not penalize a non-chain venue (chainPenalty = 1.0)", () => {
    const { plain } = scoreTwice({ is_chain: true });
    expect(plain.chainPenalty).toBe(1.0);
  });

  it("a chain scores exactly half of an otherwise-identical non-chain", () => {
    const chainItem = makeItem("x", { lat: 41.25, lng: -74.36, is_chain: true } as any);
    const sameButNotChain = makeItem("x", { lat: 41.25, lng: -74.36, is_chain: false } as any);
    const c = ctx({ userLocation: { lat: 41.25, lng: -74.36 } });
    const chainTotal = scoreItem(chainItem, c).recommendScore;
    const plainTotal = scoreItem(sameButNotChain, c).recommendScore;
    expect(chainTotal).toBeCloseTo(plainTotal * 0.5, 10);
  });

  it("active search bypasses the penalty (user asked for chains)", () => {
    const { chain } = scoreTwice({ is_chain: true }, { searchActive: true });
    expect(chain.chainPenalty).toBe(1.0);
  });

  it("a friend going to the chain bypasses the penalty", () => {
    const { chain } = scoreTwice(
      { is_chain: true },
      { friendsGoingMap: new Map([["chain-1", 1]]) },
    );
    expect(chain.chainPenalty).toBe(1.0);
  });

  it("is_chain_override = true penalizes even when is_chain is false", () => {
    const { chain } = scoreTwice({ is_chain: false, is_chain_override: true });
    expect(chain.chainPenalty).toBe(0.5);
  });

  it("is_chain_override = false rescues an is_chain = true venue (tri-state precedence)", () => {
    const { chain } = scoreTwice({ is_chain: true, is_chain_override: false });
    expect(chain.chainPenalty).toBe(1.0);
  });
});

describe("feature-flag gating", () => {
  it("zeroes a signal when its flag is off", () => {
    const FLAGS = RECOMMENDER_CONFIG.FLAGS;
    const item = makeItem("a", { tags: ["music"] } as any);
    const flagsOff = new Map<string, boolean>([[FLAGS.TAG_AFFINITY, false]]);
    const c = ctx({
      featureFlags: flagsOff,
      userTagAffinity: new Map([["music", 5]]),
    });
    expect(scoreItem(item, c).scoreBreakdown.tagAffinity).toBe(0);
  });
});

describe("context intent + type affinity only apply on the 'all' toggle", () => {
  it("context intent is neutral when kindFilter is not 'all'", () => {
    const item = makeItem("a", { kind: "event" } as any);
    const all = scoreItem(item, ctx({ kindFilter: "all" })).scoreBreakdown.contextIntent;
    const evt = scoreItem(item, ctx({ kindFilter: "event" })).scoreBreakdown.contextIntent;
    expect(evt).toBe(RECOMMENDER_CONFIG.CONTEXT_INTENT.NEUTRAL);
    // On "all" the score is whatever the time bucket dictates (>=0); the point is
    // the toggle changes behavior.
    expect(typeof all).toBe("number");
  });

  it("type affinity is neutral (0.5) when kindFilter is not 'all'", () => {
    const item = makeItem("a", { kind: "event" } as any);
    const c = ctx({
      kindFilter: "activity",
      userTypeAffinity: { eventBias: 0.9, activityBias: 0.1, totalInteractions: 100 },
    });
    expect(scoreItem(item, c).scoreBreakdown.typeAffinity).toBe(0.5);
  });
});

describe("scoreAndRankItems", () => {
  it("sorts by recommendScore descending", () => {
    const near = makeItem("near", { lat: 41.25, lng: -74.36 } as any);
    const far = makeItem("far", { lat: 40.0, lng: -73.0 } as any);
    const c = ctx({ userLocation: { lat: 41.25, lng: -74.36 } });
    const ranked = scoreAndRankItems([far, near], c);
    expect(ranked[0].id).toBe("near");
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].recommendScore).toBeGreaterThanOrEqual(ranked[i].recommendScore);
    }
  });

  it("ranks a chain below an identical non-chain", () => {
    const chain = makeItem("chain", { lat: 41.25, lng: -74.36, is_chain: true } as any);
    const indie = makeItem("indie", { lat: 41.25, lng: -74.36, is_chain: false } as any);
    const c = ctx({ userLocation: { lat: 41.25, lng: -74.36 } });
    const ranked = scoreAndRankItems([chain, indie], c);
    expect(ranked[0].id).toBe("indie");
  });
});

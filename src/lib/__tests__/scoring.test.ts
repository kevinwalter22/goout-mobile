import {
  computeCommunityFeedbackScore,
  computeFreshnessScore,
  createDefaultContext,
  type ScoringContext,
} from "../scoring";
import { RECOMMENDER_CONFIG } from "../../config/recommenderConfig";
import type { ExploreItem } from "../../types/database";

// ============================================================================
// Test Helpers
// ============================================================================

function makeItem(id: string, overrides?: Partial<ExploreItem>): ExploreItem {
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

function makeContext(feedbackMap?: Map<string, number>): ScoringContext {
  return {
    ...createDefaultContext(),
    communityFeedbackMap: feedbackMap ?? new Map(),
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ============================================================================
// Tests
// ============================================================================

describe("computeCommunityFeedbackScore", () => {
  it("returns 0.5 (neutral) when no feedback data exists", () => {
    const item = makeItem("item-1");
    const ctx = makeContext();
    expect(computeCommunityFeedbackScore(item, ctx)).toBe(0.5);
  });

  it("returns 0.5 when item has no entry in the map", () => {
    const item = makeItem("item-1");
    const ctx = makeContext(new Map([["other-item", 5]]));
    expect(computeCommunityFeedbackScore(item, ctx)).toBe(0.5);
  });

  it("returns > 0.5 for positive net_score", () => {
    const item = makeItem("item-1");
    const ctx = makeContext(new Map([["item-1", 5]]));
    const score = computeCommunityFeedbackScore(item, ctx);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("returns < 0.5 for negative net_score", () => {
    const item = makeItem("item-1");
    const ctx = makeContext(new Map([["item-1", -5]]));
    const score = computeCommunityFeedbackScore(item, ctx);
    expect(score).toBeLessThan(0.5);
    expect(score).toBeGreaterThanOrEqual(0.1);
  });

  it("clamps to SCORE_CEILING for extreme positive net_score", () => {
    const item = makeItem("item-1");
    const ctx = makeContext(new Map([["item-1", 100]]));
    const score = computeCommunityFeedbackScore(item, ctx);
    expect(score).toBe(RECOMMENDER_CONFIG.COMMUNITY_FEEDBACK.SCORE_CEILING);
  });

  it("clamps to SCORE_FLOOR for extreme negative net_score", () => {
    const item = makeItem("item-1");
    const ctx = makeContext(new Map([["item-1", -100]]));
    const score = computeCommunityFeedbackScore(item, ctx);
    expect(score).toBe(RECOMMENDER_CONFIG.COMMUNITY_FEEDBACK.SCORE_FLOOR);
  });

  it("returns exactly 0.5 for net_score of 0", () => {
    const item = makeItem("item-1");
    const ctx = makeContext(new Map([["item-1", 0]]));
    expect(computeCommunityFeedbackScore(item, ctx)).toBe(0.5);
  });

  it("returns 0.5 when communityFeedbackMap is undefined", () => {
    const item = makeItem("item-1");
    const ctx = makeContext();
    ctx.communityFeedbackMap = undefined;
    expect(computeCommunityFeedbackScore(item, ctx)).toBe(0.5);
  });
});

describe("computeFreshnessScore", () => {
  it("returns 1.0 for activity created today", () => {
    const item = makeItem("a1", { kind: "activity" as any, created_at: new Date().toISOString() });
    expect(computeFreshnessScore(item)).toBe(1.0);
  });

  it("returns 1.0 for activity created 2 days ago", () => {
    const item = makeItem("a2", { kind: "activity" as any, created_at: daysAgo(2) });
    expect(computeFreshnessScore(item)).toBe(1.0);
  });

  it("returns 0.8 for activity created 5 days ago", () => {
    const item = makeItem("a3", { kind: "activity" as any, created_at: daysAgo(5) });
    expect(computeFreshnessScore(item)).toBe(0.8);
  });

  it("returns 0.6 for activity created 10 days ago", () => {
    const item = makeItem("a4", { kind: "activity" as any, created_at: daysAgo(10) });
    expect(computeFreshnessScore(item)).toBe(0.6);
  });

  it("returns 0.3 for activity created 20 days ago", () => {
    const item = makeItem("a5", { kind: "activity" as any, created_at: daysAgo(20) });
    expect(computeFreshnessScore(item)).toBe(0.3);
  });

  it("returns 0.1 for activity created 60 days ago", () => {
    const item = makeItem("a6", { kind: "activity" as any, created_at: daysAgo(60) });
    expect(computeFreshnessScore(item)).toBe(RECOMMENDER_CONFIG.FRESHNESS.ACTIVITY_DEFAULT);
  });

  it("returns 0.5 (neutral) for events regardless of age", () => {
    const item = makeItem("e1", { kind: "event" as any, created_at: daysAgo(1) });
    expect(computeFreshnessScore(item)).toBe(RECOMMENDER_CONFIG.FRESHNESS.EVENT_SCORE);
  });

  it("returns 0.5 for old events too", () => {
    const item = makeItem("e2", { kind: "event" as any, created_at: daysAgo(90) });
    expect(computeFreshnessScore(item)).toBe(0.5);
  });

  it("returns 0.5 when created_at is null", () => {
    const item = makeItem("n1", { kind: "activity" as any, created_at: null as any });
    expect(computeFreshnessScore(item)).toBe(RECOMMENDER_CONFIG.FRESHNESS.NULL_SCORE);
  });

  it("returns monotonically decreasing scores for increasing age (activities)", () => {
    const scores = [0, 3, 7, 14, 30, 60].map((days) => {
      const item = makeItem(`m${days}`, { kind: "activity" as any, created_at: daysAgo(days) });
      return computeFreshnessScore(item);
    });
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
});

describe("RECOMMENDER_CONFIG weight sum", () => {
  it("weights sum to 1.0", () => {
    const sum = Object.values(RECOMMENDER_CONFIG.WEIGHTS).reduce(
      (a, b) => a + b,
      0
    );
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
  });

  it("has FRESHNESS weight", () => {
    expect(RECOMMENDER_CONFIG.WEIGHTS.FRESHNESS).toBeGreaterThan(0);
    expect(RECOMMENDER_CONFIG.WEIGHTS.FRESHNESS).toBeLessThanOrEqual(0.05);
  });
});

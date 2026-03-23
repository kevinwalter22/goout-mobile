/**
 * Enrichment Classification Tests
 *
 * Validates:
 * 1. audience_fit and is_event_venue validation
 * 2. Quality score multipliers for different audience fits
 * 3. Expected classification outputs for sample inputs
 * 4. Pipeline resilience (invalid data doesn't break anything)
 */

// We can't import Deno modules directly, so we test the scoring logic
// and validate the classification contract.

import type { ExploreItem } from "../../types/database";
import { scoreItem, type ScoringContext } from "../scoring";

// ============================================================================
// Test Helpers
// ============================================================================

function makeItem(overrides: Partial<ExploreItem & {
  normalized_confidence: number;
  audience_fit: string;
  is_event_venue: boolean;
  relevance_tier: number;
}>): ExploreItem {
  return {
    id: "test-1",
    kind: "activity",
    title: "Test Place",
    description: null,
    hook_line: "A great place to visit",
    category: "Food & Drink",
    sub_category: "restaurant",
    tags: ["food", "dining", "indoors"],
    price_bucket: "$$",
    starts_at: null,
    ends_at: null,
    lat: 41.65,
    lng: -70.28,
    location_name: "Test Location",
    address: null,
    town: "Hyannis",
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

function makeContext(): ScoringContext {
  return {
    userLocation: { lat: 41.65, lng: -70.28 },
    currentTime: new Date(2026, 1, 20, 18, 0), // Friday evening
    friendsGoingMap: new Map(),
    userTagAffinity: new Map(),
    weather: { isRaining: false, isSunny: true, temperature: 65 },
    featureFlags: new Map([
      ["weather_boost", true],
      ["tag_affinity", true],
      ["type_affinity_learning", false],
    ]),
    kindFilter: "all",
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("audience_fit scoring multipliers", () => {
  const ctx = makeContext();

  it("youth_general items get a quality boost", () => {
    const youthItem = makeItem({
      id: "youth-1",
      title: "Cool Bar",
      audience_fit: "youth_general",
      normalized_confidence: 75,
    });

    const unknownItem = makeItem({
      id: "unknown-1",
      title: "Some Place",
      audience_fit: "unknown",
      normalized_confidence: 75,
    });

    const youthScored = scoreItem(youthItem, ctx);
    const unknownScored = scoreItem(unknownItem, ctx);

    // youth_general should score higher than unknown (1.1x multiplier on quality)
    expect(youthScored.scoreBreakdown.quality).toBeGreaterThan(
      unknownScored.scoreBreakdown.quality
    );
  });

  it("business items get heavily penalized", () => {
    const businessItem = makeItem({
      id: "biz-1",
      title: "Conference Center",
      audience_fit: "business",
      normalized_confidence: 85,
    });

    const normalItem = makeItem({
      id: "normal-1",
      title: "Restaurant",
      audience_fit: "youth_general",
      normalized_confidence: 60,
    });

    const bizScored = scoreItem(businessItem, ctx);
    const normalScored = scoreItem(normalItem, ctx);

    // Business item with confidence 85 should still score LOWER quality
    // than a youth_general item with confidence 60 (0.3x penalty is massive)
    expect(bizScored.scoreBreakdown.quality).toBeLessThan(
      normalScored.scoreBreakdown.quality
    );
  });

  it("tourist items get heavily penalized", () => {
    const touristItem = makeItem({
      id: "tourist-1",
      title: "Souvenir Shop",
      audience_fit: "tourist",
      normalized_confidence: 80,
    });

    const scored = scoreItem(touristItem, ctx);

    // Tourist with confidence 80 (base=1.0) * 0.4 = 0.4
    expect(scored.scoreBreakdown.quality).toBeLessThanOrEqual(0.4);
  });

  it("event venues get a boost", () => {
    const venueItem = makeItem({
      id: "venue-1",
      title: "Live Music Bar",
      audience_fit: "youth_general",
      is_event_venue: true,
      normalized_confidence: 70,
    });

    const nonVenueItem = makeItem({
      id: "non-venue-1",
      title: "Regular Restaurant",
      audience_fit: "youth_general",
      is_event_venue: false,
      normalized_confidence: 70,
    });

    const venueScored = scoreItem(venueItem, ctx);
    const nonVenueScored = scoreItem(nonVenueItem, ctx);

    expect(venueScored.scoreBreakdown.quality).toBeGreaterThan(
      nonVenueScored.scoreBreakdown.quality
    );
  });

  it("null/undefined audience_fit is treated as neutral", () => {
    const nullItem = makeItem({
      id: "null-1",
      title: "Unknown Place",
      normalized_confidence: 70,
    });

    const scored = scoreItem(nullItem, ctx);

    // Base score for confidence 70 is 0.8, neutral multiplier = 1.0
    expect(scored.scoreBreakdown.quality).toBeCloseTo(0.8, 1);
  });
});

describe("expected classification outputs (contract tests)", () => {
  // These document expected LLM classification outputs
  // They verify the scoring handles each case correctly

  const sampleClassifications = [
    {
      name: "Craft Brewery",
      audience_fit: "youth_general",
      is_event_venue: true, // hosts live music
      expectedQualityRange: [0.7, 1.0],
    },
    {
      name: "Holiday Inn",
      audience_fit: "business",
      is_event_venue: false,
      expectedQualityRange: [0.0, 0.4],
    },
    {
      name: "Children's Museum",
      audience_fit: "family",
      is_event_venue: false,
      expectedQualityRange: [0.5, 0.9],
    },
    {
      name: "Souvenir Gift Shop",
      audience_fit: "tourist",
      is_event_venue: false,
      expectedQualityRange: [0.0, 0.5],
    },
    {
      name: "RC Car Racing Track",
      audience_fit: "niche",
      is_event_venue: false,
      expectedQualityRange: [0.3, 0.7],
    },
  ];

  const ctx = makeContext();

  for (const sample of sampleClassifications) {
    it(`${sample.name} (${sample.audience_fit}) quality in expected range`, () => {
      const item = makeItem({
        id: `sample-${sample.name}`,
        title: sample.name,
        audience_fit: sample.audience_fit,
        is_event_venue: sample.is_event_venue,
        normalized_confidence: 75,
      });

      const scored = scoreItem(item, ctx);
      const quality = scored.scoreBreakdown.quality;

      expect(quality).toBeGreaterThanOrEqual(sample.expectedQualityRange[0]);
      expect(quality).toBeLessThanOrEqual(sample.expectedQualityRange[1]);
    });
  }
});

describe("pipeline resilience", () => {
  const ctx = makeContext();

  it("handles missing audience_fit gracefully", () => {
    const item = makeItem({
      id: "no-fit",
      title: "Place Without Classification",
      normalized_confidence: 70,
    });
    // audience_fit is not set at all
    delete (item as any).audience_fit;

    expect(() => scoreItem(item, ctx)).not.toThrow();
    const scored = scoreItem(item, ctx);
    expect(scored.scoreBreakdown.quality).toBeGreaterThan(0);
  });

  it("handles invalid audience_fit string gracefully", () => {
    const item = makeItem({
      id: "bad-fit",
      title: "Weirdly Classified",
      audience_fit: "invalid_value" as any,
      normalized_confidence: 70,
    });

    // Should not throw — invalid values fall through to default case (1.0 multiplier)
    expect(() => scoreItem(item, ctx)).not.toThrow();
    const scored = scoreItem(item, ctx);
    expect(scored.scoreBreakdown.quality).toBeGreaterThan(0);
  });

  it("handles null confidence + null audience_fit", () => {
    const item = makeItem({
      id: "null-all",
      title: "Totally Unknown",
    });
    delete (item as any).normalized_confidence;
    delete (item as any).audience_fit;

    expect(() => scoreItem(item, ctx)).not.toThrow();
    const scored = scoreItem(item, ctx);
    // Should get default quality (0.4 base * 1.0 audience = 0.4)
    expect(scored.scoreBreakdown.quality).toBeCloseTo(0.4, 1);
  });
});

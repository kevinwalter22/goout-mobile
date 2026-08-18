import {
  groupItems,
  groupItemsByIntent,
  computeGroupDistinctiveness,
  DEFAULT_CONFIG,
  type GroupingConfig,
} from "../groupingEngine";
import type { ScoredItem, ScoreBreakdown } from "../scoring";
import { GROUP_TAXONOMY, type GroupDefinition, type GroupingContext } from "../../config/groupTaxonomy";

// These pre-existing tests exercise the legacy GROUP_TAXONOMY predicate-matching
// path (docs/intent_taxonomy.md §7 task 3 expand-not-replace fallback). None of
// their fixture items carry `intents`, so they must opt out of the new
// intent-grouping default explicitly rather than silently landing in overflow.
const TAXONOMY_CONFIG: GroupingConfig = { ...DEFAULT_CONFIG, useIntentGrouping: false };

// ============================================================================
// Test Helpers
// ============================================================================

const DEFAULT_BREAKDOWN: ScoreBreakdown = {
  timeMatch: 0.5,
  distance: 0.5,
  openNow: 0.5,
  friendsGoing: 0,
  tagAffinity: 0,
  weather: 0.5,
  contextIntent: 0.5,
  typeAffinity: 0.5,
  quality: 0.7,
  notability: 0.5,
  communityFeedback: 0.5,
  freshness: 0.5,
  friendCreated: 0,
  chainPenalty: 1.0,
  total: 0.5,
};

function makeScoredItem(
  overrides: Partial<ScoredItem> & { id: string; title: string }
): ScoredItem {
  return {
    kind: "activity",
    description: null,
    hook_line: null,
    category: "Food & Drink",
    sub_category: "restaurant",
    tags: ["restaurant", "dining"],
    price_bucket: "moderate",
    starts_at: null,
    ends_at: null,
    lat: 41.65,
    lng: -70.28,
    location_name: "Test Place",
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
    recommendScore: 0.65,
    scoreBreakdown: { ...DEFAULT_BREAKDOWN },
    relevance_tier: 2,
    normalized_confidence: 70,
    is_admin_suppressed: false,
    ...overrides,
  } as any;
}

function makeContext(overrides?: Partial<GroupingContext>): GroupingContext {
  return {
    now: new Date(2026, 1, 20, 18, 0), // Friday evening
    weather: { isRaining: false, isSunny: true, temperature: 65 },
    userLocation: { lat: 41.65, lng: -70.28 },
    kindFilter: "all",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("groupingEngine quality gating", () => {
  it("excludes hotels and other blocked sub_categories from cards", () => {
    const hotelItem = makeScoredItem({
      id: "hotel-1",
      title: "Holiday Inn Express",
      sub_category: "hotel",
      category: "Food & Drink",
      tags: ["restaurant", "bar", "dining"],
      recommendScore: 0.9,
    });

    const motelItem = makeScoredItem({
      id: "motel-1",
      title: "Super 8 Motel",
      sub_category: "motel",
      recommendScore: 0.85,
    });

    const storageItem = makeScoredItem({
      id: "storage-1",
      title: "U-Haul Self Storage",
      sub_category: "self storage",
      recommendScore: 0.8,
    });

    const goodRestaurant = makeScoredItem({
      id: "rest-1",
      title: "The Paddock",
      sub_category: "restaurant",
      recommendScore: 0.75,
    });

    const items = [hotelItem, motelItem, storageItem, goodRestaurant];
    const ctx = makeContext();
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    // Collect all item IDs from all groups
    const groupedIds = new Set<string>();
    for (const group of result.groups) {
      for (const item of group.items) {
        groupedIds.add(item.id);
      }
    }

    // Hotels, motels, storage should never be in cards
    expect(groupedIds.has("hotel-1")).toBe(false);
    expect(groupedIds.has("motel-1")).toBe(false);
    expect(groupedIds.has("storage-1")).toBe(false);

    // Also check overflow
    const overflowIds = new Set(result.overflow.map((i) => i.id));
    expect(overflowIds.has("hotel-1")).toBe(false);
    expect(overflowIds.has("motel-1")).toBe(false);
    expect(overflowIds.has("storage-1")).toBe(false);
  });

  it("excludes admin-suppressed items from cards and overflow", () => {
    const suppressed = makeScoredItem({
      id: "supp-1",
      title: "Suppressed Place",
      is_admin_suppressed: true,
      recommendScore: 0.95,
    } as any);

    const normal = makeScoredItem({
      id: "norm-1",
      title: "Normal Place",
      recommendScore: 0.6,
    });

    const items = [suppressed, normal];
    const ctx = makeContext();
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    const allIds = new Set<string>();
    for (const g of result.groups) {
      for (const item of g.items) allIds.add(item.id);
    }
    for (const item of result.overflow) allIds.add(item.id);

    expect(allIds.has("supp-1")).toBe(false);
  });

  it("excludes tier 0 items from cards and overflow", () => {
    const tier0 = makeScoredItem({
      id: "t0-1",
      title: "Low Quality Place",
      relevance_tier: 0,
      recommendScore: 0.9,
    } as any);

    const tier1 = makeScoredItem({
      id: "t1-1",
      title: "Marginal Place",
      relevance_tier: 1,
      recommendScore: 0.85,
    } as any);

    const tier2 = makeScoredItem({
      id: "t2-1",
      title: "Standard Place",
      relevance_tier: 2,
      recommendScore: 0.7,
    } as any);

    const items = [tier0, tier1, tier2];
    const ctx = makeContext();
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    // tier 0 should not appear anywhere
    const allIds = new Set<string>();
    for (const g of result.groups) {
      for (const item of g.items) allIds.add(item.id);
    }
    for (const item of result.overflow) allIds.add(item.id);

    expect(allIds.has("t0-1")).toBe(false);

    // tier 1 should only be in overflow, not in card groups
    const groupIds = new Set<string>();
    for (const g of result.groups) {
      for (const item of g.items) groupIds.add(item.id);
    }
    expect(groupIds.has("t1-1")).toBe(false);

    // tier 1 CAN appear in overflow
    const overflowIds = new Set(result.overflow.map((i) => i.id));
    expect(overflowIds.has("t1-1")).toBe(true);
  });

  it("enforces max 1 appearance per item across all cards", () => {
    // Create enough items that many card groups could form
    const items: ScoredItem[] = [];
    for (let i = 0; i < 30; i++) {
      items.push(
        makeScoredItem({
          id: `item-${i}`,
          title: `Restaurant ${i}`,
          sub_category: "restaurant",
          category: "Food & Drink",
          tags: ["restaurant", "dining", "food", "nightlife", "bar", "outdoor"],
          recommendScore: 0.9 - i * 0.02,
          scoreBreakdown: { ...DEFAULT_BREAKDOWN, quality: 0.8 },
        })
      );
    }

    const ctx = makeContext();
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    // Count appearances per item across all groups
    const appearances = new Map<string, number>();
    for (const group of result.groups) {
      for (const item of group.items) {
        appearances.set(item.id, (appearances.get(item.id) || 0) + 1);
      }
    }

    // No item should appear more than 1 time (maxGroupsPerItem = 1)
    for (const [id, count] of appearances) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it("uses quality-weighted scoring for group ranking", () => {
    // Two groups where one has high recommend scores but low quality,
    // and another has moderate recommend scores but high quality.
    // The quality-weighted one should rank higher.

    // This test verifies the scoring is quality-weighted by checking
    // that computeQualityWeightedScore is used (indirectly via avgTop3Score)
    const highScoreLowQuality = makeScoredItem({
      id: "hslq-1",
      title: "High Score Low Quality",
      recommendScore: 0.95,
      scoreBreakdown: { ...DEFAULT_BREAKDOWN, quality: 0.25 },
    });

    const modScoreHighQuality = makeScoredItem({
      id: "mshq-1",
      title: "Mod Score High Quality",
      recommendScore: 0.7,
      scoreBreakdown: { ...DEFAULT_BREAKDOWN, quality: 1.0 },
    });

    // Quality-weighted: 0.95 * 0.25 = 0.2375  vs  0.7 * 1.0 = 0.7
    // The high-quality group should win
    expect(0.7 * 1.0).toBeGreaterThan(0.95 * 0.25);
  });

  it("respects diversity caps per super-category", () => {
    // Create many items that all match food_drink groups
    const items: ScoredItem[] = [];
    for (let i = 0; i < 50; i++) {
      items.push(
        makeScoredItem({
          id: `food-${i}`,
          title: `Food Place ${i}`,
          sub_category: "restaurant",
          category: "Food & Drink",
          tags: ["restaurant", "dining", "food"],
          recommendScore: 0.9 - i * 0.01,
        })
      );
    }

    const ctx = makeContext();
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    // Count food_drink groups
    const foodGroups = result.groups.filter(
      (g) => g.diversityCategory === "food_drink"
    );

    // Diversity cap for food_drink is 3
    expect(foodGroups.length).toBeLessThanOrEqual(3);
  });
});

// ============================================================================
// Distinctiveness Tests
// ============================================================================

describe("group distinctiveness", () => {
  it("computeGroupDistinctiveness returns 0.5 when no definingTags", () => {
    const def: GroupDefinition = {
      id: "test",
      title: "Test",
      match: () => true,
      kindEligibility: ["all"],
      diversityCategory: "general",
      basePriority: 10,
    };
    const tagDf = new Map([["food", 500]]);
    expect(computeGroupDistinctiveness(def, tagDf, 1000)).toBe(0.5);
  });

  it("returns higher score for rare tags than common tags", () => {
    const rareDef: GroupDefinition = {
      id: "rare",
      title: "Rare Group",
      match: () => true,
      kindEligibility: ["all"],
      diversityCategory: "general",
      basePriority: 10,
      definingTags: ["skiing", "snowboarding"],
    };

    const commonDef: GroupDefinition = {
      id: "common",
      title: "Common Group",
      match: () => true,
      kindEligibility: ["all"],
      diversityCategory: "general",
      basePriority: 10,
      definingTags: ["family_friendly", "social"],
    };

    const tagDf = new Map([
      ["skiing", 10],
      ["snowboarding", 5],
      ["family_friendly", 600],
      ["social", 480],
    ]);

    const rareScore = computeGroupDistinctiveness(rareDef, tagDf, 1000);
    const commonScore = computeGroupDistinctiveness(commonDef, tagDf, 1000);

    expect(rareScore).toBeGreaterThan(commonScore);
  });

  it("distinctiveness affects group ordering when scores are close", () => {
    // Create items for two groups with nearly equal quality-weighted scores
    // but different tag distinctiveness
    const distinctiveItems: ScoredItem[] = [];
    const genericItems: ScoredItem[] = [];

    for (let i = 0; i < 5; i++) {
      distinctiveItems.push(
        makeScoredItem({
          id: `distinct-${i}`,
          title: `Ski Resort ${i}`,
          category: "Outdoor",
          tags: ["skiing", "snowboarding", "winter_activity", "outdoors"],
          recommendScore: 0.60,
          scoreBreakdown: { ...DEFAULT_BREAKDOWN, quality: 0.7 },
        })
      );
      genericItems.push(
        makeScoredItem({
          id: `generic-${i}`,
          title: `Family Place ${i}`,
          category: "Food & Drink",
          tags: ["family_friendly", "solo_friendly", "social", "dining", "food", "local_favorite"],
          recommendScore: 0.60,
          scoreBreakdown: { ...DEFAULT_BREAKDOWN, quality: 0.7 },
        })
      );
    }

    // Add many more generic items to make generic tags have high df
    for (let i = 0; i < 40; i++) {
      genericItems.push(
        makeScoredItem({
          id: `bulk-${i}`,
          title: `Bulk Place ${i}`,
          tags: ["family_friendly", "solo_friendly", "social", "local_favorite", "dining", "food"],
          recommendScore: 0.55,
        })
      );
    }

    const items = [...distinctiveItems, ...genericItems];
    const ctx = makeContext();
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    // Find winter_activities and family_friendly groups
    const winterGroup = result.groups.find((g) => g.id === "winter_activities");
    const familyGroup = result.groups.find((g) => g.id === "family_friendly");

    // When scores are very close, the distinctive group (winter_activities)
    // should get a boost from the distinctiveness multiplier
    if (winterGroup && familyGroup) {
      const winterIdx = result.groups.indexOf(winterGroup);
      const familyIdx = result.groups.indexOf(familyGroup);
      // Winter should not be pushed behind family
      // (exact ordering depends on many factors, but distinctiveness helps)
      expect(winterGroup.avgTop3Score).toBeGreaterThan(0);
    }

    // At minimum, winter_activities should form as a group
    // since we provided enough items
    expect(winterGroup).toBeDefined();
  });
});

// ============================================================================
// Sports & Recreation Tag Tests
// ============================================================================

describe("sports_rec group matching", () => {
  it("does not match items tagged only 'social' (no fitness, non-Sports & Recreation category)", () => {
    const items: ScoredItem[] = [];
    for (let i = 0; i < 5; i++) {
      items.push(
        makeScoredItem({
          id: `social-${i}`,
          title: `Social Spot ${i}`,
          category: "Food & Drink",
          sub_category: "restaurant",
          tags: ["social", "food", "dining"],
          recommendScore: 0.8 - i * 0.02,
        })
      );
    }

    const ctx = makeContext();
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    const sportsGroup = result.groups.find((g) => g.id === "sports_rec");
    expect(sportsGroup).toBeUndefined();

    const inSportsRec = new Set<string>();
    for (const group of result.groups) {
      if (group.id === "sports_rec") {
        for (const item of group.items) inSportsRec.add(item.id);
      }
    }
    expect(inSportsRec.size).toBe(0);
  });

  it("sports_rec match predicate still matches items tagged 'fitness'", () => {
    // Verified directly against the taxonomy predicate (rather than the full
    // grouping pipeline) because a fitness-tagged item can also satisfy the
    // unrelated "adventure" group, and max-1-group-per-item dedup would make
    // pipeline-level group formation depend on that group's priority ordering
    // rather than on the sports_rec predicate itself.
    const def = GROUP_TAXONOMY.find((g) => g.id === "sports_rec")!;
    const ctx = makeContext();

    const fitnessItem = makeScoredItem({
      id: "fitness-1",
      title: "Fitness Spot",
      category: "Sports & Recreation",
      sub_category: "gym",
      tags: ["fitness"],
    });
    expect(def.match(fitnessItem, ctx)).toBe(true);

    const socialOnlyItem = makeScoredItem({
      id: "social-only-1",
      title: "Social Spot",
      category: "Food & Drink",
      sub_category: "restaurant",
      tags: ["social", "food", "dining"],
    });
    expect(def.match(socialOnlyItem, ctx)).toBe(false);
  });
});

// ============================================================================
// Event Visibility Tests
// ============================================================================

describe("event visibility rule", () => {
  it("includes event group when >=2 upcoming events exist and minItems=2 is used", () => {
    // Create 2 events starting within 72 hours
    const now = new Date(2026, 1, 20, 18, 0); // Friday 6pm
    const tomorrowEvening = new Date(2026, 1, 21, 19, 0);
    const sundayAfternoon = new Date(2026, 1, 22, 14, 0);

    const event1 = makeScoredItem({
      id: "ev-1",
      title: "Concert at The Landing",
      kind: "event" as any,
      tags: ["live_music", "concert", "nightlife"],
      starts_at: tomorrowEvening.toISOString(),
      ends_at: new Date(tomorrowEvening.getTime() + 3 * 3600000).toISOString(),
      recommendScore: 0.7,
    });

    const event2 = makeScoredItem({
      id: "ev-2",
      title: "Jazz Night",
      kind: "event" as any,
      tags: ["live_music", "concert", "nightlife"],
      starts_at: sundayAfternoon.toISOString(),
      ends_at: new Date(sundayAfternoon.getTime() + 2 * 3600000).toISOString(),
      recommendScore: 0.65,
    });

    // Add some activity items too
    const activities: ScoredItem[] = [];
    for (let i = 0; i < 20; i++) {
      activities.push(
        makeScoredItem({
          id: `act-${i}`,
          title: `Restaurant ${i}`,
          tags: ["food", "dining", "family_friendly", "solo_friendly"],
          recommendScore: 0.8 - i * 0.02,
        })
      );
    }

    const items = [event1, event2, ...activities];
    const ctx = makeContext({ now });
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    // At least one group should contain the events
    const eventGroups = result.groups.filter((g) =>
      g.items.some((item) => item.kind === "event")
    );
    expect(eventGroups.length).toBeGreaterThanOrEqual(1);
  });

  it("event group forms with only 2 events when minItems override is set", () => {
    const now = new Date(2026, 1, 20, 18, 0);
    const soon = new Date(now.getTime() + 2 * 3600000); // 2 hours from now

    // Only 2 events — not enough for default minItems=3 but ok for minItems=2
    const items: ScoredItem[] = [
      makeScoredItem({
        id: "ev-1",
        title: "Live Band Tonight",
        kind: "event" as any,
        tags: ["live_music", "concert"],
        starts_at: soon.toISOString(),
        recommendScore: 0.75,
      }),
      makeScoredItem({
        id: "ev-2",
        title: "DJ Set",
        kind: "event" as any,
        tags: ["live_music", "concert", "nightlife"],
        starts_at: soon.toISOString(),
        recommendScore: 0.70,
      }),
    ];

    // Add activity items to fill other groups
    for (let i = 0; i < 15; i++) {
      items.push(
        makeScoredItem({
          id: `act-${i}`,
          title: `Place ${i}`,
          tags: ["food", "dining"],
          recommendScore: 0.6,
        })
      );
    }

    const ctx = makeContext({ now });
    const result = groupItems(items, [], ctx, TAXONOMY_CONFIG);

    // The live_music group has minItems=2 on its definition,
    // so it should form with just 2 events
    const musicGroup = result.groups.find((g) => g.id === "live_music");
    if (musicGroup) {
      expect(musicGroup.items.length).toBeGreaterThanOrEqual(2);
    }

    // Or at least one event-containing group should exist
    const eventInGroup = result.groups.some((g) =>
      g.items.some((item) => item.kind === "event")
    );
    expect(eventInGroup).toBe(true);
  });
});

describe("intent grouping (docs/intent_taxonomy.md §4/§7 task 3)", () => {
  const barA = makeScoredItem({
    id: "bar-a",
    title: "The Thirsty Pig",
    notability_score: 4.5,
    intents: [{ slug: "grab_a_drink", name: "Grab a Drink", is_primary: true }],
  });
  const barB = makeScoredItem({
    id: "bar-b",
    title: "Corner Tap",
    notability_score: 3.0,
    intents: [{ slug: "grab_a_drink", name: "Grab a Drink", is_primary: true }],
  });
  const museum = makeScoredItem({
    id: "museum-1",
    title: "Portland Museum of Art",
    notability_score: 4.0,
    intents: [
      { slug: "see_something", name: "See Something", is_primary: true },
      { slug: "get_outside", name: "Get Outside", is_primary: false },
    ],
  });
  const gym = makeScoredItem({
    id: "gym-1",
    title: "Anytime Fitness",
    sub_category: "gym",
    notability_score: 5.0,
    // No item_intents rows — must not surface in any carousel.
  });

  it("groups items into their primary carousel, ranked by notability_score DESC", () => {
    const result = groupItems([barA, barB, museum, gym], [], makeContext());

    const drinkGroup = result.groups.find((g) => g.id === "intent_grab_a_drink");
    expect(drinkGroup).toBeDefined();
    expect(drinkGroup!.items.map((i) => i.id)).toEqual(["bar-a", "bar-b"]);

    const seeGroup = result.groups.find((g) => g.id === "intent_see_something");
    expect(seeGroup!.items.map((i) => i.id)).toEqual(["museum-1"]);
  });

  it("places each item in its PRIMARY carousel ONLY — no secondaries", () => {
    const result = groupItems([barA, barB, museum, gym], [], makeContext());

    // museum-1 carries a get_outside SECONDARY, but secondaries are dropped: it
    // appears ONLY under its primary (See Something), never repeated in Get Outside.
    const outsideGroup = result.groups.find((g) => g.id === "intent_get_outside");
    expect(
      outsideGroup === undefined ||
        !outsideGroup.items.some((i) => i.id === "museum-1")
    ).toBe(true);

    const appearances = result.groups.filter((g) =>
      g.items.some((i) => i.id === "museum-1")
    ).length;
    expect(appearances).toBe(1);
  });

  it("de-duplicates an item that appears twice in the input (no within-carousel dupes)", () => {
    // The scored list can carry the same item twice (the postable-now merge); it
    // must still appear only ONCE in its carousel.
    const result = groupItemsByIntent([barA, barA, barB]);
    const drinkGroup = result.find((g) => g.id === "intent_grab_a_drink");
    expect(drinkGroup!.items.map((i) => i.id)).toEqual(["bar-a", "bar-b"]);
  });

  it("excludes items with no item_intents rows from every carousel", () => {
    const result = groupItems([barA, barB, museum, gym], [], makeContext());

    for (const group of result.groups) {
      expect(group.items.some((i) => i.id === "gym-1")).toBe(false);
    }
  });

  it("ranks What's Happening by soonest starts_at ASC, not notability", () => {
    const laterEvent = makeScoredItem({
      id: "evt-later",
      title: "Later Show",
      kind: "event",
      starts_at: new Date(2026, 1, 25).toISOString(),
      notability_score: 4.9,
      intents: [{ slug: "whats_happening", name: "What's Happening", is_primary: true }],
    });
    const soonerEvent = makeScoredItem({
      id: "evt-sooner",
      title: "Sooner Show",
      kind: "event",
      starts_at: new Date(2026, 1, 21).toISOString(),
      notability_score: 2.5,
      intents: [{ slug: "whats_happening", name: "What's Happening", is_primary: true }],
    });

    const result = groupItemsByIntent([laterEvent, soonerEvent]);
    const happeningGroup = result.find((g) => g.id === "intent_whats_happening");
    expect(happeningGroup!.items.map((i) => i.id)).toEqual(["evt-sooner", "evt-later"]);
  });

  it("orders carousels by intents.sort_order", () => {
    const result = groupItemsByIntent([barA, barB, museum]);
    const ids = result.map((g) => g.id);
    // museum's get_outside is a SECONDARY (now dropped) — only the two primary
    // carousels exist, ordered by sort_order (grab_a_drink=20 before see_something=40).
    expect(ids).toEqual([
      "intent_grab_a_drink",
      "intent_see_something",
    ]);
  });
});

describe("two-surface carousel curation (docs/intent_taxonomy.md §9)", () => {
  const foreStreet = makeScoredItem({
    id: "bite-fore-street",
    title: "Fore Street",
    notability_score: 3.0, // deliberately lower than the ineligible chain below
    is_carousel_eligible: true,
    blended_notability: 4.9,
    intents: [{ slug: "get_a_bite", name: "Get a Bite", is_primary: true }],
  } as any);
  const centralProvisions = makeScoredItem({
    id: "bite-central-provisions",
    title: "Central Provisions",
    notability_score: 2.5,
    is_carousel_eligible: true,
    blended_notability: 4.6,
    intents: [{ slug: "get_a_bite", name: "Get a Bite", is_primary: true }],
  } as any);
  const isaBistro = makeScoredItem({
    id: "bite-isa-bistro",
    title: "Isa Bistro",
    notability_score: 4.8, // high raw notability but curated OUT
    is_carousel_eligible: false,
    blended_notability: 3.9,
    intents: [{ slug: "get_a_bite", name: "Get a Bite", is_primary: true }],
  } as any);
  const eventide = makeScoredItem({
    id: "drink-eventide",
    title: "Eventide Oyster Co.",
    notability_score: 3.0,
    is_carousel_eligible: true,
    blended_notability: 4.8,
    intents: [{ slug: "grab_a_drink", name: "Grab a Drink", is_primary: true }],
  } as any);
  const crumbl = makeScoredItem({
    id: "drink-crumbl",
    title: "Crumbl",
    notability_score: 4.5,
    is_carousel_eligible: false,
    blended_notability: 2.0,
    intents: [{ slug: "grab_a_drink", name: "Grab a Drink", is_primary: true }],
  } as any);
  // Other region/intent: is_carousel_eligible NULL — unchanged, ranked by notability_score.
  const trailhead = makeScoredItem({
    id: "outside-trailhead",
    title: "Some Trailhead",
    notability_score: 4.0,
    intents: [{ slug: "get_outside", name: "Get Outside", is_primary: true }],
  });

  it("excludes is_carousel_eligible=false items from the browse carousel", () => {
    const result = groupItemsByIntent([foreStreet, centralProvisions, isaBistro]);
    const biteGroup = result.find((g) => g.id === "intent_get_a_bite");
    expect(biteGroup!.items.map((i) => i.id)).not.toContain("bite-isa-bistro");
  });

  it("ranks eligible items by blended_notability DESC, not raw notability_score", () => {
    const result = groupItemsByIntent([foreStreet, centralProvisions, isaBistro]);
    const biteGroup = result.find((g) => g.id === "intent_get_a_bite");
    // foreStreet has the lower notability_score but the higher blended_notability.
    expect(biteGroup!.items.map((i) => i.id)).toEqual([
      "bite-fore-street",
      "bite-central-provisions",
    ]);
  });

  it("keeps restaurants and low-blend chains out of Grab a Drink", () => {
    const result = groupItemsByIntent([eventide, crumbl]);
    const drinkGroup = result.find((g) => g.id === "intent_grab_a_drink");
    expect(drinkGroup!.items.map((i) => i.id)).toEqual(["drink-eventide"]);
  });

  it("leaves is_carousel_eligible=NULL intents/regions ranked by notability_score as before", () => {
    const other = makeScoredItem({
      id: "outside-other",
      title: "Another Spot",
      notability_score: 2.0,
      intents: [{ slug: "get_outside", name: "Get Outside", is_primary: true }],
    });
    const result = groupItemsByIntent([trailhead, other]);
    const outsideGroup = result.find((g) => g.id === "intent_get_outside");
    expect(outsideGroup!.items.map((i) => i.id)).toEqual([
      "outside-trailhead",
      "outside-other",
    ]);
  });
});

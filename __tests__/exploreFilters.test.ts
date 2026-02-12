/**
 * Explore Filters Test Suite
 *
 * Verifies filter queries return expected results for sample fixtures.
 * Tests can run against mocked data or real Supabase (with test env).
 */

import {
  DEFAULT_FILTER_STATE,
  ExploreFilterState,
  hasActiveFilters,
  getFilterSummary,
  getEffectiveFilters,
  QUICK_FILTERS,
  QuickFilterId,
} from "../src/config/exploreFilters";
import {
  normalizeCategory,
  normalizePrice,
  normalizeTags,
  normalizeTown,
  applyNormalization,
  needsNormalizationRepair,
  CANONICAL_CATEGORIES,
  CANONICAL_PRICE_BUCKETS,
} from "../src/lib/normalizeExploreItem";
import {
  computePostableNow,
  processPostableNow,
  PostableReason,
} from "../src/lib/postableNow";
import type { ExploreItem } from "../src/types/database";

// ============================================================================
// MOCK DATA FIXTURES
// ============================================================================

const createMockItem = (overrides: Partial<ExploreItem> = {}): ExploreItem => ({
  id: `test-${Math.random().toString(36).slice(2)}`,
  kind: "activity",
  title: "Test Activity",
  description: "A test activity for filtering",
  hook_line: null,
  category: "Outdoor",
  sub_category: null,
  location_name: "Test Location",
  address: "123 Test St",
  town: "Burlington",
  lat: 44.4759,
  lng: -73.2121,
  starts_at: null,
  ends_at: null,
  schedule_text: "Daily, Year-round",
  time_text: null,
  recurrence: null,
  season: null,
  price_bucket: "free",
  effort: "low",
  xp_value: 10,
  priority: 50,
  is_anchor: false,
  is_hidden_gem: false,
  source_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

// Sample fixtures for different filter scenarios
const FIXTURES = {
  outdoorFree: createMockItem({
    id: "outdoor-free-1",
    title: "Mountain Hike",
    category: "Outdoor",
    price_bucket: "free",
    tags: ["hiking", "outdoors", "nature"],
  }),
  nightlifeExpensive: createMockItem({
    id: "nightlife-expensive-1",
    title: "Club Night",
    category: "Nightlife",
    price_bucket: "$$$",
    tags: ["nightlife", "dancing", "music"],
  }),
  eventToday: createMockItem({
    id: "event-today-1",
    kind: "event",
    title: "Concert Tonight",
    category: "Arts & Culture",
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  }),
  eventTomorrow: createMockItem({
    id: "event-tomorrow-1",
    kind: "event",
    title: "Festival Tomorrow",
    category: "Arts & Culture",
    starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }),
  winterActivity: createMockItem({
    id: "winter-1",
    title: "Skiing",
    category: "Winter Activities",
    season: "winter",
    tags: ["skiing", "winter", "outdoors"],
  }),
  hiddenGem: createMockItem({
    id: "hidden-gem-1",
    title: "Secret Waterfall",
    category: "Outdoor",
    is_hidden_gem: true,
  }),
  anchor: createMockItem({
    id: "anchor-1",
    title: "Burlington Waterfront",
    category: "Anchor",
    is_anchor: true,
  }),
};

const ALL_FIXTURES = Object.values(FIXTURES);

// ============================================================================
// FILTER STATE TESTS
// ============================================================================

describe("Filter State Management", () => {
  describe("DEFAULT_FILTER_STATE", () => {
    it("should have no active filters by default", () => {
      expect(hasActiveFilters(DEFAULT_FILTER_STATE)).toBe(false);
    });

    it("should have null quick filter", () => {
      expect(DEFAULT_FILTER_STATE.quickFilter).toBeNull();
    });

    it("should have 'all' for category, price, and time", () => {
      expect(DEFAULT_FILTER_STATE.category).toBe("all");
      expect(DEFAULT_FILTER_STATE.priceBucket).toBe("all");
      expect(DEFAULT_FILTER_STATE.timeWindow).toBe("all");
    });
  });

  describe("hasActiveFilters", () => {
    it("should return true when quick filter is set", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        quickFilter: "today",
      };
      expect(hasActiveFilters(state)).toBe(true);
    });

    it("should return true when category is set", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        category: "outdoors",
      };
      expect(hasActiveFilters(state)).toBe(true);
    });

    it("should return true when price bucket is set", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        priceBucket: "free",
      };
      expect(hasActiveFilters(state)).toBe(true);
    });

    it("should return true when time window is set", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        timeWindow: "today",
      };
      expect(hasActiveFilters(state)).toBe(true);
    });

    it("should return true when distance differs from default (50)", () => {
      // The implementation checks distance !== 50
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        distance: 10,
      };
      expect(hasActiveFilters(state)).toBe(true);
    });

    it("should return false when only distance is default (50)", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        distance: 50,
      };
      expect(hasActiveFilters(state)).toBe(false);
    });
  });

  describe("getFilterSummary", () => {
    it("should return 'All Events' for default state", () => {
      // The implementation returns "All Events" when no filters are active
      expect(getFilterSummary(DEFAULT_FILTER_STATE)).toBe("All Events");
    });

    it("should include quick filter name when active", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        quickFilter: "today",
      };
      const summary = getFilterSummary(state);
      expect(summary).toContain("Today");
    });

    it("should include category when set", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        category: "music",
      };
      const summary = getFilterSummary(state);
      expect(summary).toContain("Music");
    });
  });

  describe("getEffectiveFilters", () => {
    it("should return quick filter criteria when quick filter is active", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        quickFilter: "free", // The actual quick filter ID
        priceBucket: "$$$", // Should be overridden by quick filter
      };
      const effective = getEffectiveFilters(state);
      expect(effective.priceBucket).toBe("free");
    });

    it("should return advanced filter values when no quick filter", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        quickFilter: null,
        category: "nightlife",
        priceBucket: "$$$",
      };
      const effective = getEffectiveFilters(state);
      expect(effective.category).toBe("nightlife");
      expect(effective.priceBucket).toBe("$$$");
    });

    it("should preserve distance from state even with quick filter", () => {
      const state: ExploreFilterState = {
        ...DEFAULT_FILTER_STATE,
        quickFilter: "today",
        distance: 10,
      };
      const effective = getEffectiveFilters(state);
      expect(effective.distance).toBe(10);
    });
  });
});

// ============================================================================
// NORMALIZATION TESTS
// ============================================================================

describe("Data Normalization", () => {
  describe("normalizeCategory", () => {
    it("should normalize exact matches", () => {
      expect(normalizeCategory("Outdoor")).toBe("Outdoor");
      expect(normalizeCategory("Nightlife")).toBe("Nightlife");
    });

    it("should normalize case-insensitive matches", () => {
      expect(normalizeCategory("outdoor")).toBe("Outdoor");
      expect(normalizeCategory("NIGHTLIFE")).toBe("Nightlife");
    });

    it("should normalize synonyms", () => {
      expect(normalizeCategory("outdoors")).toBe("Outdoor");
      expect(normalizeCategory("nature")).toBe("Outdoor");
      expect(normalizeCategory("hiking")).toBe("Outdoor");
      expect(normalizeCategory("bars")).toBe("Nightlife");
      expect(normalizeCategory("clubs")).toBe("Nightlife");
    });

    it("should return null for unknown categories", () => {
      expect(normalizeCategory("xyz123")).toBeNull();
      expect(normalizeCategory(null)).toBeNull();
      expect(normalizeCategory(undefined)).toBeNull();
    });
  });

  describe("normalizePrice", () => {
    it("should normalize string price buckets", () => {
      expect(normalizePrice("free")).toBe("free");
      expect(normalizePrice("$")).toBe("$");
      expect(normalizePrice("$$")).toBe("$$");
      expect(normalizePrice("$$$")).toBe("$$$");
    });

    it("should normalize synonyms", () => {
      expect(normalizePrice("Free")).toBe("free");
      expect(normalizePrice("cheap")).toBe("$");
      expect(normalizePrice("moderate")).toBe("$$");
      expect(normalizePrice("expensive")).toBe("$$$");
    });

    it("should normalize numeric values", () => {
      expect(normalizePrice(0)).toBe("free");
      expect(normalizePrice(10)).toBe("$");
      expect(normalizePrice(30)).toBe("$$");
      expect(normalizePrice(100)).toBe("$$$");
    });

    it("should return unknown for invalid values", () => {
      expect(normalizePrice("xyz")).toBe("unknown");
      expect(normalizePrice(null)).toBe("unknown");
    });
  });

  describe("normalizeTags", () => {
    it("should normalize exact tag matches", () => {
      const result = normalizeTags(["hiking", "camping", "outdoors"]);
      expect(result).toContain("hiking");
      expect(result).toContain("camping");
      expect(result).toContain("outdoors");
    });

    it("should normalize tag synonyms", () => {
      const result = normalizeTags(["hike", "camp"]);
      expect(result).toContain("hiking");
      expect(result).toContain("camping");
    });

    it("should remove duplicates", () => {
      const result = normalizeTags(["hiking", "hike", "HIKING"]);
      expect(result.filter((t) => t === "hiking").length).toBe(1);
    });

    it("should return empty array for null/undefined", () => {
      expect(normalizeTags(null)).toEqual([]);
      expect(normalizeTags(undefined)).toEqual([]);
    });
  });

  describe("normalizeTown", () => {
    it("should normalize town names via synonyms", () => {
      expect(normalizeTown("potsdam")).toBe("Potsdam");
      expect(normalizeTown("canton")).toBe("Canton");
    });

    it("should title case non-synonym towns", () => {
      expect(normalizeTown("burlington")).toBe("Burlington");
      expect(normalizeTown("BURLINGTON")).toBe("Burlington");
    });

    it("should title case multi-word towns", () => {
      const result = normalizeTown("new york");
      // "new york" is a synonym mapped to "New York City"
      expect(result).toBe("New York City");
    });

    it("should return null for empty values", () => {
      expect(normalizeTown(null)).toBeNull();
      expect(normalizeTown("")).toBeNull();
    });
  });

  describe("applyNormalization", () => {
    it("should normalize category field", () => {
      const item = { category: "outdoors" };
      const normalized = applyNormalization(item);
      expect(normalized.category).toBe("Outdoor");
    });

    it("should normalize price_bucket field", () => {
      const item = { price_bucket: "cheap" as any };
      const normalized = applyNormalization(item);
      expect(normalized.price_bucket).toBe("$");
    });

    it("should normalize tags field", () => {
      const item = { tags: ["hike", "camp"] };
      const normalized = applyNormalization(item);
      expect(normalized.tags).toContain("hiking");
      expect(normalized.tags).toContain("camping");
    });
  });

  describe("needsNormalizationRepair", () => {
    it("should return false for properly normalized items", () => {
      const item = createMockItem({
        category: "Outdoor",
        price_bucket: "free",
        tags: ["hiking"],
        town: "Burlington",
      });
      expect(needsNormalizationRepair(item)).toBe(false);
    });

    it("should return true for items with non-canonical values", () => {
      const item = createMockItem({
        category: "outdoors" as any, // Not canonical
        price_bucket: "free",
      });
      expect(needsNormalizationRepair(item)).toBe(true);
    });
  });
});

// ============================================================================
// POSTABLE NOW TESTS
// ============================================================================

describe("Postable Now Logic", () => {
  const userLocation = { lat: 44.4759, lng: -73.2121 }; // Burlington

  describe("computePostableNow", () => {
    it("should mark nearby activities as postable", () => {
      const item = createMockItem({
        lat: 44.476, // Very close to user
        lng: -73.212,
        schedule_text: "Daily, Year-round",
      });
      const result = computePostableNow(item, userLocation);
      expect(result.isPostable).toBe(true);
      expect(result.reason).toBe("always_available");
    });

    it("should mark items without coordinates as not postable", () => {
      const item = createMockItem({
        lat: null,
        lng: null,
      });
      const result = computePostableNow(item, userLocation);
      expect(result.isPostable).toBe(false);
      expect(result.reason).toBe("no_location");
    });

    it("should mark far away items as not postable", () => {
      const item = createMockItem({
        lat: 40.7128, // NYC - far from Burlington
        lng: -74.006,
      });
      const result = computePostableNow(item, userLocation);
      expect(result.isPostable).toBe(false);
      expect(result.reason).toBe("too_far");
    });

    it("should mark in-progress events as postable", () => {
      const now = new Date();
      const startTime = new Date(now.getTime() - 30 * 60 * 1000); // Started 30 min ago
      const endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // Ends in 2 hours

      const item = createMockItem({
        kind: "event",
        lat: 44.476,
        lng: -73.212,
        starts_at: startTime.toISOString(),
        ends_at: endTime.toISOString(),
      });
      const result = computePostableNow(item, userLocation, now);
      expect(result.isPostable).toBe(true);
      expect(result.reason).toBe("in_progress");
    });

    it("should mark events starting soon as postable", () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 30 * 60 * 1000); // Starts in 30 min

      const item = createMockItem({
        kind: "event",
        lat: 44.476,
        lng: -73.212,
        starts_at: startTime.toISOString(),
      });
      const result = computePostableNow(item, userLocation, now);
      expect(result.isPostable).toBe(true);
      expect(result.reason).toBe("starting_soon");
    });

    it("should mark future events as not postable", () => {
      const now = new Date();
      const startTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow

      const item = createMockItem({
        kind: "event",
        lat: 44.476,
        lng: -73.212,
        starts_at: startTime.toISOString(),
      });
      const result = computePostableNow(item, userLocation, now);
      expect(result.isPostable).toBe(false);
      expect(result.reason).toBe("not_yet");
    });

    it("should mark ended events as not postable", () => {
      const now = new Date();
      const endTime = new Date(now.getTime() - 3 * 60 * 60 * 1000); // Ended 3 hours ago
      const startTime = new Date(endTime.getTime() - 2 * 60 * 60 * 1000);

      const item = createMockItem({
        kind: "event",
        lat: 44.476,
        lng: -73.212,
        starts_at: startTime.toISOString(),
        ends_at: endTime.toISOString(),
      });
      const result = computePostableNow(item, userLocation, now);
      expect(result.isPostable).toBe(false);
      expect(result.reason).toBe("ended");
    });
  });

  describe("processPostableNow", () => {
    it("should separate items into postable and other", () => {
      const nearbyItem = createMockItem({
        id: "nearby",
        lat: 44.476,
        lng: -73.212,
      });
      const farItem = createMockItem({
        id: "far",
        lat: 40.7128,
        lng: -74.006,
      });

      const { postableNow, other } = processPostableNow(
        [nearbyItem, farItem],
        userLocation
      );

      expect(postableNow.length).toBe(1);
      expect(postableNow[0].id).toBe("nearby");
      expect(other.length).toBe(1);
      expect(other[0].id).toBe("far");
    });

    it("should sort postable items by priority", () => {
      const now = new Date();

      // In-progress event (highest priority)
      const inProgress = createMockItem({
        id: "in-progress",
        kind: "event",
        lat: 44.476,
        lng: -73.212,
        starts_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        ends_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      });

      // Starting soon (medium priority)
      const startingSoon = createMockItem({
        id: "starting-soon",
        kind: "event",
        lat: 44.476,
        lng: -73.212,
        starts_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      });

      // Always available activity (lower priority)
      const activity = createMockItem({
        id: "activity",
        kind: "activity",
        lat: 44.476,
        lng: -73.212,
      });

      const { postableNow } = processPostableNow(
        [activity, startingSoon, inProgress], // Scrambled order
        userLocation,
        now
      );

      expect(postableNow[0].id).toBe("in-progress");
      expect(postableNow[1].id).toBe("starting-soon");
      expect(postableNow[2].id).toBe("activity");
    });

    it("should limit postable items to maxItems", () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        createMockItem({
          id: `item-${i}`,
          lat: 44.476,
          lng: -73.212,
        })
      );

      const { postableNow, other } = processPostableNow(
        items,
        userLocation,
        new Date(),
        5 // maxItems
      );

      expect(postableNow.length).toBe(5);
      expect(other.length).toBe(15);
    });
  });
});

// ============================================================================
// QUICK FILTER TESTS
// ============================================================================

describe("Quick Filters", () => {
  describe("Quick filter definitions", () => {
    it("should have all required quick filters defined", () => {
      // Check the actual quick filter IDs from the implementation
      const expectedFilters: QuickFilterId[] = [
        "today",
        "tonight",
        "this_weekend",
        "free",
        "outdoors",
        "live_music",
      ];
      expectedFilters.forEach((id) => {
        const filter = QUICK_FILTERS.find((f) => f.id === id);
        expect(filter).toBeDefined();
        expect(filter?.label).toBeDefined();
      });
    });

    it("each quick filter should have criteria", () => {
      QUICK_FILTERS.forEach((filter) => {
        expect(filter.criteria).toBeDefined();
        // At least one criteria field should be set
        const hasCriteria =
          filter.criteria.category !== undefined ||
          filter.criteria.priceBucket !== undefined ||
          filter.criteria.timeWindow !== undefined ||
          filter.criteria.tags !== undefined;
        expect(hasCriteria).toBe(true);
      });
    });
  });

  describe("Free filter", () => {
    it("should set price bucket to free", () => {
      const freeFilter = QUICK_FILTERS.find((f) => f.id === "free");
      expect(freeFilter?.criteria.priceBucket).toBe("free");
    });
  });

  describe("Today filter", () => {
    it("should set timeWindow to today", () => {
      const todayFilter = QUICK_FILTERS.find((f) => f.id === "today");
      expect(todayFilter?.criteria.timeWindow).toBe("today");
    });
  });

  describe("Outdoors filter", () => {
    it("should set tags for outdoor activities", () => {
      const outdoorsFilter = QUICK_FILTERS.find((f) => f.id === "outdoors");
      expect(outdoorsFilter?.criteria.tags).toBeDefined();
      expect(outdoorsFilter?.criteria.tags).toContain("outdoors");
    });
  });
});

// ============================================================================
// INTEGRATION TESTS (Mock-based)
// ============================================================================

describe("Filter Integration", () => {
  // Simulates applying filters to mock data (what the query would do)
  function applyFilters(
    items: ExploreItem[],
    filters: ExploreFilterState
  ): ExploreItem[] {
    const effective = getEffectiveFilters(filters);

    return items.filter((item) => {
      // Category filter
      if (effective.category !== "all") {
        const normalizedCategory = normalizeCategory(item.category);
        if (
          normalizedCategory?.toLowerCase() !==
          effective.category.toLowerCase()
        ) {
          return false;
        }
      }

      // Price filter
      if (effective.priceBucket !== "all") {
        const normalizedPrice = normalizePrice(item.price_bucket);
        if (normalizedPrice !== effective.priceBucket) {
          return false;
        }
      }

      // Time window filter (simplified)
      if (effective.timeWindow === "today" && item.kind === "event") {
        if (!item.starts_at) return false;
        const startDate = new Date(item.starts_at).toDateString();
        const today = new Date().toDateString();
        if (startDate !== today) return false;
      }

      return true;
    });
  }

  it("should filter by category", () => {
    const filters: ExploreFilterState = {
      ...DEFAULT_FILTER_STATE,
      category: "outdoors",
    };
    const results = applyFilters(ALL_FIXTURES, filters);
    results.forEach((item) => {
      expect(normalizeCategory(item.category)).toBe("Outdoor");
    });
  });

  it("should filter by price bucket", () => {
    const filters: ExploreFilterState = {
      ...DEFAULT_FILTER_STATE,
      priceBucket: "free",
    };
    const results = applyFilters(ALL_FIXTURES, filters);
    results.forEach((item) => {
      expect(normalizePrice(item.price_bucket)).toBe("free");
    });
  });

  it("should apply quick filter over advanced filters", () => {
    const filters: ExploreFilterState = {
      ...DEFAULT_FILTER_STATE,
      quickFilter: "free",
      // These should be ignored when quick filter is active
      category: "nightlife",
      priceBucket: "$$$",
    };
    const results = applyFilters(ALL_FIXTURES, filters);
    // Should return free items, not $$$ nightlife
    results.forEach((item) => {
      expect(normalizePrice(item.price_bucket)).toBe("free");
    });
  });

  it("should return all items when no filters active", () => {
    const results = applyFilters(ALL_FIXTURES, DEFAULT_FILTER_STATE);
    expect(results.length).toBe(ALL_FIXTURES.length);
  });
});

/**
 * Explore Filters Configuration
 *
 * Config-driven filter definitions for the Explore tab.
 * Change chips and filter options here without rewiring UI.
 *
 * FILTER PRIORITY RULES:
 * 1. Quick filters (chips) are presets that set multiple filter fields at once
 * 2. When a quick filter is active, its criteria override advanced filters
 * 3. When an advanced filter is changed, any active quick filter is cleared
 * 4. Distance is orthogonal - applies alongside both quick and advanced filters
 */

// ============================================================================
// DEBUG MODE
// ============================================================================

/**
 * Enable debug mode to print filter state and query params in console.
 * Toggle this for development/debugging.
 */
export const EXPLORE_DEBUG_MODE = __DEV__ || false;

/**
 * Postable Now configuration
 */
export const POSTABLE_NOW_CONFIG = {
  /** Default radius for "postable now" consideration (miles) - 200m ≈ 0.124 miles */
  defaultRadius: 0.124,
  /** Max items to show in Postable Now section (set high to avoid hiding postable items) */
  maxItems: 50,
  /** Time buffer before event start to consider it "postable" (minutes) */
  preEventBuffer: 60,
};

// ============================================================================
// TYPES
// ============================================================================

export type QuickFilterId =
  | "today"
  | "tonight"
  | "this_weekend"
  | "free"
  | "outdoors"
  | "live_music"
  | "family"
  | "sports";

export type CategoryId =
  | "all"
  | "music"
  | "sports"
  | "arts"
  | "entertainment"
  | "community"
  | "food"
  | "outdoors"
  | "nightlife";

export type PriceBucket = "all" | "free" | "$" | "$$" | "$$$";

export type TimeWindow = "all" | "today" | "tonight" | "tomorrow" | "this_weekend" | "this_week" | "this_month";

export type SortOption = "soonest" | "priority" | "distance";

export type DistanceRadius = 5 | 10 | 25 | 50 | 100 | "any";

export type KindFilter = "all" | "activity" | "event";

// ============================================================================
// QUICK FILTER CHIPS
// ============================================================================

export interface QuickFilter {
  id: QuickFilterId;
  label: string;
  icon?: string;
  // Filter criteria this chip applies
  criteria: {
    timeWindow?: TimeWindow;
    priceBucket?: PriceBucket;
    category?: CategoryId;
    tags?: string[];
  };
}

export const QUICK_FILTERS: QuickFilter[] = [
  {
    id: "today",
    label: "Today",
    criteria: { timeWindow: "today" },
  },
  {
    id: "tonight",
    label: "Tonight",
    criteria: { timeWindow: "tonight" },
  },
  {
    id: "this_weekend",
    label: "This Weekend",
    criteria: { timeWindow: "this_weekend" },
  },
  {
    id: "free",
    label: "Free",
    criteria: { priceBucket: "free" },
  },
  {
    id: "outdoors",
    label: "Outdoors",
    criteria: { tags: ["outdoors", "hiking", "nature", "parks"] },
  },
  {
    id: "live_music",
    label: "Live Music",
    criteria: { category: "music", tags: ["live_music", "concert"] },
  },
  // Easy to add more:
  // {
  //   id: "family",
  //   label: "Family",
  //   criteria: { tags: ["family_friendly", "kids"] },
  // },
  // {
  //   id: "sports",
  //   label: "Sports",
  //   criteria: { category: "sports" },
  // },
];

// ============================================================================
// CATEGORY OPTIONS
// ============================================================================

export interface CategoryOption {
  id: CategoryId;
  label: string;
  icon?: string;
}

export const CATEGORIES: CategoryOption[] = [
  { id: "all", label: "All Categories" },
  { id: "music", label: "Music" },
  { id: "sports", label: "Sports" },
  { id: "arts", label: "Arts & Theatre" },
  { id: "entertainment", label: "Entertainment" },
  { id: "community", label: "Community" },
  { id: "food", label: "Food & Drink" },
  { id: "outdoors", label: "Outdoors" },
  { id: "nightlife", label: "Nightlife" },
];

// ============================================================================
// PRICE OPTIONS
// ============================================================================

export interface PriceOption {
  id: PriceBucket;
  label: string;
}

export const PRICE_OPTIONS: PriceOption[] = [
  { id: "all", label: "Any Price" },
  { id: "free", label: "Free" },
  { id: "$", label: "$ (Under $30)" },
  { id: "$$", label: "$$ ($30-75)" },
  { id: "$$$", label: "$$$ ($75+)" },
];

// ============================================================================
// TIME WINDOW OPTIONS
// ============================================================================

export interface TimeOption {
  id: TimeWindow;
  label: string;
}

export const TIME_OPTIONS: TimeOption[] = [
  { id: "all", label: "Any Time" },
  { id: "today", label: "Today" },
  { id: "tonight", label: "Tonight" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "this_weekend", label: "This Weekend" },
  { id: "this_week", label: "This Week" },
  { id: "this_month", label: "This Month" },
];

// ============================================================================
// DISTANCE OPTIONS
// ============================================================================

export interface DistanceOption {
  id: DistanceRadius;
  label: string;
}

export const DISTANCE_OPTIONS: DistanceOption[] = [
  { id: 5, label: "5 miles" },
  { id: 10, label: "10 miles" },
  { id: 25, label: "25 miles" },
  { id: 50, label: "50 miles" },
  { id: 100, label: "100 miles" },
  { id: "any", label: "Any distance" },
];

// ============================================================================
// SORT OPTIONS
// ============================================================================

export interface SortOptionConfig {
  id: SortOption;
  label: string;
}

export const SORT_OPTIONS: SortOptionConfig[] = [
  { id: "soonest", label: "Soonest" },
  { id: "priority", label: "Featured" },
  { id: "distance", label: "Nearest" },
];

// ============================================================================
// DEFAULT FILTER STATE
// ============================================================================

export interface ExploreFilterState {
  // Quick filter (only one active at a time, or null)
  quickFilter: QuickFilterId | null;

  // Kind filter (activities vs events)
  kindFilter: KindFilter;

  // Advanced filters — categories is an array; empty means "all categories"
  categories: CategoryId[];
  priceBucket: PriceBucket;
  timeWindow: TimeWindow;
  distance: DistanceRadius;

  // Sorting
  sort: SortOption;

  // Text search
  searchQuery: string;

  // Pagination
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTER_STATE: ExploreFilterState = {
  quickFilter: null,
  kindFilter: "all",
  categories: [],
  priceBucket: "all",
  timeWindow: "all",
  distance: 50,
  sort: "soonest",
  searchQuery: "",
  page: 0,
  pageSize: 20,
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get a quick filter by ID
 */
export function getQuickFilter(id: QuickFilterId): QuickFilter | undefined {
  return QUICK_FILTERS.find((f) => f.id === id);
}

/**
 * Check if any filters are active (not default)
 */
export function hasActiveFilters(state: ExploreFilterState): boolean {
  return (
    state.quickFilter !== null ||
    state.kindFilter !== "all" ||
    state.categories.length > 0 ||
    state.priceBucket !== "all" ||
    state.timeWindow !== "all" ||
    state.distance !== 50 ||
    state.searchQuery !== ""
  );
}

/**
 * Get human-readable filter summary
 */
export function getFilterSummary(state: ExploreFilterState): string {
  const parts: string[] = [];

  if (state.quickFilter) {
    const qf = getQuickFilter(state.quickFilter);
    if (qf) parts.push(qf.label);
  }

  if (state.kindFilter !== "all") {
    parts.push(state.kindFilter === "activity" ? "Activities" : "Events");
  }

  if (state.categories.length > 0) {
    const labels = state.categories
      .map((id) => CATEGORIES.find((c) => c.id === id)?.label)
      .filter(Boolean)
      .join(", ");
    if (labels) parts.push(labels);
  }

  if (state.priceBucket !== "all") {
    const price = PRICE_OPTIONS.find((p) => p.id === state.priceBucket);
    if (price) parts.push(price.label);
  }

  if (state.timeWindow !== "all" && !state.quickFilter) {
    const time = TIME_OPTIONS.find((t) => t.id === state.timeWindow);
    if (time) parts.push(time.label);
  }

  return parts.length > 0 ? parts.join(" · ") : "All";
}

/**
 * Count active advanced filters (for badge display)
 */
export function countActiveAdvancedFilters(state: ExploreFilterState): number {
  let count = 0;
  if (state.categories.length > 0) count++;
  if (state.priceBucket !== "all") count++;
  if (state.timeWindow !== "all") count++;
  if (state.distance !== 50) count++;
  return count;
}

/**
 * Get effective filter criteria (resolves quick filter to actual values)
 */
export function getEffectiveFilters(state: ExploreFilterState): {
  timeWindow: TimeWindow;
  categories: CategoryId[];
  priceBucket: PriceBucket;
  tags: string[];
  distance: DistanceRadius;
  sort: SortOption;
  kindFilter: KindFilter;
} {
  if (state.quickFilter) {
    const qf = getQuickFilter(state.quickFilter);
    if (qf) {
      const qfCategory = qf.criteria.category;
      return {
        timeWindow: qf.criteria.timeWindow || "all",
        categories: qfCategory && qfCategory !== "all" ? [qfCategory] : [],
        priceBucket: qf.criteria.priceBucket || "all",
        tags: qf.criteria.tags || [],
        distance: state.distance,
        sort: state.sort,
        kindFilter: state.kindFilter,
      };
    }
  }

  return {
    timeWindow: state.timeWindow,
    categories: state.categories,
    priceBucket: state.priceBucket,
    tags: [],
    distance: state.distance,
    sort: state.sort,
    kindFilter: state.kindFilter,
  };
}

/**
 * Debug log filter state (only in debug mode)
 */
export function debugLogFilters(
  label: string,
  state: ExploreFilterState,
  extra?: Record<string, unknown>
): void {
  if (!EXPLORE_DEBUG_MODE) return;

  const effective = getEffectiveFilters(state);
  console.log(`[ExploreFilters] ${label}`, {
    raw: {
      quickFilter: state.quickFilter,
      categories: state.categories,
      priceBucket: state.priceBucket,
      timeWindow: state.timeWindow,
      distance: state.distance,
      sort: state.sort,
      page: state.page,
    },
    effective,
    ...extra,
  });
}

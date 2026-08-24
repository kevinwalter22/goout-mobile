/**
 * Explore Query Builder
 *
 * Translates filter state into Supabase queries.
 * Clear separation between filter state and query building.
 *
 * Uses availability_json for smart filtering of both:
 * - Events (specific dates via next_occurrence)
 * - Activities (availability patterns like "Daily, Year-round")
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  ExploreFilterState,
  TimeWindow,
  CategoryId,
  getQuickFilter,
} from "../config/exploreFilters";
import { getDistanceInMiles } from "../utils/location";

// ============================================================================
// TYPES
// ============================================================================

export interface QueryResult<T> {
  data: T[];
  count: number;
  hasMore: boolean;
  error: string | null;
}

export interface DateRange {
  start: Date;
  end: Date;
}

// ============================================================================
// CATEGORY MAPPING
// ============================================================================

/**
 * Map filter category IDs to actual database category values.
 * Database uses: "Outdoor", "Nightlife", "Winter Activities", "Arts & Culture",
 * "Sports & Recreation", "Food & Drink", "Anchor"
 */
const CATEGORY_ID_TO_DB: Record<string, string[]> = {
  outdoors: ["Outdoor"],
  music: ["Arts & Culture"],
  sports: ["Sports & Recreation"],
  arts: ["Arts & Culture"],
  entertainment: ["Arts & Culture", "Nightlife"],
  community: ["Anchor"],
  food: ["Food & Drink"],
  nightlife: ["Nightlife"],
};

/**
 * Convert a filter category ID to database category values
 */
export function mapCategoryToDb(categoryId: string): string[] {
  return CATEGORY_ID_TO_DB[categoryId] || [];
}

// ============================================================================
// DATE HELPERS
// ============================================================================

/**
 * Get today at midnight (start of day)
 */
function getStartOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get today at 11:59:59 PM (end of day)
 */
function getEndOfDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Get start of "tonight" (5 PM today)
 */
function getTonightStart(): Date {
  const d = getStartOfDay();
  d.setHours(17, 0, 0, 0);
  return d;
}

/**
 * Get start of this weekend (Saturday 00:00)
 */
function getWeekendStart(): Date {
  const d = getStartOfDay();
  const day = d.getDay();
  // If already weekend, use today
  if (day === 0) {
    // Sunday - use today
    return d;
  } else if (day === 6) {
    // Saturday - use today
    return d;
  } else {
    // Weekday - get next Saturday
    const daysUntilSaturday = 6 - day;
    d.setDate(d.getDate() + daysUntilSaturday);
    return d;
  }
}

/**
 * Get end of this weekend (Sunday 23:59)
 */
function getWeekendEnd(): Date {
  const d = getWeekendStart();
  // If Saturday, add 1 day for Sunday
  if (d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return getEndOfDay(d);
}

/**
 * Convert time window to date range
 */
export function getDateRangeForTimeWindow(timeWindow: TimeWindow): DateRange | null {
  const now = new Date();

  switch (timeWindow) {
    case "all":
      return null;

    case "today":
      return {
        start: getStartOfDay(),
        end: getEndOfDay(),
      };

    case "tonight":
      return {
        start: getTonightStart(),
        end: getEndOfDay(),
      };

    case "tomorrow": {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        start: getStartOfDay(tomorrow),
        end: getEndOfDay(tomorrow),
      };
    }

    case "this_weekend":
      return {
        start: getWeekendStart(),
        end: getWeekendEnd(),
      };

    case "this_week": {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      return {
        start: getStartOfDay(),
        end: getEndOfDay(weekEnd),
      };
    }

    case "this_month": {
      const monthEnd = new Date();
      monthEnd.setDate(monthEnd.getDate() + 30);
      return {
        start: getStartOfDay(),
        end: getEndOfDay(monthEnd),
      };
    }

    default:
      return null;
  }
}

// ============================================================================
// SEASON HELPER
// ============================================================================

/**
 * Get the current season based on the month.
 * Matches the Postgres get_current_season() function.
 */
function getCurrentSeason(): string {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}

// ============================================================================
// QUERY BUILDER
// ============================================================================

/**
 * Build and execute explore_items query from filter state.
 *
 * Uses availability_json for smart filtering:
 * - Events: Filtered by next_occurrence date
 * - Activities: Filtered by available_days pattern
 * - Season: Auto-filters by current season via availability_json
 *
 * Falls back to starts_at for non-enriched items.
 */
export async function queryExploreItems(
  supabase: SupabaseClient,
  filters: ExploreFilterState,
  userLocation?: { lat: number; lng: number } | null,
  userId?: string,
  regionId?: string | null
): Promise<QueryResult<any>> {
  const result = await queryExploreItemsRaw(supabase, filters, userLocation, userId, regionId);
  if (result.error) return result;
  const withEligible = await ensureCarouselEligibleItems(supabase, result.data, filters, regionId);
  if (withEligible.length === 0) return { ...result, data: withEligible };
  const withIntents = await attachItemIntents(supabase, withEligible);
  return { ...result, data: withIntents.map(attachCarouselCuration) };
}

/**
 * The cards view's single large-page fetch (see app/(tabs)/explore.tsx's
 * `pageSizeOverride: 200`) sorts "soonest" with no tiebreaker among the many
 * null-`starts_at` activities that share a `starts_at` value — hundreds of
 * Portland activities compete for the tail of that window, so the curated
 * `is_carousel_eligible` set (docs/intent_taxonomy.md §9, the exact items the
 * browse carousels are supposed to show) isn't guaranteed to land inside it.
 * Backfill any curated items missing from the fetched page so
 * groupItemsByIntent (groupingEngine.ts) always has the full curated pool to
 * filter/rank from. Gated to large-page fetches (>=100) — list view's small,
 * exact-count pages keep their existing pagination contract untouched.
 */
async function ensureCarouselEligibleItems(
  supabase: SupabaseClient,
  items: any[],
  filters: ExploreFilterState,
  regionId?: string | null
): Promise<any[]> {
  if (!regionId || filters.pageSize < 100 || filters.kindFilter === "event") return items;
  try {
    const existingIds = new Set(items.map((i) => i.id));
    const { data, error } = await supabase
      .from("explore_items")
      .select("*")
      .eq("region_id", regionId)
      .eq("is_carousel_eligible", true)
      .is("deleted_at", null)
      .eq("is_admin_suppressed", false)
      .eq("is_duplicate", false);
    if (error || !data) return items;
    const missing = data.filter((row: any) => !existingIds.has(row.id));
    return missing.length > 0 ? [...items, ...missing] : items;
  } catch {
    return items;
  }
}

/**
 * Two-surface curation columns (docs/intent_taxonomy.md §9): `is_carousel_eligible`
 * + `blended_notability`, persisted on explore_items and already returned by both
 * query paths below (`select("*")` / the RPC's `SELECT e.*`). supabase.ts codegen
 * is stale and doesn't declare these columns yet, so they're read off the raw row
 * via an unknown cast rather than blocking on a schema regen — the grouping engine
 * (groupingEngine.ts) uses them to filter/rank the browse carousels.
 */
interface CarouselCuration {
  is_carousel_eligible: boolean | null;
  blended_notability: number | null;
}

function attachCarouselCuration(item: any): any {
  const row = item as unknown as CarouselCuration;
  return {
    ...item,
    is_carousel_eligible: row.is_carousel_eligible ?? null,
    blended_notability: row.blended_notability ?? null,
  };
}

/**
 * Fetches each returned item's intents (slug, name, is_primary) from
 * item_intents so the grouping engine can build intent carousels
 * (docs/intent_taxonomy.md §4/§6). Failure here degrades to no intents
 * rather than breaking the underlying explore query.
 */
async function attachItemIntents(
  supabase: SupabaseClient,
  items: any[]
): Promise<any[]> {
  if (items.length === 0) return items;
  try {
    const { data: rows, error } = await supabase
      .from("item_intents")
      .select("item_id, is_primary, intents(slug, name)")
      .in(
        "item_id",
        items.map((i) => i.id)
      );
    if (error || !rows) return items.map((item) => ({ ...item, intents: [] }));

    const byItem = new Map<string, { slug: string; name: string; is_primary: boolean }[]>();
    for (const row of rows as any[]) {
      const intent = row.intents;
      if (!intent) continue;
      const list = byItem.get(row.item_id) || [];
      list.push({ slug: intent.slug, name: intent.name, is_primary: row.is_primary });
      byItem.set(row.item_id, list);
    }
    return items.map((item) => ({ ...item, intents: byItem.get(item.id) || [] }));
  } catch {
    return items.map((item) => ({ ...item, intents: [] }));
  }
}

async function queryExploreItemsRaw(
  supabase: SupabaseClient,
  filters: ExploreFilterState,
  userLocation?: { lat: number; lng: number } | null,
  userId?: string,
  regionId?: string | null
): Promise<QueryResult<any>> {
  try {
    // Debug: Log filter state
    console.log("[ExploreQuery] Starting query with filters:", {
      quickFilter: filters.quickFilter,
      categories: filters.categories,
      timeWindow: filters.timeWindow,
      page: filters.page,
    });

    // Determine effective filters (from quick filter or advanced)
    let effectiveTimeWindow: TimeWindow = "all";
    let effectiveCategories: CategoryId[] = [];
    let effectivePriceBucket: string = "all";
    let effectiveTags: string[] = [];

    if (filters.quickFilter) {
      const qf = getQuickFilter(filters.quickFilter);
      if (qf?.criteria) {
        effectiveTimeWindow = qf.criteria.timeWindow || "all";
        const qfCat = qf.criteria.category;
        effectiveCategories = qfCat && qfCat !== "all" ? [qfCat] : [];
        effectivePriceBucket = qf.criteria.priceBucket || "all";
        effectiveTags = qf.criteria.tags || [];
      }
    } else {
      effectiveTimeWindow = filters.timeWindow;
      effectiveCategories = filters.categories;
      effectivePriceBucket = filters.priceBucket;
    }

    // Get date range for time window
    const dateRange = getDateRangeForTimeWindow(effectiveTimeWindow);

    // Map all selected categories to DB values, deduplicated
    let dbCategories: string[] | null = null;
    if (effectiveCategories.length > 0) {
      const allDbCats = effectiveCategories.flatMap((c) => mapCategoryToDb(c));
      const unique = [...new Set(allDbCats)];
      dbCategories = unique.length > 0 ? unique : null;
    }

    // "music" as the sole selected category implies music-specific tags — without
    // this, it returns all Arts & Culture (museums, galleries, theater).
    // When combined with other categories, skip the tag injection so it doesn't
    // narrow results that should include non-music arts items.
    if (effectiveCategories.length === 1 && effectiveCategories[0] === "music" && effectiveTags.length === 0) {
      effectiveTags = ["live_music", "concert"];
    }

    // Tags are passed directly to the RPC for array overlap filtering
    // (no longer mapped to categories — tags and categories are independent filters)
    const dbTags: string[] | null = effectiveTags.length > 0 ? effectiveTags : null;

    console.log("[ExploreQuery] Effective filters:", {
      timeWindow: effectiveTimeWindow,
      dateRange: dateRange ? { start: dateRange.start.toISOString(), end: dateRange.end.toISOString() } : null,
      effectiveCategories,
      dbCategories,
      tags: dbTags,
      priceBucket: effectivePriceBucket,
    });

    // ========================================
    // Try RPC-based query first (availability-aware)
    // Falls back to simple query if RPC not available
    // ========================================
    const offset = filters.page * filters.pageSize;

    // Distance sort requires client-side ordering (no PostGIS).
    // Overfetch all matching rows so we can sort by distance and slice to the correct page.
    const DISTANCE_OVERFETCH_CAP = 500;
    const isDistanceSort = filters.sort === "distance" && !!userLocation;

    // Always pass season for availability-aware filtering
    const currentSeason = getCurrentSeason();

    // When a text search is active, skip the RPC (it doesn't support text search)
    // and fall through to the fallback query that supports ILIKE filtering.
    const searchQuery = filters.searchQuery?.trim() ?? "";

    // Attempt RPC query when date range or tags are active (and no text search)
    if (!searchQuery && (dateRange || dbTags)) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          "filter_explore_items",
          {
            p_range_start: dateRange ? dateRange.start.toISOString().split("T")[0] : null,
            p_range_end: dateRange ? dateRange.end.toISOString().split("T")[0] : null,
            p_categories: dbCategories,
            p_price_bucket: effectivePriceBucket !== "all" ? effectivePriceBucket : null,
            p_time_of_day: null,
            p_tags: dbTags,
            p_season: currentSeason,
            p_limit: isDistanceSort ? DISTANCE_OVERFETCH_CAP : filters.pageSize,
            p_offset: isDistanceSort ? 0 : offset,
            p_region_id: regionId ?? null,
          }
        );

        // Get count separately
        const { data: countData } = await supabase.rpc(
          "count_filtered_explore_items",
          {
            p_range_start: dateRange ? dateRange.start.toISOString().split("T")[0] : null,
            p_range_end: dateRange ? dateRange.end.toISOString().split("T")[0] : null,
            p_categories: dbCategories,
            p_price_bucket: effectivePriceBucket !== "all" ? effectivePriceBucket : null,
            p_time_of_day: null,
            p_tags: dbTags,
            p_season: currentSeason,
            p_region_id: regionId ?? null,
          }
        );

        if (!rpcError && rpcData) {
          console.log("[ExploreQuery] RPC query successful:", {
            count: countData,
            dataLength: rpcData.length,
          });

          // Errand/chain gate (three-view model): the RPC path returns full rows, so
          // filter out non-places (is_place=false). Defensive `!== false` degrades to
          // fallback behavior if a not-yet-migrated RPC omits the column.
          let filteredData = (rpcData as any[]).filter((item: any) => item.is_place !== false);

          // Apply kind filter (client-side since RPC doesn't support it)
          if (filters.kindFilter !== "all") {
            filteredData = filteredData.filter((item: any) => item.kind === filters.kindFilter);
          }

          // Apply distance filter/sort on all fetched rows
          const sortedData = applyDistanceFilter(filteredData, userLocation, filters);

          if (isDistanceSort) {
            // Slice to the correct page from the fully-sorted window
            const page = sortedData.slice(offset, offset + filters.pageSize);
            return {
              data: page,
              count: sortedData.length,
              hasMore: offset + filters.pageSize < sortedData.length,
              error: null,
            };
          }

          const dbTotalCount = countData || rpcData.length;
          const isDistanceFiltering = userLocation && filters.distance !== "any";
          const gotFullPage = rpcData.length >= filters.pageSize;

          return {
            data: sortedData,
            count: isDistanceFiltering ? sortedData.length : dbTotalCount,
            hasMore: isDistanceFiltering
              ? gotFullPage
              : filteredData.length > 0 && offset + filteredData.length < dbTotalCount,
            error: null,
          };
        }

        // RPC failed, fall through to simple query
        console.log("[ExploreQuery] RPC failed, falling back to simple query:", rpcError?.message);
      } catch (rpcErr) {
        console.log("[ExploreQuery] RPC not available, using simple query");
      }
    }

    // ========================================
    // Fallback: Simple query (non-availability-aware)
    // Used when RPC not available or no time filter
    // ========================================
    let query = supabase
      .from("explore_items")
      .select("*", { count: "exact" })
      .is("deleted_at", null) // Soft delete gate
      .eq("is_admin_suppressed", false) // Admin suppression gate
      .gte("priority", 0) // Exclude stale/demoted items (priority = -1)
      .eq("is_duplicate", false) // Exclude cross-source duplicates
      .eq("is_place", true) // Errand/chain gate: real places only (migration 171, item_intents source of truth)
      .or("normalized_confidence.is.null,normalized_confidence.gte.40") // Quality gate
      .or(
        userId
          ? `review_status.is.null,review_status.in.(auto_approved,approved),created_by_user_id.eq.${userId}`
          : "review_status.is.null,review_status.in.(auto_approved,approved)"
      ); // Quarantine gate (include creator's own items)

    // Upcoming-only filter (two independent gates, ANDed):
    //  (1) inclusion by starts_at — keep null-start activities + a 3h grace for just-started /
    //      in-progress events (multi-day festivals still drop after day-1, per migration 134);
    //  (2) exclusion by ends_at — anything that has ENDED (ends_at < now) never appears.
    // We only EXCLUDE on ends_at, never INCLUDE on it, so a bad far-future "listing-expiry" end
    // date can't resurrect a past event (the starts_at grace still bounds inclusion). This is what
    // stops a just-ended event from floating to the top of What's Happening under soonest-first.
    const now = new Date().toISOString();
    const pastCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    query = query
      .or(`starts_at.is.null,starts_at.gte.${pastCutoff}`)
      .or(`ends_at.is.null,ends_at.gte.${now}`);

    // Apply time filter (simple version - includes all activities)
    if (dateRange) {
      // Include: events in date range OR activities (no starts_at)
      query = query.or(
        `and(starts_at.gte.${dateRange.start.toISOString()},starts_at.lte.${dateRange.end.toISOString()}),starts_at.is.null`
      );
    }

    // Apply the hard region boundary (mirrors the RPC's p_region_id).
    if (regionId) {
      query = query.eq("region_id", regionId);
    }

    // Apply category filter
    if (dbCategories && dbCategories.length > 0) {
      query = query.in("category", dbCategories);
    }

    // Apply tag filter (array overlap)
    if (dbTags && dbTags.length > 0) {
      query = query.overlaps("tags", dbTags);
    }

    // Apply price filter
    if (effectivePriceBucket !== "all") {
      query = query.eq("price_bucket", effectivePriceBucket);
    }

    // Apply kind filter (activity vs event)
    if (filters.kindFilter !== "all") {
      query = query.eq("kind", filters.kindFilter);
    }

    // Apply sorting
    switch (filters.sort) {
      case "soonest":
        query = query.order("starts_at", { ascending: true, nullsFirst: false });
        break;
      case "priority":
        query = query
          .order("priority", { ascending: false })
          .order("starts_at", { ascending: true, nullsFirst: false });
        break;
      case "distance":
        query = query
          .order("priority", { ascending: false })
          .order("starts_at", { ascending: true, nullsFirst: false });
        break;
      case "notability":
        // LIST view interim ordering (three-view model). Placeholder for the Phase-3
        // SOCIAL ranking — see LIST_INTERIM_SORT in config/exploreFilters.ts.
        query = query
          .order("blended_notability", { ascending: false, nullsFirst: false })
          .order("priority", { ascending: false });
        break;
    }

    // Apply text search (title or location name ILIKE match)
    if (searchQuery) {
      const q = `%${searchQuery.replace(/%/g, "\\%")}%`;
      query = query.or(`title.ilike.${q},location_name.ilike.${q}`);
    }

    // Apply pagination (overfetch when distance sorting for stable client-side order)
    if (isDistanceSort) {
      query = query.range(0, DISTANCE_OVERFETCH_CAP - 1);
    } else {
      query = query.range(offset, offset + filters.pageSize - 1);
    }

    // Execute query
    const { data, error, count } = await query;

    console.log("[ExploreQuery] Simple query result:", {
      count,
      dataLength: data?.length || 0,
      error: error?.message,
      categories: data ? [...new Set(data.map((item: any) => item.category))] : [],
    });

    if (error) {
      return {
        data: [],
        count: 0,
        hasMore: false,
        error: error.message,
      };
    }

    const sortedData = applyDistanceFilter(data || [], userLocation, filters);

    if (isDistanceSort) {
      // Slice to correct page from the fully-sorted window
      const page = sortedData.slice(offset, offset + filters.pageSize);
      return {
        data: page,
        count: sortedData.length,
        hasMore: offset + filters.pageSize < sortedData.length,
        error: null,
      };
    }

    const dbTotalCount = count || 0;
    const isDistanceFiltering = userLocation && filters.distance !== "any";
    const gotFullPage = (data?.length || 0) >= filters.pageSize;

    return {
      data: sortedData,
      count: isDistanceFiltering ? sortedData.length : dbTotalCount,
      hasMore: isDistanceFiltering ? gotFullPage : offset + (data?.length || 0) < dbTotalCount,
      error: null,
    };
  } catch (err) {
    return {
      data: [],
      count: 0,
      hasMore: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Map filter tags to database category values
 */
export function mapTagsToCategories(tags: string[]): string[] {
  const tagToCategoryMap: Record<string, string[]> = {
    outdoors: ["Outdoor"],
    hiking: ["Outdoor", "Anchor"],
    nature: ["Outdoor"],
    parks: ["Outdoor"],
    music: ["Arts & Culture", "Nightlife"],
    sports: ["Sports & Recreation"],
    arts: ["Arts & Culture"],
    entertainment: ["Arts & Culture", "Nightlife"],
    community: ["Anchor"],
    food: ["Food & Drink"],
    nightlife: ["Nightlife"],
  };

  const categoryMatches: string[] = [];
  for (const tag of tags) {
    const mapped = tagToCategoryMap[tag.toLowerCase()];
    if (mapped) {
      categoryMatches.push(...mapped);
    }
  }

  return [...new Set(categoryMatches)];
}

/**
 * Apply distance filtering and sorting (client-side)
 *
 * Filtering and sorting are independent:
 * - Filtering: Only applied when a distance radius is set (not "any")
 * - Sorting: Applied whenever sort is "distance" and we have user location
 */
export function applyDistanceFilter(
  data: any[],
  userLocation: { lat: number; lng: number } | null | undefined,
  filters: ExploreFilterState
): any[] {
  if (!userLocation || data.length === 0) {
    return data;
  }

  // Step 1: Distance gate (architectural floor, not an opt-in).
  //
  // When the user has a location, the default feed always applies a 50mi
  // cap + a null-coord exclusion — even if filters.distance is "any". The
  // earlier "any" → no-filter path let null-coord Potsdam events leak into
  // the Warwick feed.
  //
  // Override semantics:
  //   - Active search → no distance filter at all (user is asking to look
  //     beyond their region; e.g., "find me a venue I visited in NYC").
  //   - Explicit narrower radius (5mi, 25mi) → respected.
  //   - filters.distance === "any" → silently treated as the 50mi default.
  const DEFAULT_FLOOR_MILES = 50;
  const searchActive = (filters.searchQuery?.trim().length ?? 0) > 0;
  let result = data;
  if (!searchActive) {
    const maxDistance =
      filters.distance !== "any" ? (filters.distance as number) : DEFAULT_FLOOR_MILES;
    result = data.filter((item) => {
      if (!item.lat || !item.lng) return false;
      const dist = getDistanceInMiles(
        userLocation.lat,
        userLocation.lng,
        item.lat,
        item.lng
      );
      return dist <= maxDistance;
    });
  }

  // Step 2: Apply distance sorting (whenever sort is "distance", regardless of filter)
  // Uses deterministic tie-breaker (starts_at, then id) for stable pagination
  if (filters.sort === "distance") {
    result.sort((a, b) => {
      if (!a.lat || !a.lng) return 1;
      if (!b.lat || !b.lng) return -1;
      const distA = getDistanceInMiles(userLocation.lat, userLocation.lng, a.lat, a.lng);
      const distB = getDistanceInMiles(userLocation.lat, userLocation.lng, b.lat, b.lng);
      if (distA !== distB) return distA - distB;
      // Tie-breaker 1: starts_at (nulls last)
      if (a.starts_at && b.starts_at) {
        const timeDiff = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
        if (timeDiff !== 0) return timeDiff;
      }
      if (a.starts_at && !b.starts_at) return -1;
      if (!a.starts_at && b.starts_at) return 1;
      // Tie-breaker 2: id (guaranteed unique)
      return (a.id || "").localeCompare(b.id || "");
    });
  }

  return result;
}

// ============================================================================
// PREBUILT QUERIES
// ============================================================================

/**
 * Get upcoming events (simple query for home/preview)
 */
export async function getUpcomingEvents(
  supabase: SupabaseClient,
  limit: number = 10
): Promise<QueryResult<any>> {
  const now = new Date().toISOString();

  const { data, error, count } = await supabase
    .from("explore_items")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .gte("starts_at", now)
    .order("starts_at", { ascending: true })
    .limit(limit);

  return {
    data: data || [],
    count: count || 0,
    hasMore: (count || 0) > limit,
    error: error?.message || null,
  };
}

/**
 * Get featured/anchor events
 */
export async function getFeaturedEvents(
  supabase: SupabaseClient,
  limit: number = 5
): Promise<QueryResult<any>> {
  const now = new Date().toISOString();

  const { data, error, count } = await supabase
    .from("explore_items")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .eq("is_anchor", true)
    .gte("starts_at", now)
    .order("starts_at", { ascending: true })
    .limit(limit);

  return {
    data: data || [],
    count: count || 0,
    hasMore: (count || 0) > limit,
    error: error?.message || null,
  };
}

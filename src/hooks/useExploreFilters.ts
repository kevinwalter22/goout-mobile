/**
 * Explore Filters Hook
 *
 * Manages filter state and provides methods to update filters.
 * Triggers immediate query updates when filters change.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { queryExploreItems, QueryResult } from "../lib/exploreQuery";
import {
  ExploreFilterState,
  DEFAULT_FILTER_STATE,
  QuickFilterId,
  CategoryId,
  PriceBucket,
  TimeWindow,
  DistanceRadius,
  SortOption,
  KindFilter,
  hasActiveFilters,
  getFilterSummary,
  debugLogFilters,
  getEffectiveFilters,
  EXPLORE_DEBUG_MODE,
} from "../config/exploreFilters";
import type { ExploreItem } from "../types/database";

// ============================================================================
// TYPES
// ============================================================================

export interface UseExploreFiltersReturn {
  // Filter state
  filters: ExploreFilterState;
  hasFilters: boolean;
  filterSummary: string;

  // Filter actions
  setQuickFilter: (id: QuickFilterId | null) => void;
  toggleQuickFilter: (id: QuickFilterId) => void;
  setKindFilter: (kind: KindFilter) => void;
  setCategory: (category: CategoryId) => void;
  setPriceBucket: (price: PriceBucket) => void;
  setTimeWindow: (time: TimeWindow) => void;
  setDistance: (distance: DistanceRadius) => void;
  setSort: (sort: SortOption) => void;
  setSearchQuery: (q: string) => void;
  resetFilters: () => void;
  resetAdvancedFilters: () => void;

  // Results
  items: ExploreItem[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  hasMore: boolean;

  // Pagination
  loadMore: () => void;
  refresh: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useExploreFilters(
  userLocation?: { lat: number; lng: number } | null,
  options?: { pageSizeOverride?: number }
): UseExploreFiltersReturn {
  const { user } = useAuth();

  // Filter state
  const [filters, setFilters] = useState<ExploreFilterState>(DEFAULT_FILTER_STATE);

  // Results state
  const [items, setItems] = useState<ExploreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Track query version to avoid stale updates
  const queryVersion = useRef(0);

  // ========================================
  // Query execution
  // ========================================

  const executeQuery = useCallback(
    async (filterState: ExploreFilterState, append: boolean = false) => {
      const thisVersion = ++queryVersion.current;

      // Debug: Log query execution
      debugLogFilters("executeQuery", filterState, {
        queryVersion: thisVersion,
        append,
        userLocation: userLocation ? "provided" : "none",
      });

      setLoading(true);
      if (!append) {
        setError(null);
      }
      const _t0 = __DEV__ ? performance.now() : 0;

      try {
        const queryFilters = options?.pageSizeOverride
          ? { ...filterState, pageSize: options.pageSizeOverride }
          : filterState;
        const result: QueryResult<ExploreItem> = await queryExploreItems(
          supabase,
          queryFilters,
          userLocation,
          user?.id
        );

        // Check if this is still the latest query
        if (thisVersion !== queryVersion.current) {
          return;
        }

        if (result.error) {
          setError(result.error);
          if (!append) {
            setItems([]);
            setTotalCount(0);
            setHasMore(false);
          }
        } else {
          if (append) {
            // Deduplicate items by ID to prevent duplicate key errors
            setItems((prev) => {
              const existingIds = new Set(prev.map((item) => item.id));
              const newItems = result.data.filter(
                (item) => !existingIds.has(item.id)
              );
              const combined = [...prev, ...newItems];

              // Debug: Log pagination
              if (EXPLORE_DEBUG_MODE) {
                console.log("[ExploreFilters] Pagination append", {
                  prevCount: prev.length,
                  newCount: newItems.length,
                  totalLoaded: combined.length,
                  totalCount: result.count,
                  hasMore: result.hasMore,
                });
              }

              return combined;
            });
          } else {
            setItems(result.data);

            // Debug: Log initial load
            if (EXPLORE_DEBUG_MODE) {
              console.log("[ExploreFilters] Initial load", {
                loadedCount: result.data.length,
                totalCount: result.count,
                hasMore: result.hasMore,
              });
            }
          }
          setTotalCount(result.count);
          setHasMore(result.hasMore);
          setError(null);
          if (__DEV__) {
            console.log(`[Explore] ${append ? "page" : "load"}: ${result.data.length} items in ${(performance.now() - _t0).toFixed(0)}ms`);
          }
        }
      } catch (err) {
        if (thisVersion === queryVersion.current) {
          setError(err instanceof Error ? err.message : "Unknown error");
          if (!append) {
            setItems([]);
          }
        }
      } finally {
        if (thisVersion === queryVersion.current) {
          setLoading(false);
        }
      }
    },
    [userLocation]
  );

  // ========================================
  // Initial load and location change handling
  // ========================================

  // Track if we've done initial load
  const hasLoadedRef = useRef(false);
  // Track previous location for comparison
  const prevLocationRef = useRef<{ lat: number; lng: number } | null | undefined>(undefined);

  useEffect(() => {
    // Initial load (no location yet or location already available)
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      executeQuery(filters, false);
      prevLocationRef.current = userLocation;
      return;
    }

    // Skip if location hasn't meaningfully changed
    const prevLoc = prevLocationRef.current;
    const locChanged =
      (prevLoc === null && userLocation !== null) ||
      (prevLoc === undefined && userLocation !== undefined) ||
      (prevLoc && userLocation && (
        Math.abs(prevLoc.lat - userLocation.lat) > 0.001 ||
        Math.abs(prevLoc.lng - userLocation.lng) > 0.001
      ));

    if (!locChanged) {
      return;
    }

    // Debounce location changes to avoid over-querying
    const timeoutId = setTimeout(() => {
      prevLocationRef.current = userLocation;
      // Re-run query with current filters when location changes
      executeQuery(filters, false);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [userLocation, executeQuery, filters]);

  // ========================================
  // Filter update helper
  // ========================================

  const updateFiltersAndQuery = useCallback(
    (newFilters: ExploreFilterState) => {
      setFilters(newFilters);
      executeQuery(newFilters, false);
    },
    [executeQuery]
  );

  // ========================================
  // Filter actions
  // ========================================

  const setQuickFilter = useCallback(
    (id: QuickFilterId | null) => {
      const newFilters: ExploreFilterState = {
        ...filters,
        quickFilter: id,
        // Clear advanced filters when setting quick filter
        ...(id
          ? {
              category: "all" as CategoryId,
              priceBucket: "all" as PriceBucket,
              timeWindow: "all" as TimeWindow,
            }
          : {}),
        page: 0,
      };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const toggleQuickFilter = useCallback(
    (id: QuickFilterId) => {
      const isCurrentlyActive = filters.quickFilter === id;
      const newFilters: ExploreFilterState = {
        ...filters,
        quickFilter: isCurrentlyActive ? null : id,
        // Clear advanced filters when setting quick filter
        ...(!isCurrentlyActive
          ? {
              category: "all" as CategoryId,
              priceBucket: "all" as PriceBucket,
              timeWindow: "all" as TimeWindow,
            }
          : {}),
        page: 0,
      };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const setCategory = useCallback(
    (category: CategoryId) => {
      const newFilters: ExploreFilterState = {
        ...filters,
        category,
        quickFilter: null,
        page: 0,
      };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const setPriceBucket = useCallback(
    (priceBucket: PriceBucket) => {
      const newFilters: ExploreFilterState = {
        ...filters,
        priceBucket,
        quickFilter: null,
        page: 0,
      };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const setTimeWindow = useCallback(
    (timeWindow: TimeWindow) => {
      const newFilters: ExploreFilterState = {
        ...filters,
        timeWindow,
        quickFilter: null,
        page: 0,
      };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const setDistance = useCallback(
    (distance: DistanceRadius) => {
      const newFilters: ExploreFilterState = {
        ...filters,
        distance,
        page: 0,
      };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const setSort = useCallback(
    (sort: SortOption) => {
      const newFilters: ExploreFilterState = {
        ...filters,
        sort,
        page: 0,
      };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const setKindFilter = useCallback(
    (kindFilter: KindFilter) => {
      const newFilters: ExploreFilterState = {
        ...filters,
        kindFilter,
        page: 0,
        // Activities don't have start times, so "nearest" makes more sense
        // Also clear time filters since they don't apply to activities
        ...(kindFilter === "activity"
          ? {
              sort: "distance" as const,
              timeWindow: "all" as const,
            }
          : {}),
        // When switching back from activities, restore default sort if it was "distance"
        ...(kindFilter !== "activity" && filters.kindFilter === "activity" && filters.sort === "distance"
          ? { sort: "soonest" as const }
          : {}),
      };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const setSearchQuery = useCallback(
    (searchQuery: string) => {
      const newFilters: ExploreFilterState = { ...filters, searchQuery, page: 0 };
      updateFiltersAndQuery(newFilters);
    },
    [filters, updateFiltersAndQuery]
  );

  const resetFilters = useCallback(() => {
    updateFiltersAndQuery({ ...DEFAULT_FILTER_STATE });
  }, [updateFiltersAndQuery]);

  const resetAdvancedFilters = useCallback(() => {
    const newFilters: ExploreFilterState = {
      ...filters,
      quickFilter: null,
      kindFilter: "all",
      category: "all",
      priceBucket: "all",
      timeWindow: "all",
      distance: 50,
      page: 0,
    };
    updateFiltersAndQuery(newFilters);
  }, [filters, updateFiltersAndQuery]);

  // ========================================
  // Pagination
  // ========================================

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;

    const newFilters = { ...filters, page: filters.page + 1 };
    setFilters(newFilters);
    executeQuery(newFilters, true);
  }, [loading, hasMore, filters, executeQuery]);

  const refresh = useCallback(() => {
    const newFilters = { ...filters, page: 0 };
    setFilters(newFilters);
    executeQuery(newFilters, false);
  }, [filters, executeQuery]);

  // ========================================
  // Computed values
  // ========================================

  const hasFiltersActive = hasActiveFilters(filters);
  const filterSummaryText = getFilterSummary(filters);

  return {
    // Filter state
    filters,
    hasFilters: hasFiltersActive,
    filterSummary: filterSummaryText,

    // Filter actions
    setQuickFilter,
    toggleQuickFilter,
    setKindFilter,
    setCategory,
    setPriceBucket,
    setTimeWindow,
    setDistance,
    setSort,
    setSearchQuery,
    resetFilters,
    resetAdvancedFilters,

    // Results
    items,
    loading,
    error,
    totalCount,
    hasMore,

    // Pagination
    loadMore,
    refresh,
  };
}

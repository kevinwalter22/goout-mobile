/**
 * useGroupedExplore Hook
 *
 * Bridges scored items from useRecommender into grouped card data
 * using the pure groupingEngine.
 */

import { useMemo } from "react";
import type { ScoredItem, WeatherCondition } from "../lib/scoring";
import {
  groupItems,
  type GroupingResult,
} from "../lib/groupingEngine";
import type { GroupingContext } from "../config/groupTaxonomy";

export interface UseGroupedExploreParams {
  items: ScoredItem[];
  postableNowItems: ScoredItem[];
  weather: WeatherCondition | null;
  userLocation: { lat: number; lng: number } | null;
  kindFilter: "all" | "event" | "activity";
}

export function useGroupedExplore({
  items,
  postableNowItems,
  weather,
  userLocation,
  kindFilter,
}: UseGroupedExploreParams): GroupingResult {
  return useMemo(() => {
    const ctx: GroupingContext = {
      now: new Date(),
      weather,
      userLocation,
      kindFilter,
    };
    return groupItems(items, postableNowItems, ctx);
  }, [items, postableNowItems, weather, userLocation, kindFilter]);
}

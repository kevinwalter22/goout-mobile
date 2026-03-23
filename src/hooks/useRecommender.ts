/**
 * Recommender Hook
 *
 * Wraps useExploreFilters with recommendation scoring.
 * Fetches additional context (weather, friends, affinity) and applies scoring.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useExploreFilters, UseExploreFiltersReturn } from "./useExploreFilters";
import { useAuth } from "./useAuth";
import { useWeather, WeatherData } from "./useWeather";
import { useFeatureFlags } from "./useFeatureFlags";
import { supabase } from "../lib/supabase";
import {
  scoreAndRankItems,
  ScoredItem,
  ScoringContext,
  WeatherCondition,
  getTimeOfDay,
  getDayOfWeek,
} from "../lib/scoring";
import { RECOMMENDER_CONFIG } from "../config/recommenderConfig";
import type { ExploreItem } from "../types/database";

// ============================================================================
// Types
// ============================================================================

export interface UseRecommenderOptions {
  /** Enable recommendation scoring (default: true) */
  enableScoring?: boolean;
  /** Enable LLM reranking for top K items (default: false, behind feature flag) */
  enableLLMReranker?: boolean;
  /** Override page size for initial fetch (e.g., 200 for cards mode) */
  pageSizeOverride?: number;
}

export interface UseRecommenderReturn extends Omit<UseExploreFiltersReturn, "items"> {
  /** Items with recommendation scores applied */
  items: ScoredItem[];
  /** Raw items without scoring (from useExploreFilters) */
  rawItems: ExploreItem[];
  /** Current weather data */
  weather: WeatherData | null;
  /** Loaded feature flags */
  featureFlags: Map<string, boolean>;
  /** Whether scoring is currently enabled */
  scoringEnabled: boolean;
  /** Request LLM reranking (if enabled) */
  requestLLMRerank: () => Promise<void>;
  /** Whether LLM rerank is in progress */
  reranking: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export function useRecommender(
  userLocation?: { lat: number; lng: number } | null,
  options: UseRecommenderOptions = {}
): UseRecommenderReturn {
  const { enableScoring = true, enableLLMReranker = false, pageSizeOverride } = options;

  const { user } = useAuth();
  const exploreFilters = useExploreFilters(userLocation, { pageSizeOverride });
  const { weather } = useWeather(userLocation);
  const { flags: featureFlags } = useFeatureFlags();

  // Additional context state
  const [userTagAffinity, setUserTagAffinity] = useState<Map<string, number>>(new Map());
  const [userTypeAffinity, setUserTypeAffinity] = useState<{
    eventBias: number;
    activityBias: number;
    totalInteractions: number;
  } | null>(null);
  const [friendsGoingMap, setFriendsGoingMap] = useState<Map<string, number>>(new Map());
  const [communityFeedbackMap, setCommunityFeedbackMap] = useState<Map<string, number>>(new Map());
  const [rerankedItems, setRerankedItems] = useState<ScoredItem[] | null>(null);
  const [reranking, setReranking] = useState(false);

  // ========================================
  // Load user tag affinity
  // ========================================

  useEffect(() => {
    if (!user) return;
    if (!featureFlags.get(RECOMMENDER_CONFIG.FLAGS.TAG_AFFINITY)) return;

    async function loadAffinity() {
      try {
        const { data, error } = await supabase.rpc("get_user_tag_affinity", {
          p_user_id: user!.id,
          p_limit: RECOMMENDER_CONFIG.TAG_AFFINITY.MAX_TAGS,
        });

        if (error) {
          // Table might not exist yet
          console.log("[useRecommender] Tag affinity not available:", error.message);
          return;
        }

        if (data) {
          setUserTagAffinity(new Map(data.map((d: any) => [d.tag, d.score])));
        }
      } catch (err) {
        console.log("[useRecommender] Failed to load tag affinity:", err);
      }
    }
    loadAffinity();
  }, [user, featureFlags]);

  // ========================================
  // Load user type affinity (event vs activity preference)
  // ========================================

  useEffect(() => {
    if (!user) return;
    if (!featureFlags.get(RECOMMENDER_CONFIG.FLAGS.TYPE_AFFINITY_LEARNING)) return;

    async function loadTypeAffinity() {
      try {
        const { data, error } = await supabase.rpc("get_user_type_affinity", {
          p_user_id: user!.id,
        });

        if (error) {
          console.log("[useRecommender] Type affinity not available:", error.message);
          return;
        }

        if (data && data.length > 0) {
          const row = data[0];
          setUserTypeAffinity({
            eventBias: row.event_bias,
            activityBias: row.activity_bias,
            totalInteractions: row.total_interactions,
          });
        }
      } catch (err) {
        console.log("[useRecommender] Failed to load type affinity:", err);
      }
    }
    loadTypeAffinity();
  }, [user, featureFlags]);

  // ========================================
  // Load friends going counts for visible items
  // ========================================

  useEffect(() => {
    if (!user) return;
    if (exploreFilters.items.length === 0) return;
    if (!featureFlags.get(RECOMMENDER_CONFIG.FLAGS.FRIENDS_BOOST)) return;

    async function loadFriendsGoing() {
      try {
        const itemIds = exploreFilters.items.map((i) => i.id);
        const { data, error } = await supabase.rpc("get_friends_going_for_items", {
          p_user_id: user!.id,
          p_item_ids: itemIds,
        });

        if (error) {
          // RPC might not exist yet
          console.log("[useRecommender] Friends going RPC not available:", error.message);
          return;
        }

        if (data) {
          setFriendsGoingMap(
            new Map(data.map((d: any) => [d.explore_item_id, d.friends_going_count]))
          );
        }
      } catch (err) {
        console.log("[useRecommender] Failed to load friends going:", err);
      }
    }
    loadFriendsGoing();
  }, [user, exploreFilters.items, featureFlags]);

  // ========================================
  // Load community feedback scores for visible items
  // ========================================

  useEffect(() => {
    if (exploreFilters.items.length === 0) return;
    if (!featureFlags.get(RECOMMENDER_CONFIG.FLAGS.COMMUNITY_FEEDBACK)) return;

    async function loadFeedbackScores() {
      try {
        const itemIds = exploreFilters.items.map((i) => i.id);
        const { data, error } = await supabase.rpc("get_item_feedback_scores", {
          p_item_ids: itemIds,
        });

        if (error) {
          console.log("[useRecommender] Feedback scores not available:", error.message);
          return;
        }

        if (data) {
          setCommunityFeedbackMap(
            new Map(data.map((d: any) => [d.explore_item_id, d.net_score]))
          );
        }
      } catch (err) {
        console.log("[useRecommender] Failed to load feedback scores:", err);
      }
    }
    loadFeedbackScores();
  }, [exploreFilters.items, featureFlags]);

  // ========================================
  // Build scoring context
  // ========================================

  // Current kind filter from explore (needed for context intent gating)
  const kindFilter = exploreFilters.filters.kindFilter;

  const scoringContext = useMemo<ScoringContext>(
    () => ({
      userLocation,
      currentTime: new Date(),
      friendsGoingMap,
      userTagAffinity,
      userTypeAffinity,
      communityFeedbackMap,
      weather: weather
        ? {
            isRaining: weather.isRaining,
            isSunny: weather.isSunny,
            temperature: weather.temperature,
          }
        : null,
      featureFlags,
      kindFilter,
    }),
    [userLocation, friendsGoingMap, userTagAffinity, userTypeAffinity, communityFeedbackMap, weather, featureFlags, kindFilter]
  );

  // ========================================
  // Apply deterministic scoring
  // ========================================

  const scoredItems = useMemo<ScoredItem[]>(() => {
    // Clear reranked items when base items change
    setRerankedItems(null);

    if (!enableScoring) {
      // Return items with default scores
      return exploreFilters.items.map((item) => ({
        ...item,
        recommendScore: 0,
        scoreBreakdown: {
          timeMatch: 0,
          distance: 0,
          openNow: 0,
          friendsGoing: 0,
          tagAffinity: 0,
          weather: 0,
          contextIntent: 0,
          typeAffinity: 0,
          quality: 0,
          communityFeedback: 0,
          freshness: 0,
          total: 0,
        },
      }));
    }

    return scoreAndRankItems(exploreFilters.items, scoringContext);
  }, [exploreFilters.items, scoringContext, enableScoring]);

  // ========================================
  // Optional LLM reranking
  // ========================================

  const requestLLMRerank = useCallback(async () => {
    if (!enableLLMReranker) return;
    if (!featureFlags.get(RECOMMENDER_CONFIG.FLAGS.LLM_RERANKER)) return;
    if (scoredItems.length < 5) return;
    if (reranking) return;

    setReranking(true);

    try {
      const topK = scoredItems.slice(0, RECOMMENDER_CONFIG.LLM_RERANKER.TOP_K);

      const { data, error } = await supabase.functions.invoke("rerank-explore-items", {
        body: {
          user_id: user?.id,
          items: topK.map((i) => ({
            id: i.id,
            title: i.title,
            category: i.category,
            tags: i.tags,
            base_score: i.recommendScore,
          })),
          context: {
            time_of_day: getTimeOfDay(new Date()),
            day_of_week: getDayOfWeek(new Date()),
            weather: weather?.description || "unknown",
          },
        },
      });

      if (error) {
        console.log("[useRecommender] LLM rerank failed:", error);
        return;
      }

      if (data?.reranked) {
        // Merge reranked top K with remaining items
        const rerankedMap = new Map<string, { rank: number; reason: string }>(
          data.reranked.map((r: any, i: number) => [r.id, { rank: i, reason: r.reason }])
        );

        const rerankedTopK = [...topK].sort((a, b) => {
          const rankA = rerankedMap.get(a.id)?.rank ?? 999;
          const rankB = rerankedMap.get(b.id)?.rank ?? 999;
          return rankA - rankB;
        });

        // Add reasons to items
        for (const item of rerankedTopK) {
          const reranked = rerankedMap.get(item.id);
          if (reranked?.reason) {
            (item as any).llmReason = reranked.reason;
          }
        }

        setRerankedItems([...rerankedTopK, ...scoredItems.slice(RECOMMENDER_CONFIG.LLM_RERANKER.TOP_K)]);
      }
    } catch (err) {
      console.log("[useRecommender] LLM rerank error:", err);
    } finally {
      setReranking(false);
    }
  }, [scoredItems, user, weather, featureFlags, enableLLMReranker, reranking]);

  // ========================================
  // Final items
  // ========================================

  const finalItems = rerankedItems || scoredItems;

  return {
    // Pass through all useExploreFilters properties except items
    ...exploreFilters,
    // Override items with scored/reranked items
    items: finalItems,
    // Raw items from base hook
    rawItems: exploreFilters.items,
    // Additional recommender context
    weather,
    featureFlags,
    scoringEnabled: enableScoring,
    requestLLMRerank,
    reranking,
  };
}

// ============================================================================
// Helper Hook: Update tag affinity
// ============================================================================

/**
 * Call this after RSVP or post creation to update user's tag affinity
 */
export async function updateTagAffinity(
  userId: string,
  tags: string[] | undefined,
  weight: number
): Promise<void> {
  if (!tags || tags.length === 0) return;

  try {
    await supabase.rpc("update_user_tag_affinity", {
      p_user_id: userId,
      p_tags: tags,
      p_weight: weight,
    });
  } catch (err) {
    console.log("[updateTagAffinity] Failed:", err);
  }
}

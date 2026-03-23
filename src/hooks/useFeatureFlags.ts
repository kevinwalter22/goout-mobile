/**
 * Centralized Feature Flags Hook
 *
 * Loads flags from the feature_flags DB table on mount and refreshes
 * periodically. Provides a toggle function for admin users.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { supabase } from "../lib/supabase";
import { RECOMMENDER_CONFIG } from "../config/recommenderConfig";

/** How often to silently refresh flags (ms). */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Default flag values — used before DB fetch completes. */
const DEFAULT_FLAGS = new Map<string, boolean>([
  [RECOMMENDER_CONFIG.FLAGS.LLM_RERANKER, false],
  [RECOMMENDER_CONFIG.FLAGS.WEATHER_BOOST, true],
  [RECOMMENDER_CONFIG.FLAGS.FRIENDS_BOOST, true],
  [RECOMMENDER_CONFIG.FLAGS.TAG_AFFINITY, true],
  [RECOMMENDER_CONFIG.FLAGS.TYPE_AFFINITY_LEARNING, true],
  [RECOMMENDER_CONFIG.FLAGS.COMMUNITY_FEEDBACK, true],
  [RECOMMENDER_CONFIG.FLAGS.FRESHNESS, true],
  ["contacts_sync", true],
  ["ingestion", true],
  ["image_moderation_enabled", true],
]);

export function useFeatureFlags() {
  const [flags, setFlags] = useState<Map<string, boolean>>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadFlags = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("feature_flags")
        .select("flag_name, is_enabled");

      if (error) {
        if (__DEV__) console.log("[useFeatureFlags] Error:", error.message);
        return;
      }

      if (data && data.length > 0) {
        setFlags(new Map(data.map((f) => [f.flag_name, f.is_enabled])));
      }
    } catch (err) {
      if (__DEV__) console.log("[useFeatureFlags] Fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  // Periodic refresh
  useEffect(() => {
    intervalRef.current = setInterval(loadFlags, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadFlags]);

  // Refresh when app returns to foreground
  useEffect(() => {
    function handleAppState(state: AppStateStatus) {
      if (state === "active") {
        loadFlags();
      }
    }

    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, [loadFlags]);

  /**
   * Toggle a flag (admin-only, calls SECURITY DEFINER RPC).
   * Optimistically updates local state; reverts on error.
   */
  const toggleFlag = useCallback(
    async (flagName: string, enabled: boolean): Promise<boolean> => {
      // Optimistic update
      setFlags((prev) => {
        const next = new Map(prev);
        next.set(flagName, enabled);
        return next;
      });

      try {
        const { error } = await supabase.rpc("toggle_feature_flag", {
          p_flag_name: flagName,
          p_is_enabled: enabled,
        });

        if (error) {
          // Revert
          setFlags((prev) => {
            const next = new Map(prev);
            next.set(flagName, !enabled);
            return next;
          });
          if (__DEV__) console.log("[useFeatureFlags] Toggle failed:", error.message);
          return false;
        }

        return true;
      } catch (err) {
        // Revert
        setFlags((prev) => {
          const next = new Map(prev);
          next.set(flagName, !enabled);
          return next;
        });
        if (__DEV__) console.log("[useFeatureFlags] Toggle error:", err);
        return false;
      }
    },
    [],
  );

  /** Convenience: check a single flag (defaults to false if unknown). */
  const isEnabled = useCallback(
    (flagName: string): boolean => flags.get(flagName) ?? false,
    [flags],
  );

  return { flags, loading, toggleFlag, isEnabled, refresh: loadFlags };
}

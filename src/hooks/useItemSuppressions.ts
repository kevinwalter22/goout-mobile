import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

/**
 * Manages the user's "Not Interested" suppressions.
 * Returns a Set of suppressed item IDs and a function to suppress/unsuppress.
 */
export function useItemSuppressions(userId: string | null | undefined) {
  const [suppressedIds, setSuppressedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!userId) {
      setSuppressedIds(new Set());
      return;
    }

    const { data } = await supabase
      .from("explore_item_suppressions")
      .select("explore_item_id")
      .eq("user_id", userId);

    setSuppressedIds(
      new Set((data || []).map((r: any) => r.explore_item_id))
    );
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const suppressItem = useCallback(
    async (exploreItemId: string) => {
      if (!userId) return;

      // Optimistic update
      setSuppressedIds((prev) => new Set([...prev, exploreItemId]));

      const { error } = await supabase
        .from("explore_item_suppressions")
        .insert({ user_id: userId, explore_item_id: exploreItemId });

      if (error) {
        // Revert on failure
        setSuppressedIds((prev) => {
          const next = new Set(prev);
          next.delete(exploreItemId);
          return next;
        });
      }
    },
    [userId]
  );

  const unsuppressItem = useCallback(
    async (exploreItemId: string) => {
      if (!userId) return;

      setSuppressedIds((prev) => {
        const next = new Set(prev);
        next.delete(exploreItemId);
        return next;
      });

      const { error } = await supabase
        .from("explore_item_suppressions")
        .delete()
        .eq("user_id", userId)
        .eq("explore_item_id", exploreItemId);

      if (error) {
        setSuppressedIds((prev) => new Set([...prev, exploreItemId]));
      }
    },
    [userId]
  );

  return { suppressedIds, suppressItem, unsuppressItem, refresh: load };
}

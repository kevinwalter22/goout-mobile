import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { logInteraction } from "../lib/interactionLogger";

interface UseExploreItemRSVPOptions {
  /** Tags from the explore item (kept for backward compat, affinity now server-side) */
  tags?: string[];
  /** Item kind for interaction logging */
  itemKind?: "event" | "activity";
}

/**
 * Get end-of-today in local timezone as an ISO string.
 * Activity RSVPs expire at local midnight so "I'm Going" resets daily.
 */
function getEndOfToday(): string {
  const now = new Date();
  const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1, // midnight = start of next day
    0, 0, 0, 0
  );
  return endOfDay.toISOString();
}

export function useExploreItemRSVP(
  exploreItemId: string,
  options: UseExploreItemRSVPOptions = {}
) {
  const { tags, itemKind } = options;
  const { user } = useAuth();
  const [isGoing, setIsGoing] = useState(false);
  const [goingCount, setGoingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadRSVPStatus = useCallback(async () => {
    if (!user || !exploreItemId) {
      setIsGoing(false);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Check if current user has a non-expired RSVP
    // Use select("*") for backwards compatibility (expires_at column may not exist yet)
    const { data: myRSVP } = await supabase
      .from("explore_item_rsvps")
      .select("*")
      .eq("explore_item_id", exploreItemId)
      .eq("user_id", user.id)
      .maybeSingle();

    // Check expiry client-side (expired activity RSVPs don't count)
    const expiresAt = myRSVP?.expires_at as string | null | undefined;
    const isValid = myRSVP
      ? !expiresAt || new Date(expiresAt) > new Date()
      : false;
    setIsGoing(isValid);

    // Get total count of RSVPs for this item
    // Note: includes expired activity RSVPs until cleanup runs,
    // but this is acceptable since cleanup runs daily
    const { count } = await supabase
      .from("explore_item_rsvps")
      .select("*", { count: "exact", head: true })
      .eq("explore_item_id", exploreItemId);

    setGoingCount(count ?? 0);
    setLoading(false);
  }, [user, exploreItemId]);

  async function toggleRSVP() {
    if (!user || !exploreItemId) return;

    if (isGoing) {
      // Remove RSVP
      const { error } = await supabase
        .from("explore_item_rsvps")
        .delete()
        .eq("explore_item_id", exploreItemId)
        .eq("user_id", user.id);

      if (!error) {
        setIsGoing(false);
        setGoingCount((prev) => Math.max(0, prev - 1));
      }
    } else {
      // Delete any existing expired RSVP first (activity re-RSVP next day)
      await supabase
        .from("explore_item_rsvps")
        .delete()
        .eq("explore_item_id", exploreItemId)
        .eq("user_id", user.id);

      // Build insert data — try with expires_at for activities
      const baseData: any = {
        explore_item_id: exploreItemId,
        user_id: user.id,
      };

      let insertError: any = null;

      if (itemKind === "activity") {
        // Try insert with expires_at (requires migration 090)
        const { error } = await supabase
          .from("explore_item_rsvps")
          .insert({ ...baseData, expires_at: getEndOfToday() });

        if (error) {
          // Fallback: insert without expires_at if column doesn't exist yet
          const { error: fallbackError } = await supabase
            .from("explore_item_rsvps")
            .insert(baseData);
          insertError = fallbackError;
        }
      } else {
        const { error } = await supabase
          .from("explore_item_rsvps")
          .insert(baseData);
        insertError = error;
      }

      if (!insertError) {
        setIsGoing(true);
        setGoingCount((prev) => prev + 1);

        // Log RSVP interaction (updates both type + tag affinity server-side)
        if (itemKind) {
          logInteraction({
            userId: user.id,
            exploreItemId,
            eventType: "rsvp",
            itemKind,
          });
        }
      }
    }
  }

  useEffect(() => {
    loadRSVPStatus();
  }, [loadRSVPStatus]);

  return {
    isGoing,
    goingCount,
    loading,
    toggleRSVP,
    refresh: loadRSVPStatus,
  };
}

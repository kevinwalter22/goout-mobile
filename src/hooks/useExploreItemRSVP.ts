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

    // Check if current user has RSVPed
    const { data: myRSVP } = await supabase
      .from("explore_item_rsvps")
      .select("id")
      .eq("explore_item_id", exploreItemId)
      .eq("user_id", user.id)
      .maybeSingle();

    setIsGoing(!!myRSVP);

    // Get total count of RSVPs
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
      // Add RSVP
      const { error } = await supabase
        .from("explore_item_rsvps")
        .insert({ explore_item_id: exploreItemId, user_id: user.id } as any);

      if (!error) {
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

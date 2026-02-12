import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { mediumHaptic } from "../utils/haptics";

export type FriendRecommendation = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  mutual_count: number;
};

export function useFriendRecommendations(limit: number = 5) {
  const { user } = useAuth();
  const [recommendations, setRecommendations] = useState<FriendRecommendation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRecommendations = useCallback(async () => {
    if (!user) {
      setRecommendations([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.rpc("get_friend_recommendations", {
        p_user_id: user.id,
        p_limit: limit,
      });

      if (error) {
        console.error("[useFriendRecommendations] RPC error:", error.message);
        setRecommendations([]);
      } else {
        setRecommendations(data ?? []);
      }
    } catch (err) {
      console.error("[useFriendRecommendations] Error:", err);
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, [user, limit]);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  async function sendRequest(targetUserId: string) {
    if (!user) return;

    // Optimistically remove from list
    const prev = recommendations;
    setRecommendations((r) => r.filter((rec) => rec.user_id !== targetUserId));

    try {
      const { error } = await supabase
        .from("friendships")
        .insert({ user_id: user.id, friend_id: targetUserId, status: "pending" } as any);

      if (error) {
        console.error("[useFriendRecommendations] Send request error:", error.message);
        // Rollback
        setRecommendations(prev);
      } else {
        mediumHaptic();
      }
    } catch (err) {
      console.error("[useFriendRecommendations] Send request error:", err);
      setRecommendations(prev);
    }
  }

  return {
    recommendations,
    loading,
    sendRequest,
    refresh: loadRecommendations,
  };
}

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { mediumHaptic } from "../utils/haptics";

export type FriendRecommendation = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  mutual_count: number;
  source: "contact" | "mutual";
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
      // Fetch both sources in parallel
      const [foafResult, contactResult] = await Promise.all([
        supabase.rpc("get_friend_recommendations", {
          p_user_id: user.id,
          p_limit: limit,
        }),
        supabase.rpc("get_contact_suggestions", {
          p_user_id: user.id,
        }),
      ]);

      // Map FOAF results
      const foaf: FriendRecommendation[] = (foafResult.data ?? []).map(
        (r: any) => ({
          user_id: r.user_id,
          username: r.username,
          avatar_url: r.avatar_url,
          mutual_count: r.mutual_count ?? 0,
          source: "mutual" as const,
        }),
      );

      // Map contact suggestions
      const contacts: FriendRecommendation[] = (contactResult.data ?? []).map(
        (r: any) => ({
          user_id: r.user_id,
          username: r.username,
          avatar_url: r.avatar_url,
          mutual_count: 0,
          source: "contact" as const,
        }),
      );

      // Merge: contacts first, then FOAF, deduplicating by user_id
      const seen = new Set<string>();
      const merged: FriendRecommendation[] = [];

      for (const rec of [...contacts, ...foaf]) {
        if (seen.has(rec.user_id)) continue;
        seen.add(rec.user_id);
        merged.push(rec);
        if (merged.length >= limit) break;
      }

      setRecommendations(merged);
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

    // Find the rec so we know its source
    const rec = recommendations.find((r) => r.user_id === targetUserId);

    // Optimistically remove from list
    const prev = recommendations;
    setRecommendations((r) => r.filter((item) => item.user_id !== targetUserId));

    try {
      const { error } = await supabase
        .from("friendships")
        .insert({ user_id: user.id, friend_id: targetUserId, status: "pending" } as any);

      if (error) {
        console.error("[useFriendRecommendations] Send request error:", error.message);
        // Rollback
        setRecommendations(prev);
        return;
      }

      mediumHaptic();

      // Dismiss contact suggestion so it doesn't reappear on next load
      if (rec?.source === "contact") {
        await (supabase.rpc as any)("dismiss_contact_suggestion", {
          p_user_id: user.id,
          p_suggested_user_id: targetUserId,
        });
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

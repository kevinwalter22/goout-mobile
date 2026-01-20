import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export function useFriendship(targetUserId: string | null) {
  const { user } = useAuth();
  const [isFriend, setIsFriend] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !targetUserId) {
      setLoading(false);
      return;
    }
    loadFriendshipStatus();
  }, [user, targetUserId]);

  async function loadFriendshipStatus() {
    if (!user || !targetUserId) return;

    setLoading(true);

    // Check bidirectional: (me → them) OR (them → me)
    const { data } = await supabase
      .from("friendships")
      .select("id")
      .or(
        `and(user_id.eq.${user.id},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${user.id})`
      )
      .maybeSingle();

    setIsFriend(!!data);
    setLoading(false);
  }

  async function toggleFriendship() {
    if (!user || !targetUserId || loading) return;

    setLoading(true);

    try {
      if (isFriend) {
        // Remove friendship (both directions)
        await supabase
          .from("friendships")
          .delete()
          .or(
            `and(user_id.eq.${user.id},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${user.id})`
          );

        setIsFriend(false);
      } else {
        // Add friendship (one direction: me → them)
        const { error } = await supabase
          .from("friendships")
          .insert({ user_id: user.id, friend_id: targetUserId } as any);

        if (!error) {
          setIsFriend(true);
        }
      }
    } catch (error) {
      console.error("Error toggling friendship:", error);
    } finally {
      setLoading(false);
    }
  }

  return {
    isFriend,
    loading,
    toggleFriendship,
  };
}

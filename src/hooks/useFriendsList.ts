import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

type Friend = {
  id: string;
  username: string;
  avatar_url: string | null;
};

/**
 * Fetch friends list for a user
 * @param userId - Optional user ID to fetch friends for. If not provided, fetches for current user.
 */
export function useFriendsList(userId?: string) {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  // Use provided userId or fall back to current user
  const targetUserId = userId || user?.id;

  useEffect(() => {
    if (targetUserId) {
      loadFriends();
    }
  }, [targetUserId]);

  async function loadFriends() {
    if (!targetUserId) return;

    setLoading(true);

    // Fetch accepted friendships only (bidirectional)
    const { data: friendships, error: friendshipsError } = await supabase
      .from("friendships")
      .select("user_id, friend_id")
      .eq("status", "accepted")
      .or(`user_id.eq.${targetUserId},friend_id.eq.${targetUserId}`);

    if (friendshipsError || !friendships) {
      setLoading(false);
      return;
    }

    // Extract friend IDs (the OTHER person in each friendship)
    const friendIds = friendships.map((f: any) =>
      f.user_id === targetUserId ? f.friend_id : f.user_id
    );

    if (friendIds.length === 0) {
      setFriends([]);
      setLoading(false);
      return;
    }

    // Fetch profiles for all friends
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", friendIds);

    setFriends(profiles || []);
    setLoading(false);
  }

  return {
    friends,
    loading,
    refresh: loadFriends,
  };
}

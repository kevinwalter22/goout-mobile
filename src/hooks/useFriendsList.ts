import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

type Friend = {
  id: string;
  username: string;
  avatar_url: string | null;
};

/**
 * Fetch friends list for a user.
 *
 * - Own friends (no userId / userId === current user): direct table query, RLS
 *   ensures the caller only sees their own relationships.
 * - Another user's friends: uses get_user_friends() RPC (SECURITY DEFINER).
 *   The RPC enforces that the caller must be an accepted friend of the target;
 *   non-friends receive an empty list. This bypasses the friendships RLS policy
 *   which otherwise filters rows to only those where the caller is a direct party,
 *   causing only the mutual friendship row to be visible instead of the full list.
 *
 * @param userId - Optional user ID. Omit to fetch the current user's own friends.
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

    const isOwnProfile = !userId || userId === user?.id;

    if (!isOwnProfile) {
      // Viewing another user's friends — RPC enforces friend-only access
      const { data, error } = await supabase.rpc("get_user_friends" as any, {
        p_user_id: targetUserId,
      });

      setFriends(error ? [] : ((data as unknown as Friend[]) ?? []));
      setLoading(false);
      return;
    }

    // Viewing own friends — direct table query (RLS scopes to self)
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
      .from("public_profiles")
      .select("id, username, avatar_url")
      .in("id", friendIds);

    setFriends((profiles as any) || []);
    setLoading(false);
  }

  return {
    friends,
    loading,
    refresh: loadFriends,
  };
}

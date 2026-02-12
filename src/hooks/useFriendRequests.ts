import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

type FriendRequest = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
};

export function useFriendRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadRequests();
    }
  }, [user]);

  async function loadRequests() {
    if (!user) return;

    setLoading(true);

    // Fetch pending friend requests where current user is the recipient
    const { data: friendshipsData, error: friendshipsError } = await supabase
      .from("friendships")
      .select("id, user_id, created_at")
      .eq("friend_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (friendshipsError || !friendshipsData || friendshipsData.length === 0) {
      setRequests([]);
      setLoading(false);
      return;
    }

    // Get unique user IDs (people who sent requests)
    const senderIds = friendshipsData.map((f: any) => f.user_id);

    // Fetch profiles for all senders
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", senderIds);

    // Create a map of user_id -> profile
    const profilesMap = new Map(
      (profilesData || []).map((p: any) => [p.id, p])
    );

    // Combine friendships with profiles
    const requestsWithProfiles: FriendRequest[] = friendshipsData.map((f: any) => {
      const profile = profilesMap.get(f.user_id);
      return {
        id: f.id,
        user_id: f.user_id,
        username: profile?.username || "Unknown",
        avatar_url: profile?.avatar_url || null,
        created_at: f.created_at,
      };
    });

    setRequests(requestsWithProfiles);
    setLoading(false);
  }

  return {
    requests,
    loading,
    refresh: loadRequests,
  };
}

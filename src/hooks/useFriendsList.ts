import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

type Friend = {
  id: string;
  username: string;
};

export function useFriendsList() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadFriends();
    }
  }, [user]);

  async function loadFriends() {
    if (!user) return;

    setLoading(true);

    // Fetch friendships (bidirectional)
    const { data: friendships, error: friendshipsError } = await supabase
      .from("friendships")
      .select("user_id, friend_id")
      .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

    if (friendshipsError || !friendships) {
      setLoading(false);
      return;
    }

    // Extract friend IDs (the OTHER person in each friendship)
    const friendIds = friendships.map((f: any) =>
      f.user_id === user.id ? f.friend_id : f.user_id
    );

    if (friendIds.length === 0) {
      setFriends([]);
      setLoading(false);
      return;
    }

    // Fetch profiles for all friends
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
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

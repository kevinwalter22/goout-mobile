import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * Fetch accurate friend count for any user via RPC.
 * Unlike useFriendsList, this works for non-friends too
 * (friendships RLS only returns rows where the caller is a party).
 */
export function useFriendCount(userId: string | null) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  function fetchCount() {
    if (!userId) return;
    supabase
      .rpc("get_friend_count", { p_user_id: userId })
      .then(({ data, error }) => {
        if (!error && data != null) setCount(data);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchCount();
  }, [userId]);

  /** Optimistic +1, then revalidate from server */
  function increment() {
    setCount((c) => c + 1);
    fetchCount();
  }

  return { count, loading, refresh: fetchCount, increment };
}

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Post } from "../types/database";

export function useUserPosts(userId: string | null) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userId) {
      loadPosts();
    }
  }, [userId]);

  async function loadPosts() {
    if (!userId) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: postsError } = await supabase
        .from("posts")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (postsError) {
        throw postsError;
      }

      setPosts(data || []);
    } catch (err) {
      console.error("Error loading user posts:", err);
      setError(err instanceof Error ? err.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }

  function removePost(postId: string) {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }

  return {
    posts,
    loading,
    error,
    refresh: loadPosts,
    removePost,
  };
}

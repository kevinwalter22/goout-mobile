import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Post } from "../types/database";

export type PostWithDetails = Post & {
  profile: {
    username: string;
  } | null;
  event: {
    title: string;
  } | null;
};

export function usePosts() {
  const [posts, setPosts] = useState<PostWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadPosts() {
    try {
      setLoading(true);
      setError(null);

      // Fetch posts first
      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false });

      if (postsError) {
        console.error("Supabase error loading posts:", postsError);
        throw postsError;
      }

      if (!postsData || postsData.length === 0) {
        setPosts([]);
        return;
      }

      // Get unique user IDs and event IDs
      const userIds = [...new Set(postsData.map((p: Post) => p.user_id))];
      const eventIds = [
        ...new Set(postsData.map((p: Post) => p.event_id).filter(Boolean) as string[]),
      ];

      // Fetch profiles for these users
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", userIds);

      // Fetch events for these posts
      const { data: eventsData } = await supabase
        .from("events")
        .select("id, title")
        .in("id", eventIds);

      // Create lookup maps
      const profilesMap = new Map(
        profilesData?.map((p: any) => [p.id, p]) || [],
      );
      const eventsMap = new Map(eventsData?.map((e: any) => [e.id, e]) || []);

      // Combine data
      const postsWithDetails: PostWithDetails[] = postsData.map((post: Post) => ({
        ...post,
        profile: profilesMap.get(post.user_id) || null,
        event: post.event_id ? eventsMap.get(post.event_id) || null : null,
      }));

      setPosts(postsWithDetails);
    } catch (err) {
      console.error("Error loading posts:", err);
      setError(err instanceof Error ? err.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPosts();
  }, []);

  return {
    posts,
    loading,
    error,
    refresh: loadPosts,
  };
}

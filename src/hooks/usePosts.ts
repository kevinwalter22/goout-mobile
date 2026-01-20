import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import type { Post } from "../types/database";

export type PostWithDetails = Post & {
  profile: {
    username: string;
  } | null;
  event: {
    title: string;
  } | null;
  comment_count: number;
};

export function usePosts() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<PostWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadPosts() {
    if (!user) {
      setPosts([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // NEW: Fetch friend IDs first (Phase 7: Friend-scoped feed)
      const { data: friendships } = await supabase
        .from("friendships")
        .select("user_id, friend_id")
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

      // Extract friend IDs (bidirectional - the OTHER person in each friendship)
      const friendIds = (friendships || []).map((f: any) =>
        f.user_id === user.id ? f.friend_id : f.user_id
      );

      // Add own user ID to the list (see own posts too)
      const visibleUserIds = [...friendIds, user.id];

      // Fetch posts from friends + self
      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select("*")
        .in("user_id", visibleUserIds) // NEW: Filter by friends + self
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

      // Fetch comment counts for these posts
      const postIds = postsData.map((p: Post) => p.id);
      const { data: commentsData } = await supabase
        .from("post_comments")
        .select("post_id")
        .in("post_id", postIds);

      // Count comments per post
      const commentCountsMap = new Map<string, number>();
      (commentsData || []).forEach((comment: any) => {
        const currentCount = commentCountsMap.get(comment.post_id) || 0;
        commentCountsMap.set(comment.post_id, currentCount + 1);
      });

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
        comment_count: commentCountsMap.get(post.id) || 0,
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
    if (user) {
      loadPosts();
    }
  }, [user]);

  return {
    posts,
    loading,
    error,
    refresh: loadPosts,
  };
}

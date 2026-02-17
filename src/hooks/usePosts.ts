import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import type { Post } from "../types/database";

export type ReactionData = {
  emoji: string;
  user_id: string;
};

export type PostWithDetails = Post & {
  profile: {
    username: string;
    avatar_url: string | null;
  } | null;
  event: {
    title: string;
  } | null;
  explore_item: {
    title: string;
  } | null;
  comment_count: number;
  reactions: ReactionData[];
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
      const _t0 = __DEV__ ? performance.now() : 0;

      // NEW: Fetch accepted friend IDs only (friend request system)
      const { data: friendships } = await supabase
        .from("friendships")
        .select("user_id, friend_id")
        .eq("status", "accepted")
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

      // Get unique user IDs, event IDs, and explore_item IDs
      const userIds = [...new Set(postsData.map((p: Post) => p.user_id))];
      const eventIds = [
        ...new Set(postsData.map((p: Post) => p.event_id).filter(Boolean) as string[]),
      ];
      const exploreItemIds = [
        ...new Set(postsData.map((p: any) => p.explore_item_id).filter(Boolean) as string[]),
      ];

      // Fetch profiles for these users
      const { data: profilesData } = await supabase
        .from("public_profiles")
        .select("id, username, avatar_url")
        .in("id", userIds);

      // Fetch events for posts with event_id (legacy)
      let eventsData: any[] = [];
      if (eventIds.length > 0) {
        const { data } = await supabase
          .from("events")
          .select("id, title")
          .in("id", eventIds);
        eventsData = data || [];
      }

      // Fetch explore_items for posts with explore_item_id (new flow)
      let exploreItemsData: any[] = [];
      if (exploreItemIds.length > 0) {
        const { data } = await supabase
          .from("explore_items")
          .select("id, title")
          .in("id", exploreItemIds);
        exploreItemsData = data || [];
      }

      // Fetch comment counts + reactions for these posts (batch — avoids N+1)
      const postIds = postsData.map((p: Post) => p.id);
      const [{ data: commentsData }, { data: reactionsData }] = await Promise.all([
        supabase.from("post_comments").select("post_id").in("post_id", postIds),
        supabase.from("post_reactions").select("post_id, emoji, user_id").in("post_id", postIds),
      ]);

      // Count comments per post
      const commentCountsMap = new Map<string, number>();
      (commentsData || []).forEach((comment: any) => {
        const currentCount = commentCountsMap.get(comment.post_id) || 0;
        commentCountsMap.set(comment.post_id, currentCount + 1);
      });

      // Group reactions per post
      const reactionsMap = new Map<string, ReactionData[]>();
      (reactionsData || []).forEach((r: any) => {
        const list = reactionsMap.get(r.post_id) || [];
        list.push({ emoji: r.emoji, user_id: r.user_id });
        reactionsMap.set(r.post_id, list);
      });

      // Create lookup maps
      const profilesMap = new Map(
        profilesData?.map((p: any) => [p.id, p]) || [],
      );
      const eventsMap = new Map(eventsData?.map((e: any) => [e.id, e]) || []);
      const exploreItemsMap = new Map(exploreItemsData?.map((e: any) => [e.id, e]) || []);

      // Combine data
      const postsWithDetails: PostWithDetails[] = postsData.map((post: any) => ({
        ...post,
        profile: profilesMap.get(post.user_id) || null,
        event: post.event_id ? eventsMap.get(post.event_id) || null : null,
        explore_item: post.explore_item_id ? exploreItemsMap.get(post.explore_item_id) || null : null,
        comment_count: commentCountsMap.get(post.id) || 0,
        reactions: reactionsMap.get(post.id) || [],
      }));

      if (__DEV__) {
        console.log(`[Feed] loaded ${postsWithDetails.length} posts in ${(performance.now() - _t0).toFixed(0)}ms`);
      }
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

import { useState, useEffect } from "react";
import {
  View,
  Text,
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { Avatar } from "../../src/components/Avatar";
import { PostImage } from "../../src/components/PostImage";
import { DualCameraPost } from "../../src/components/DualCameraPost";
import { ReactionBar } from "../../src/components/ReactionBar";
import { CommentSheet } from "../../src/components/CommentSheet";
import { ContentActionMenu } from "../../src/components/ContentActionMenu";
import { ReportSheet } from "../../src/components/ReportSheet";
import { Toast } from "../../src/components/Toast";
import type { ToastType } from "../../src/components/Toast";
import { openDirections } from "../../src/utils/maps";
import { deleteImage } from "../../src/utils/storage";
import { useBlockUser } from "../../src/hooks/useBlockUser";
import { useAuth } from "../../src/hooks/useAuth";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import type { Post } from "../../src/types/database";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { ZoomableImage } from "../../src/components/ZoomableImage";

type PostWithDetails = Post & {
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
};

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { colors } = useTheme();
  const [post, setPost] = useState<PostWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const { blockUser } = useBlockUser();
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: ToastType }>({
    visible: false,
    message: "",
    type: "info",
  });

  useEffect(() => {
    if (id) {
      loadPost();
    }
  }, [id]);

  async function loadPost() {
    try {
      setLoading(true);
      setError(null);

      // Fetch the post (.maybeSingle avoids PGRST116 if row was deleted)
      const { data: postData, error: postError } = await supabase
        .from("posts")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (postError) throw postError;
      if (!postData) {
        setError("Post not found");
        setLoading(false);
        return;
      }

      // Cast to Post type to avoid type issues
      const post = postData as Post;

      // Fetch profile (public view — safe for any user)
      const { data: profileData } = await supabase
        .from("public_profiles")
        .select("id, username, avatar_url")
        .eq("id", post.user_id)
        .single();

      // Fetch event if exists (legacy)
      let eventData = null;
      if (post.event_id) {
        const { data } = await supabase
          .from("events")
          .select("id, title")
          .eq("id", post.event_id)
          .single();
        eventData = data;
      }

      // Fetch explore_item if exists (new flow)
      let exploreItemData = null;
      if (post.explore_item_id) {
        const { data } = await supabase
          .from("explore_items")
          .select("id, title")
          .eq("id", post.explore_item_id)
          .single();
        exploreItemData = data;
      }

      // Fetch comment count
      const { data: commentsData } = await supabase
        .from("post_comments")
        .select("id")
        .eq("post_id", id);

      const postWithDetails: PostWithDetails = {
        ...post,
        profile: (profileData as any) || null,
        event: eventData,
        explore_item: exploreItemData,
        comment_count: commentsData?.length || 0,
      };

      setPost(postWithDetails);
    } catch (err) {
      console.error("Error loading post:", err);
      setError(err instanceof Error ? err.message : "Failed to load post");
    } finally {
      setLoading(false);
    }
  }

  async function handleBlockUser(userId: string) {
    const ok = await blockUser(userId);
    if (ok) {
      setToast({ visible: true, message: "User blocked", type: "info" });
      router.back();
    } else {
      Alert.alert("Error", "Failed to block user. Please try again.");
    }
  }

  async function handleDeletePost() {
    if (!post) return;

    const { error } = await supabase.from("posts").delete().eq("id", post.id);
    if (error) {
      setToast({ visible: true, message: "Failed to delete post", type: "error" });
      return;
    }

    // Clean up storage files (fire-and-forget)
    deleteImage(post.photo_path);
    if (post.front_photo_path) deleteImage(post.front_photo_path);

    router.back();
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16, backgroundColor: colors.background }}>
        <Text style={{ textAlign: "center", fontSize: 16, fontWeight: "600", color: colors.text }}>
          {error || "Post not found"}
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={{
            padding: 16,
            borderRadius: 12,
            backgroundColor: colors.text,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.background, fontSize: 16, fontWeight: "600" }}>
            Go Back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Post" />

      <ScrollView>
        <View style={{ padding: 16, gap: 12 }}>
          {/* User Header */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Avatar
              avatarUrl={post.profile?.avatar_url || null}
              size={40}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
                {post.profile?.username || "Unknown"}
              </Text>
              {(post.explore_item?.title || post.event?.title) ? (
                <Pressable
                  onPress={() => {
                    if (post.explore_item_id) {
                      const t = post.explore_item?.title || post.event?.title || '';
                      router.push(`/event/${post.explore_item_id}?title=${encodeURIComponent(t)}` as any);
                    } else if (post.latitude != null && post.longitude != null) {
                      openDirections({ lat: post.latitude, lng: post.longitude });
                    } else {
                      setToast({ visible: true, message: "Event details unavailable", type: "info" });
                    }
                  }}
                >
                  <Text style={{ fontSize: 14, color: Colors.primary }}>
                    {post.explore_item?.title || post.event?.title} ›
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                  Standalone post
                </Text>
              )}
            </View>
            <View style={{ alignItems: "flex-end", flexDirection: "row", gap: 8 }}>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  {new Date(post.created_at).toLocaleDateString()}
                </Text>
                <Text style={{ fontSize: 11, color: colors.textTertiary }}>
                  {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <ContentActionMenu
                authorUserId={post.user_id}
                targetType="post"
                targetId={post.id}
                onReport={() => setShowReport(true)}
                onBlockUser={() => handleBlockUser(post.user_id)}
                onDelete={post.user_id === user?.id ? handleDeletePost : undefined}
              />
            </View>
          </View>

          {/* Photo */}
          {post.photo_path && (
            <ZoomableImage
              style={{
                width: "100%",
                aspectRatio: 3 / 4,
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {post.camera_mode === "dual" && post.front_photo_path ? (
                <DualCameraPost
                  backPhotoPath={post.photo_path}
                  frontPhotoPath={post.front_photo_path}
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <PostImage
                  photoPath={post.photo_path}
                  style={{ width: "100%", height: "100%" }}
                />
              )}
            </ZoomableImage>
          )}

          {/* Caption */}
          {post.caption && (
            <Text style={{ fontSize: 14, color: colors.text }}>{post.caption}</Text>
          )}

          {/* Engagement Row */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 8 }}>
            {/* Reactions */}
            <ReactionBar postId={post.id} />

            {/* Comments Button */}
            <Pressable
              onPress={() => setShowComments(true)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                💬 {post.comment_count > 0 ? post.comment_count : ""}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Comment Sheet Modal */}
      {showComments && (
        <CommentSheet
          postId={post.id}
          visible={showComments}
          onClose={() => setShowComments(false)}
        />
      )}

      {/* Report Sheet */}
      <ReportSheet
        visible={showReport}
        onClose={() => setShowReport(false)}
        targetType="post"
        targetId={post.id}
        targetUserId={post.user_id}
        onBlockUser={(userId) => {
          handleBlockUser(userId);
          setShowReport(false);
        }}
      />

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </View>
  );
}

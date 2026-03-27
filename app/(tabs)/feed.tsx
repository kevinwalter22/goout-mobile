import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
  Image,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePosts, type PostWithDetails } from "../../src/hooks/usePosts";
import { PostImage } from "../../src/components/PostImage";
import { DualCameraPost } from "../../src/components/DualCameraPost";
import { ZoomableImage } from "../../src/components/ZoomableImage";
import { ReactionBar } from "../../src/components/ReactionBar";
import { CommentSheet } from "../../src/components/CommentSheet";
import { ContentActionMenu } from "../../src/components/ContentActionMenu";
import { ReportSheet } from "../../src/components/ReportSheet";
import { Avatar } from "../../src/components/Avatar";
import { scrollToTopEmitter } from "../../src/utils/scrollToTop";
import { Toast } from "../../src/components/Toast";
import type { ToastType } from "../../src/components/Toast";
import { openDirections } from "../../src/utils/maps";
import { useBlockUser } from "../../src/hooks/useBlockUser";
import { useAuth } from "../../src/hooks/useAuth";
import { deleteImage } from "../../src/utils/storage";
import { supabase } from "../../src/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";

// Stable separator — avoids creating a new component on every render
const FeedSep = ({ colors }: { colors: any }) => (
  <View style={{ height: 1, backgroundColor: colors.separator }} />
);

// Memoized feed item — only re-renders when post data changes
const FeedItem = React.memo(function FeedItem({
  item,
  onComment,
  onToast,
  onReport,
  onBlockUser,
  onDeletePost,
  colors,
}: {
  item: PostWithDetails;
  onComment: (postId: string) => void;
  onToast: (message: string) => void;
  onReport: (postId: string, userId: string) => void;
  onBlockUser: (userId: string) => void;
  onDeletePost?: (post: PostWithDetails) => void;
  colors: any;
}) {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {/* Moderation banners */}
      {item.moderation_status === "quarantined" && (
        <View style={{
          backgroundColor: Colors.warning + "18",
          borderRadius: 8,
          padding: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}>
          <Ionicons name="time-outline" size={16} color={Colors.warning} />
          <Text style={{ fontSize: 13, color: Colors.warning, flex: 1 }}>
            Pending review — this post is only visible to you.
          </Text>
        </View>
      )}
      {item.moderation_status === "blocked" && (
        <View style={{
          backgroundColor: colors.separator,
          borderRadius: 8,
          padding: 16,
          alignItems: "center",
        }}>
          <Text style={{ fontSize: 14, color: colors.textSecondary }}>
            This content has been removed for violating community guidelines.
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable onPress={() => router.push(`/user/${item.user_id}` as any)}>
          <Avatar avatarUrl={item.profile?.avatar_url || null} size={40} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Pressable onPress={() => router.push(`/user/${item.user_id}` as any)}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
              {item.profile?.username || "Unknown"}
            </Text>
          </Pressable>
          {item.explore_item?.title || item.event?.title ? (
            <Pressable
              onPress={() => {
                if (item.explore_item_id) {
                  const t = item.explore_item?.title || item.event?.title || "";
                  router.push(
                    `/event/${item.explore_item_id}?title=${encodeURIComponent(t)}` as any,
                  );
                } else if (item.latitude != null && item.longitude != null) {
                  openDirections({ lat: item.latitude, lng: item.longitude });
                } else {
                  onToast("Event details unavailable");
                }
              }}
            >
              <Text style={{ fontSize: 14, color: Colors.primary }}>
                {item.explore_item?.title || item.event?.title} ›
              </Text>
            </Pressable>
          ) : (
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>Standalone post</Text>
          )}
        </View>
        <View style={{ alignItems: "flex-end", flexDirection: "row", gap: 8 }}>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 12, color: colors.textTertiary }}>
              {new Date(item.created_at).toLocaleDateString()}
            </Text>
            <Text style={{ fontSize: 11, color: colors.textTertiary }}>
              {new Date(item.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>
          <ContentActionMenu
            authorUserId={item.user_id}
            targetType="post"
            targetId={item.id}
            onReport={() => onReport(item.id, item.user_id)}
            onBlockUser={() => onBlockUser(item.user_id)}
            onDelete={onDeletePost ? () => onDeletePost(item) : undefined}
          />
        </View>
      </View>

      {/* Photo + Caption (hidden when blocked) */}
      {item.moderation_status !== "blocked" && (
        <>
          {item.photo_path && (
            <ZoomableImage
              style={{
                width: "100%",
                aspectRatio: 3 / 4,
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {item.camera_mode === "dual" && item.front_photo_path ? (
                <DualCameraPost
                  backPhotoPath={item.photo_path}
                  frontPhotoPath={item.front_photo_path}
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <PostImage
                  photoPath={item.photo_path}
                  style={{ width: "100%", height: "100%" }}
                />
              )}
            </ZoomableImage>
          )}
          {item.caption && <Text style={{ fontSize: 14, color: colors.text }}>{item.caption}</Text>}
        </>
      )}

      {/* Engagement Row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 8 }}>
        <ReactionBar postId={item.id} initialReactions={item.reactions} />
        <Pressable
          onPress={() => onComment(item.id)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontSize: 14, color: colors.textSecondary }}>
            💬 {item.comment_count > 0 ? item.comment_count : ""}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

export default function Feed() {
  const { posts, loading, error, refresh, removePost } = usePosts();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ postId: string; userId: string } | null>(null);
  const { blockUser, blockedIds } = useBlockUser();
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: ToastType }>({
    visible: false,
    message: "",
    type: "info",
  });
  const flatListRef = useRef<FlatList>(null);
  const { colors } = useTheme();

  // Filter out posts from blocked users
  const visiblePosts = posts.filter((p) => !blockedIds.has(p.user_id));

  // Stable callbacks for memoized FeedItem
  const handleComment = useCallback((postId: string) => {
    setSelectedPostId(postId);
  }, []);

  const handleToast = useCallback((message: string) => {
    setToast({ visible: true, message, type: "info" });
  }, []);

  const handleReport = useCallback((postId: string, userId: string) => {
    setReportTarget({ postId, userId });
  }, []);

  const handleBlockUser = useCallback(async (userId: string) => {
    const ok = await blockUser(userId);
    if (ok) {
      setToast({ visible: true, message: "User blocked", type: "info" });
    } else {
      Alert.alert("Error", "Failed to block user. Please try again.");
    }
  }, [blockUser]);

  const handleDeletePost = useCallback((post: PostWithDetails) => {
    // Optimistic removal
    removePost(post.id);

    supabase.from("posts").delete().eq("id", post.id).then(({ error }) => {
      if (error) {
        setToast({ visible: true, message: "Failed to delete post", type: "error" });
        refresh();
        return;
      }
      // Clean up storage files (fire-and-forget)
      deleteImage(post.photo_path);
      if (post.front_photo_path) deleteImage(post.front_photo_path);
      setToast({ visible: true, message: "Post deleted", type: "success" });
    });
  }, [removePost, refresh]);

  // Listen for scroll-to-top events
  useEffect(() => {
    const handleScrollToTop = () => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    };

    scrollToTopEmitter.on("scrollToTop:feed", handleScrollToTop);

    return () => {
      scrollToTopEmitter.off("scrollToTop:feed", handleScrollToTop);
    };
  }, []);

  if (loading && visiblePosts.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error && visiblePosts.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16, backgroundColor: colors.background }}>
        <Text style={{ textAlign: "center", fontSize: 16, fontWeight: "600", color: colors.text }}>
          Failed to load feed
        </Text>
        <Text style={{ textAlign: "center", color: colors.textSecondary }}>
          {error}
        </Text>
        <Pressable
          onPress={refresh}
          style={{
            padding: 16,
            borderRadius: 12,
            backgroundColor: colors.text,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.background, fontSize: 16, fontWeight: "600" }}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  if (visiblePosts.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          justifyContent: "center",
          alignItems: "center",
          gap: 12,
          backgroundColor: colors.background,
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: "700", color: colors.text }}>Feed</Text>
        <Text style={{ fontSize: 16, color: colors.textSecondary, textAlign: "center" }}>
          No posts yet
        </Text>
        <Text style={{ fontSize: 14, color: colors.textTertiary, textAlign: "center" }}>
          Add friends to see their posts, or check in at an event to create your first post!
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          padding: 16,
          paddingTop: insets.top + 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        }}
      >
        <Image
          source={require("../../assets/images/euda.png")}
          style={{ width: 120, height: 48, marginLeft: -8 }}
          resizeMode="contain"
        />
      </View>

      <FlatList
        ref={flatListRef}
        data={visiblePosts}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} />
        }
        ItemSeparatorComponent={() => <FeedSep colors={colors} />}
        renderItem={({ item }) => (
          <FeedItem
            item={item}
            onComment={handleComment}
            onToast={handleToast}
            onReport={handleReport}
            onBlockUser={handleBlockUser}
            onDeletePost={item.user_id === user?.id ? handleDeletePost : undefined}
            colors={colors}
          />
        )}
      />

      {/* Comment Sheet Modal */}
      {selectedPostId && (
        <CommentSheet
          postId={selectedPostId}
          visible={!!selectedPostId}
          onClose={() => setSelectedPostId(null)}
        />
      )}

      {/* Report Sheet */}
      {reportTarget && (
        <ReportSheet
          visible={!!reportTarget}
          onClose={() => setReportTarget(null)}
          targetType="post"
          targetId={reportTarget.postId}
          targetUserId={reportTarget.userId}
          onBlockUser={(userId) => {
            handleBlockUser(userId);
            setReportTarget(null);
          }}
        />
      )}

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </View>
  );
}

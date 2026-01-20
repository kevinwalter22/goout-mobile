import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { usePosts } from "../../src/hooks/usePosts";
import { PostImage } from "../../src/components/PostImage";
import { DualCameraPost } from "../../src/components/DualCameraPost";
import { ReactionBar } from "../../src/components/ReactionBar";
import { CommentSheet } from "../../src/components/CommentSheet";

export default function Feed() {
  const { posts, loading, error, refresh } = usePosts();
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  if (loading && posts.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error && posts.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <Text style={{ textAlign: "center", opacity: 0.7 }}>
          Error loading feed: {error}
        </Text>
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          justifyContent: "center",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: "700" }}>Feed</Text>
        <Text style={{ fontSize: 16, opacity: 0.7, textAlign: "center" }}>
          No posts yet. Check in at an event to create the first post!
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          padding: 16,
          paddingTop: 60,
          borderBottomWidth: 1,
          borderBottomColor: "#e0e0e0",
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: "700" }}>Feed</Text>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} />
        }
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: "#e0e0e0" }} />
        )}
        renderItem={({ item }) => (
          <View style={{ padding: 16, gap: 12 }}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: "#e0e0e0",
                }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "600" }}>
                  {item.profile?.username || "Unknown"}
                </Text>
                <Text style={{ fontSize: 14, opacity: 0.7 }}>
                  {item.event?.title || "Unknown event"}
                </Text>
              </View>
              <Text style={{ fontSize: 12, opacity: 0.5 }}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>

            {/* Photo */}
            {item.photo_path && (
              item.camera_mode === "dual" && item.front_photo_path ? (
                <DualCameraPost
                  backPhotoPath={item.photo_path}
                  frontPhotoPath={item.front_photo_path}
                  style={{
                    width: "100%",
                    aspectRatio: 3 / 4,
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                />
              ) : (
                <PostImage
                  photoPath={item.photo_path}
                  style={{
                    width: "100%",
                    aspectRatio: 3 / 4,
                    borderRadius: 12,
                  }}
                />
              )
            )}

            {/* Caption */}
            {item.caption && (
              <Text style={{ fontSize: 14 }}>{item.caption}</Text>
            )}

            {/* Engagement Row */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 8 }}>
              {/* Reactions */}
              <ReactionBar postId={item.id} />

              {/* Comments Button */}
              <Pressable
                onPress={() => setSelectedPostId(item.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ fontSize: 14, color: "#666" }}>
                  💬 {item.comment_count > 0 ? item.comment_count : "Comment"}
                </Text>
              </Pressable>
            </View>
          </View>
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
    </View>
  );
}

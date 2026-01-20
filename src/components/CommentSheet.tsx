import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import type { PostComment } from "../types/database";

type CommentWithProfile = PostComment & {
  profile: {
    username: string;
  } | null;
};

type CommentSheetProps = {
  postId: string;
  visible: boolean;
  onClose: () => void;
};

export function CommentSheet({ postId, visible, onClose }: CommentSheetProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<CommentWithProfile[]>([]);
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      loadComments();
    }
  }, [visible, postId]);

  async function loadComments() {
    setLoading(true);

    // Fetch comments
    const { data: commentsData, error: commentsError } = await supabase
      .from("post_comments")
      .select("*")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    if (commentsError || !commentsData) {
      setLoading(false);
      return;
    }

    // Fetch profiles for all unique user IDs
    const userIds = [...new Set(commentsData.map((c: any) => c.user_id))];
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", userIds);

    // Create a map of user_id -> profile
    const profileMap = new Map(
      (profilesData || []).map((p: any) => [p.id, p])
    );

    // Combine comments with profiles
    const commentsWithProfiles = commentsData.map((comment: any) => ({
      ...comment,
      profile: profileMap.get(comment.user_id) || null,
    }));

    setComments(commentsWithProfiles as any);
    setLoading(false);
  }

  async function handleSubmit() {
    if (!user || !commentText.trim() || submitting) return;

    const content = commentText.trim();
    if (content.length > 500) {
      Alert.alert("Error", "Comment must be 500 characters or less");
      return;
    }

    setSubmitting(true);

    try {
      // Insert the comment first
      const { data: commentData, error: insertError } = await supabase
        .from("post_comments")
        .insert({ post_id: postId, user_id: user.id, content } as any)
        .select()
        .single();

      if (insertError) {
        console.error("[Comment] Insert error:", insertError);
        Alert.alert("Error", `Failed to post comment: ${insertError.message}`);
        return;
      }

      // Then fetch the profile separately
      const { data: profileData } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single();

      // Combine the data
      if (commentData) {
        const commentWithProfile = {
          ...(commentData as any),
          profile: profileData || null,
        };
        console.log("[Comment] Posted successfully:", commentWithProfile);
        setComments((prev) => [...prev, commentWithProfile as any]);
        setCommentText("");
      }
    } catch (error) {
      console.error("[Comment] Exception:", error);
      Alert.alert("Error", `Failed to post comment: ${error}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: string) {
    Alert.alert(
      "Delete Comment",
      "Are you sure you want to delete this comment?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("post_comments")
              .delete()
              .eq("id", commentId)
              .eq("user_id", user?.id || "");

            if (!error) {
              setComments((prev) => prev.filter((c) => c.id !== commentId));
            }
          },
        },
      ]
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Comments</Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {/* Comments List */}
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {loading ? "Loading comments..." : "No comments yet"}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.commentItem}>
              <View style={styles.commentHeader}>
                <Text style={styles.username}>
                  {item.profile?.username || "Unknown"}
                </Text>
                <Text style={styles.timestamp}>
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Text style={styles.commentText}>{item.content}</Text>
              {item.user_id === user?.id && (
                <Pressable
                  onPress={() => handleDelete(item.id)}
                  style={styles.deleteButton}
                >
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              )}
            </View>
          )}
        />

        {/* Input Box */}
        <View style={styles.inputContainer}>
          <TextInput
            value={commentText}
            onChangeText={setCommentText}
            placeholder="Add a comment..."
            multiline
            maxLength={500}
            style={styles.input}
          />
          <Pressable
            onPress={handleSubmit}
            disabled={!commentText.trim() || submitting}
            style={[
              styles.submitButton,
              (!commentText.trim() || submitting) && styles.submitButtonDisabled,
            ]}
          >
            <Text
              style={[
                styles.submitText,
                (!commentText.trim() || submitting) && styles.submitTextDisabled,
              ]}
            >
              {submitting ? "..." : "Post"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeButton: {
    padding: 8,
  },
  closeText: {
    fontSize: 24,
    color: "#666",
  },
  listContent: {
    padding: 16,
  },
  empty: {
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
  },
  commentItem: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  commentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  username: {
    fontSize: 14,
    fontWeight: "600",
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  deleteButton: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  deleteText: {
    fontSize: 12,
    color: "#ff3b30",
    fontWeight: "600",
  },
  inputContainer: {
    flexDirection: "row",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    gap: 12,
  },
  input: {
    flex: 1,
    padding: 12,
    borderRadius: 20,
    backgroundColor: "#f5f5f5",
    fontSize: 14,
    maxHeight: 100,
  },
  submitButton: {
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#007AFF",
  },
  submitTextDisabled: {
    color: "#999",
  },
});

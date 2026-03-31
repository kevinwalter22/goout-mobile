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
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBlockUser } from "../hooks/useBlockUser";
import { useContentReport } from "../hooks/useContentReport";
import { Avatar } from "./Avatar";
import { ReportSheet } from "./ReportSheet";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";
import { captureError, captureWarning } from "../lib/logger";
import { friendlyMessage } from "../lib/errorMessages";
import { checkBeforeSubmit } from "../lib/moderation/textModeration";
import { useEnforcement } from "../hooks/useEnforcement";
import type { PostComment } from "../types/database";

type CommentWithProfile = PostComment & {
  profile: {
    username: string;
    avatar_url: string | null;
  } | null;
};

type CommentSheetProps = {
  postId: string;
  visible: boolean;
  onClose: () => void;
};

export function CommentSheet({ postId, visible, onClose }: CommentSheetProps) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { blockedIds, blockUser } = useBlockUser();
  const { isSuspended, suspendedUntil } = useEnforcement();
  const [comments, setComments] = useState<CommentWithProfile[]>([]);
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ commentId: string; userId: string } | null>(null);

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
      .from("public_profiles")
      .select("id, username, avatar_url")
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

    // Enforcement check
    if (isSuspended) {
      const untilStr = suspendedUntil
        ? ` until ${new Date(suspendedUntil).toLocaleDateString()}`
        : "";
      Alert.alert("Account Suspended", `Your account is suspended${untilStr}. You cannot comment.`);
      return;
    }

    const content = commentText.trim();
    if (content.length > 500) {
      Alert.alert("Error", "Comment must be 500 characters or less");
      return;
    }

    // Rate limit check
    try {
      const { error: rlError } = await supabase.rpc("check_comment_rate_limit");
      if (rlError) {
        Alert.alert("Slow down", "You're commenting too quickly. Please try again later.");
        return;
      }
    } catch {
      // Don't block on rate limit failure
    }

    const modCheck = checkBeforeSubmit(content, "comment");
    if (!modCheck.allowed) {
      Alert.alert("Can't post", modCheck.reason);
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
        captureError(insertError, { action: "commentInsert", postId });
        Alert.alert("Error", friendlyMessage(insertError));
        return;
      }

      // Then fetch the profile separately
      const { data: profileData } = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", user.id)
        .single();

      // Combine the data
      if (commentData) {
        const commentWithProfile = {
          ...(commentData as any),
          profile: profileData || null,
        };
        setComments((prev) => [...prev, commentWithProfile as any]);
        setCommentText("");

        // Notify the post author (fire-and-forget; edge fn skips self-comments)
        supabase.functions
          .invoke("send-notification", {
            body: {
              type: "post_comment",
              post_id: postId,
              comment_id: (commentData as any).id,
              actor_id: user.id,
            },
          })
          .catch((err) => captureWarning("send-notification failed", { type: "post_comment", err }));
      }
    } catch (error) {
      captureError(error, { action: "commentSubmit", postId });
      Alert.alert("Error", friendlyMessage(error));
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
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: colors.surface }]}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: colors.separator }]}>
          <Text style={[styles.title, { color: colors.text }]}>Comments</Text>
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={8}>
            <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
          </Pressable>
        </View>

        {/* Comments List */}
        <FlatList
          data={comments.filter((c) => !blockedIds.has(c.user_id))}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                {loading ? "Loading comments..." : "No comments yet"}
              </Text>
              {!loading && (
                <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
                  Be the first to comment!
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.commentItem, { borderBottomColor: colors.borderLight }]}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable onPress={() => router.push(`/user/${item.user_id}` as any)}>
                  <Avatar
                    avatarUrl={item.profile?.avatar_url || null}
                    size={32}
                  />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <View style={styles.commentHeader}>
                    <Pressable onPress={() => router.push(`/user/${item.user_id}` as any)}>
                      <Text style={[styles.username, { color: colors.text }]}>
                        {item.profile?.username || "Unknown"}
                      </Text>
                    </Pressable>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={[styles.timestamp, { color: colors.textTertiary }]}>
                        {new Date(item.created_at).toLocaleDateString()}
                      </Text>
                      {item.user_id !== user?.id && (
                        <Pressable
                          onPress={() => setReportTarget({ commentId: item.id, userId: item.user_id })}
                          hitSlop={8}
                        >
                          <Ionicons name="ellipsis-horizontal" size={16} color={colors.textTertiary} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                  {item.moderation_status === "quarantined" && item.user_id === user?.id && (
                    <View style={{
                      backgroundColor: Colors.warning + "18",
                      borderRadius: 4,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      alignSelf: "flex-start",
                      marginTop: 2,
                    }}>
                      <Text style={{ fontSize: 11, color: Colors.warning }}>Pending review</Text>
                    </View>
                  )}
                  {item.moderation_status === "blocked" && item.user_id === user?.id ? (
                    <Text style={[styles.commentText, { color: colors.textTertiary, fontStyle: "italic" }]}>
                      This comment has been removed.
                    </Text>
                  ) : (
                    <Text style={[styles.commentText, { color: colors.text }]}>{item.content}</Text>
                  )}
                  {item.user_id === user?.id && (
                    <Pressable
                      onPress={() => handleDelete(item.id)}
                      style={styles.deleteButton}
                    >
                      <Text style={[styles.deleteText, { color: Colors.error }]}>Delete</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          )}
        />

        {/* Input Box */}
        <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 16), borderTopColor: colors.separator }]}>
          <View style={{ flex: 1 }}>
            <TextInput
              value={commentText}
              onChangeText={setCommentText}
              placeholder="Add a comment..."
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={500}
              style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text }]}
            />
            <Text style={[styles.charCounter, { color: colors.textTertiary }]}>
              {commentText.length}/500
            </Text>
          </View>
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
                (!commentText.trim() || submitting) && [styles.submitTextDisabled, { color: colors.textTertiary }],
              ]}
            >
              {submitting ? "..." : "Post"}
            </Text>
          </Pressable>
        </View>
        {/* Report Sheet for comments */}
        {reportTarget && (
          <ReportSheet
            visible={!!reportTarget}
            onClose={() => setReportTarget(null)}
            targetType="comment"
            targetId={reportTarget.commentId}
            targetUserId={reportTarget.userId}
            onBlockUser={async (userId) => {
              const ok = await blockUser(userId);
              if (ok) {
                Alert.alert("User Blocked", "Their comments will no longer appear.");
              }
              setReportTarget(null);
            }}
          />
        )}
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
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
  },
  emptyHint: {
    fontSize: 14,
    color: "#ccc",
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
    padding: 12,
    borderRadius: 20,
    backgroundColor: "#f5f5f5",
    fontSize: 14,
    maxHeight: 100,
  },
  charCounter: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 4,
    marginLeft: 12,
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
    color: Colors.primary,
  },
  submitTextDisabled: {
    color: "#999",
  },
});

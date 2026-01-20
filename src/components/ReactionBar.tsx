import { useState, useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import type { PostReaction } from "../types/database";

type ReactionBarProps = {
  postId: string;
};

type ReactionCounts = {
  [emoji: string]: number;
};

const EMOJI_OPTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢"] as const;

export function ReactionBar({ postId }: ReactionBarProps) {
  const { user } = useAuth();
  const [reactions, setReactions] = useState<PostReaction[]>([]);
  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load reactions for this post
  useEffect(() => {
    loadReactions();
  }, [postId]);

  async function loadReactions() {
    const { data, error } = await supabase
      .from("post_reactions")
      .select("*")
      .eq("post_id", postId);

    if (!error && data) {
      const reactions = data as PostReaction[];
      setReactions(reactions);
      // Find user's reaction
      const myReaction = reactions.find((r) => r.user_id === user?.id);
      setUserReaction(myReaction?.emoji || null);
    }
  }

  async function toggleReaction(emoji: string) {
    if (!user || loading) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      if (userReaction === emoji) {
        // Remove reaction
        const { error } = await supabase
          .from("post_reactions")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", user.id);

        if (!error) {
          setUserReaction(null);
          setReactions((prev) => prev.filter((r) => r.user_id !== user.id));
        }
      } else {
        // Add or update reaction (UPSERT via unique constraint)
        const { data, error } = await supabase
          .from("post_reactions")
          .upsert(
            { post_id: postId, user_id: user.id, emoji } as any,
            { onConflict: "post_id,user_id" }
          )
          .select()
          .single();

        if (!error && data) {
          setUserReaction(emoji);
          // Update reactions list
          setReactions((prev) => {
            const filtered = prev.filter((r) => r.user_id !== user.id);
            return [...filtered, data];
          });
        }
      }
    } catch (error) {
      console.error("Error toggling reaction:", error);
    } finally {
      setLoading(false);
    }
  }

  // Calculate counts per emoji
  const counts: ReactionCounts = reactions.reduce((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
    return acc;
  }, {} as ReactionCounts);

  return (
    <View style={styles.container}>
      {EMOJI_OPTIONS.map((emoji) => {
        const count = counts[emoji] || 0;
        const isActive = userReaction === emoji;

        // Only show if has count or is available to react
        if (count === 0 && !isActive) return null;

        return (
          <Pressable
            key={emoji}
            onPress={() => toggleReaction(emoji)}
            disabled={loading}
            style={[
              styles.reactionButton,
              isActive && styles.reactionButtonActive,
            ]}
          >
            <Text style={styles.emoji}>{emoji}</Text>
            {count > 0 && (
              <Text style={[styles.count, isActive && styles.countActive]}>
                {count}
              </Text>
            )}
          </Pressable>
        );
      })}

      {/* Show all emojis as options if no reactions yet */}
      {reactions.length === 0 && (
        <View style={styles.emptyRow}>
          {EMOJI_OPTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => toggleReaction(emoji)}
              disabled={loading}
              style={styles.emojiOption}
            >
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  reactionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#f5f5f5",
  },
  reactionButtonActive: {
    backgroundColor: "#000",
  },
  emoji: {
    fontSize: 16,
  },
  count: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
  },
  countActive: {
    color: "#fff",
  },
  emptyRow: {
    flexDirection: "row",
    gap: 8,
  },
  emojiOption: {
    padding: 4,
  },
});

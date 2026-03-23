import { useState, useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../contexts/ThemeContext";
import { reactionSync } from "../utils/reactionSync";
import type { PostReaction } from "../types/database";

type ReactionBarProps = {
  postId: string;
  /** Pre-loaded reactions from usePosts batch query — avoids N+1 per-post fetches */
  initialReactions?: { emoji: string; user_id: string }[];
};

type ReactionCounts = {
  [emoji: string]: number;
};

const EMOJI_OPTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢"] as const;

export function ReactionBar({ postId, initialReactions }: ReactionBarProps) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [reactions, setReactions] = useState<PostReaction[]>([]);
  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSelfEmit = useRef(false);

  // Seed from batch-loaded data or fetch individually
  useEffect(() => {
    if (initialReactions) {
      const seeded = initialReactions.map((r) => ({
        post_id: postId,
        ...r,
      })) as PostReaction[];
      setReactions(seeded);
      const myReaction = seeded.find((r) => r.user_id === user?.id);
      setUserReaction(myReaction?.emoji || null);
    } else {
      loadReactions();
    }
  }, [postId]);

  // Subscribe to cross-instance reaction sync (e.g. feed ↔ post detail)
  useEffect(() => {
    return reactionSync.subscribe(postId, ({ reactions: r, userReaction: ur }) => {
      if (isSelfEmit.current) { isSelfEmit.current = false; return; }
      setReactions(r as PostReaction[]);
      setUserReaction(ur);
    });
  }, [postId]);

  async function loadReactions() {
    const { data, error } = await supabase
      .from("post_reactions")
      .select("*")
      .eq("post_id", postId);

    if (!error && data) {
      const reactions = data as PostReaction[];
      setReactions(reactions);
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
          const updated = reactions.filter((r) => r.user_id !== user.id);
          setUserReaction(null);
          setReactions(updated);
          isSelfEmit.current = true;
          reactionSync.emit(postId, { reactions: updated, userReaction: null });
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
          const updated = [...reactions.filter((r) => r.user_id !== user.id), data] as PostReaction[];
          setUserReaction(emoji);
          setReactions(updated);
          isSelfEmit.current = true;
          reactionSync.emit(postId, { reactions: updated, userReaction: emoji });
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

        return (
          <Pressable
            key={emoji}
            onPress={() => toggleReaction(emoji)}
            disabled={loading}
            style={[
              styles.reactionButton,
              { backgroundColor: colors.surfaceVariant },
              isActive && [styles.reactionButtonActive, { backgroundColor: colors.text }],
            ]}
          >
            <Text style={styles.emoji}>{emoji}</Text>
            {count > 0 && (
              <Text
                style={[
                  styles.count,
                  { color: colors.textSecondary },
                  isActive && [styles.countActive, { color: colors.surface }],
                ]}
              >
                {count}
              </Text>
            )}
          </Pressable>
        );
      })}
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

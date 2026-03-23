/**
 * Hook for user item feedback (upvote, confirm, downvote, report closed).
 *
 * Provides optimistic state updates with silent error handling,
 * following the fire-and-forget pattern from interactionLogger.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export type FeedbackType = "upvote" | "confirm" | "downvote" | "report_closed";

interface UseItemFeedbackReturn {
  currentFeedback: FeedbackType | null;
  loading: boolean;
  submitting: boolean;
  submitFeedback: (type: FeedbackType) => Promise<void>;
  removeFeedback: () => Promise<void>;
}

export function useItemFeedback(exploreItemId: string): UseItemFeedbackReturn {
  const { user } = useAuth();
  const [currentFeedback, setCurrentFeedback] = useState<FeedbackType | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Load existing feedback on mount
  useEffect(() => {
    if (!user || !exploreItemId) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const { data, error } = await supabase.rpc("get_my_item_feedback", {
          p_user_id: user!.id,
          p_explore_item_id: exploreItemId,
        });

        if (!error && data) {
          setCurrentFeedback(data as FeedbackType);
        }
      } catch (err) {
        if (__DEV__) console.log("[useItemFeedback] Load failed:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user, exploreItemId]);

  const submitFeedback = useCallback(
    async (type: FeedbackType) => {
      if (!user || submitting) return;

      // Toggle: tapping the same type removes feedback
      if (type === currentFeedback) {
        await removeFeedbackInner();
        return;
      }

      // Optimistic update
      const previousFeedback = currentFeedback;
      setCurrentFeedback(type);
      setSubmitting(true);

      try {
        const { error } = await supabase.rpc("submit_item_feedback", {
          p_user_id: user.id,
          p_explore_item_id: exploreItemId,
          p_feedback_type: type,
        });

        if (error) {
          // Revert on error
          setCurrentFeedback(previousFeedback);
          if (__DEV__) console.log("[useItemFeedback] Submit failed:", error.message);
        }
      } catch (err) {
        setCurrentFeedback(previousFeedback);
        if (__DEV__) console.log("[useItemFeedback] Submit error:", err);
      } finally {
        setSubmitting(false);
      }
    },
    [user, exploreItemId, currentFeedback, submitting],
  );

  const removeFeedbackInner = useCallback(async () => {
    if (!user) return;

    const previousFeedback = currentFeedback;
    setCurrentFeedback(null);
    setSubmitting(true);

    try {
      const { error } = await supabase.rpc("delete_item_feedback", {
        p_user_id: user.id,
        p_explore_item_id: exploreItemId,
      });

      if (error) {
        setCurrentFeedback(previousFeedback);
        if (__DEV__) console.log("[useItemFeedback] Delete failed:", error.message);
      }
    } catch (err) {
      setCurrentFeedback(previousFeedback);
      if (__DEV__) console.log("[useItemFeedback] Delete error:", err);
    } finally {
      setSubmitting(false);
    }
  }, [user, exploreItemId, currentFeedback]);

  const removeFeedback = useCallback(async () => {
    await removeFeedbackInner();
  }, [removeFeedbackInner]);

  return {
    currentFeedback,
    loading,
    submitting,
    submitFeedback,
    removeFeedback,
  };
}

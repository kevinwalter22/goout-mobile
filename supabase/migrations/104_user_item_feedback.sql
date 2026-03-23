-- ============================================================================
-- User Item Feedback System
-- ============================================================================
-- Allows users to upvote, confirm, downvote, or report items as closed.
-- Feeds into the recommender scoring engine as a community feedback signal,
-- and auto-suppresses items with enough "closed" reports.
--
-- Rollback:
--   DROP MATERIALIZED VIEW IF EXISTS item_feedback_agg;
--   DROP FUNCTION IF EXISTS submit_item_feedback(UUID, UUID, TEXT);
--   DROP FUNCTION IF EXISTS delete_item_feedback(UUID, UUID);
--   DROP FUNCTION IF EXISTS get_my_item_feedback(UUID, UUID);
--   DROP FUNCTION IF EXISTS get_item_feedback_scores(UUID[]);
--   DROP FUNCTION IF EXISTS admin_negative_feedback_items(INT);
--   DROP TABLE IF EXISTS user_item_feedback;
--   DELETE FROM feature_flags WHERE flag_name = 'community_feedback';
-- ============================================================================

-- ============================================================================
-- 1. Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_item_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  explore_item_id UUID NOT NULL REFERENCES public.explore_items(id) ON DELETE CASCADE,
  feedback_type   TEXT NOT NULL CHECK (feedback_type IN ('upvote','confirm','downvote','report_closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, explore_item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_item_feedback_item
  ON user_item_feedback (explore_item_id);

CREATE INDEX IF NOT EXISTS idx_user_item_feedback_user
  ON user_item_feedback (user_id);

CREATE INDEX IF NOT EXISTS idx_user_item_feedback_item_type
  ON user_item_feedback (explore_item_id, feedback_type);

-- Auto-update timestamps
CREATE OR REPLACE TRIGGER trg_user_item_feedback_updated
  BEFORE UPDATE ON user_item_feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 2. RLS
-- ============================================================================

ALTER TABLE user_item_feedback ENABLE ROW LEVEL SECURITY;

-- Users can read their own feedback
CREATE POLICY "users_read_own_feedback" ON user_item_feedback
  FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can read all feedback
CREATE POLICY "admins_read_all_feedback" ON user_item_feedback
  FOR SELECT
  USING (auth.role() = 'service_role');

-- No INSERT/UPDATE/DELETE policies — all writes via SECURITY DEFINER RPCs

-- ============================================================================
-- 3. Materialized view: per-item aggregates
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS item_feedback_agg AS
SELECT
  explore_item_id,
  COUNT(*) FILTER (WHERE feedback_type = 'upvote')       AS upvote_count,
  COUNT(*) FILTER (WHERE feedback_type = 'confirm')       AS confirm_count,
  COUNT(*) FILTER (WHERE feedback_type = 'downvote')      AS downvote_count,
  COUNT(*) FILTER (WHERE feedback_type = 'report_closed') AS closed_count,
  COUNT(*)                                                 AS total_count,
  -- Weighted net score: confirm(+3) upvote(+1) downvote(-1) closed(-2)
  (
    COUNT(*) FILTER (WHERE feedback_type = 'confirm') * 3 +
    COUNT(*) FILTER (WHERE feedback_type = 'upvote') * 1 +
    COUNT(*) FILTER (WHERE feedback_type = 'downvote') * -1 +
    COUNT(*) FILTER (WHERE feedback_type = 'report_closed') * -2
  )::INT AS net_score
FROM user_item_feedback
GROUP BY explore_item_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_feedback_agg_item
  ON item_feedback_agg (explore_item_id);

-- ============================================================================
-- 4. submit_item_feedback RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION submit_item_feedback(
  p_user_id UUID,
  p_explore_item_id UUID,
  p_feedback_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_closed_count INT;
BEGIN
  -- Rate limit: 30 per 10 minutes
  PERFORM check_rate_limit(p_user_id, 'item_feedback', 30, 600);

  -- Validate feedback type
  IF p_feedback_type NOT IN ('upvote', 'confirm', 'downvote', 'report_closed') THEN
    RAISE EXCEPTION 'Invalid feedback type: %', p_feedback_type;
  END IF;

  -- Upsert: one feedback per user per item
  INSERT INTO user_item_feedback (user_id, explore_item_id, feedback_type)
  VALUES (p_user_id, p_explore_item_id, p_feedback_type)
  ON CONFLICT (user_id, explore_item_id) DO UPDATE SET
    feedback_type = EXCLUDED.feedback_type,
    updated_at = NOW();

  -- Refresh materialized view
  REFRESH MATERIALIZED VIEW CONCURRENTLY item_feedback_agg;

  -- Auto-suppression: if 3+ users report as closed, suppress the item
  SELECT COUNT(*) INTO v_closed_count
  FROM user_item_feedback
  WHERE explore_item_id = p_explore_item_id
    AND feedback_type = 'report_closed';

  IF v_closed_count >= 3 THEN
    UPDATE explore_items
    SET is_admin_suppressed = TRUE,
        admin_suppressed_reason = 'auto:community_closed_reports'
    WHERE id = p_explore_item_id
      AND is_admin_suppressed = FALSE;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_item_feedback(UUID, UUID, TEXT) TO authenticated;

-- ============================================================================
-- 5. delete_item_feedback RPC (for undo/toggle-off)
-- ============================================================================

CREATE OR REPLACE FUNCTION delete_item_feedback(
  p_user_id UUID,
  p_explore_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM user_item_feedback
  WHERE user_id = p_user_id
    AND explore_item_id = p_explore_item_id;

  REFRESH MATERIALIZED VIEW CONCURRENTLY item_feedback_agg;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_item_feedback(UUID, UUID) TO authenticated;

-- ============================================================================
-- 6. get_my_item_feedback RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION get_my_item_feedback(
  p_user_id UUID,
  p_explore_item_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_type TEXT;
BEGIN
  SELECT feedback_type INTO v_type
  FROM user_item_feedback
  WHERE user_id = p_user_id
    AND explore_item_id = p_explore_item_id;

  RETURN v_type; -- NULL if no feedback
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_item_feedback(UUID, UUID) TO authenticated;

-- ============================================================================
-- 7. get_item_feedback_scores RPC (batch lookup for recommender)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_item_feedback_scores(
  p_item_ids UUID[]
)
RETURNS TABLE(explore_item_id UUID, net_score INT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT fa.explore_item_id, fa.net_score
  FROM item_feedback_agg fa
  WHERE fa.explore_item_id = ANY(p_item_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION get_item_feedback_scores(UUID[]) TO authenticated;

-- ============================================================================
-- 8. admin_negative_feedback_items RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_negative_feedback_items(
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  explore_item_id UUID,
  title TEXT,
  kind TEXT,
  category TEXT,
  net_score INT,
  upvote_count BIGINT,
  confirm_count BIGINT,
  downvote_count BIGINT,
  closed_count BIGINT,
  total_count BIGINT,
  is_admin_suppressed BOOLEAN,
  admin_suppressed_reason TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    fa.explore_item_id,
    ei.title,
    ei.kind::TEXT,
    ei.category,
    fa.net_score,
    fa.upvote_count,
    fa.confirm_count,
    fa.downvote_count,
    fa.closed_count,
    fa.total_count,
    ei.is_admin_suppressed,
    ei.admin_suppressed_reason
  FROM item_feedback_agg fa
  JOIN explore_items ei ON ei.id = fa.explore_item_id
  ORDER BY fa.net_score ASC, fa.total_count DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_negative_feedback_items(INT) TO authenticated;

-- ============================================================================
-- 9. Feature flag
-- ============================================================================

INSERT INTO feature_flags (flag_name, is_enabled)
VALUES ('community_feedback', true)
ON CONFLICT (flag_name) DO NOTHING;

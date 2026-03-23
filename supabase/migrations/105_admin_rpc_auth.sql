-- ============================================================================
-- Fix Admin RPC Authorization (105)
-- ============================================================================
-- Adds is_current_user_admin() guard to all admin-only RPCs that were
-- mistakenly granted to 'authenticated' without an authorization check.
--
-- Affected functions:
--   admin_suppress_item          (migration 095)
--   admin_unsuppress_item        (migration 095)
--   admin_bulk_suppress          (migration 095)
--   admin_recurring_item_audit   (migration 095, also converted sql→plpgsql)
--   admin_negative_feedback_items (migration 104)
-- ============================================================================

-- ============================================================================
-- 1. admin_suppress_item
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_suppress_item(
  p_item_id UUID,
  p_reason TEXT DEFAULT 'manual'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  UPDATE explore_items
  SET is_admin_suppressed = TRUE,
      admin_suppressed_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_suppress_item(UUID, TEXT) TO authenticated;

-- ============================================================================
-- 2. admin_unsuppress_item
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_unsuppress_item(
  p_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  UPDATE explore_items
  SET is_admin_suppressed = FALSE,
      admin_suppressed_reason = NULL,
      updated_at = NOW()
  WHERE id = p_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_unsuppress_item(UUID) TO authenticated;

-- ============================================================================
-- 3. admin_bulk_suppress
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_bulk_suppress(
  p_sub_categories TEXT[] DEFAULT NULL,
  p_title_pattern TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT 'bulk_rule'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  UPDATE explore_items
  SET is_admin_suppressed = TRUE,
      admin_suppressed_reason = p_reason,
      updated_at = NOW()
  WHERE deleted_at IS NULL
    AND is_admin_suppressed = FALSE
    AND (
      (p_sub_categories IS NOT NULL AND sub_category = ANY(p_sub_categories))
      OR
      (p_title_pattern IS NOT NULL AND title ~* p_title_pattern)
    );

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_suppress(TEXT[], TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 4. admin_recurring_item_audit
--    Converted from LANGUAGE sql to plpgsql to support the auth guard.
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_recurring_item_audit(
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  id UUID,
  title TEXT,
  category TEXT,
  sub_category TEXT,
  tags TEXT[],
  tag_count INT,
  normalized_confidence INT,
  relevance_tier SMALLINT,
  is_admin_suppressed BOOLEAN,
  source_name TEXT,
  kind TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    ei.id,
    ei.title,
    ei.category,
    ei.sub_category,
    ei.tags,
    COALESCE(array_length(ei.tags, 1), 0) AS tag_count,
    ei.normalized_confidence,
    ei.relevance_tier,
    ei.is_admin_suppressed,
    es.name AS source_name,
    ei.kind::TEXT
  FROM explore_items ei
  LEFT JOIN event_sources es ON ei.source_id = es.id
  WHERE ei.deleted_at IS NULL
    AND NOT ei.is_duplicate
    AND ei.priority >= 0
  ORDER BY COALESCE(array_length(ei.tags, 1), 0) DESC, ei.normalized_confidence DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_recurring_item_audit(INT) TO authenticated;

-- ============================================================================
-- 5. admin_negative_feedback_items
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
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

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

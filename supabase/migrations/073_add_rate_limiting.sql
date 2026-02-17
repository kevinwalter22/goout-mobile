-- Migration 073: Lightweight per-user rate limiting for user-facing RPCs
--
-- Creates a user_rate_limits table and check_rate_limit() helper.
-- Adds rate limit checks to: match_contacts, get_friend_recommendations,
-- log_interaction_and_update_affinity.
--
-- Limits are generous enough for normal use but block automated abuse.

-- ============================================================================
-- 1. Rate limits table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_rate_limits (
  user_id       UUID NOT NULL,
  action        TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, action)
);

ALTER TABLE user_rate_limits ENABLE ROW LEVEL SECURITY;

-- No policies — only SECURITY DEFINER functions can access this table.
REVOKE ALL ON user_rate_limits FROM anon, authenticated;

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON user_rate_limits (window_start);

-- ============================================================================
-- 2. Helper: check_rate_limit(action, limit, window_seconds)
--    Uses auth.uid(). Raises exception if limit exceeded.
--    Called from SECURITY DEFINER functions (bypasses RLS).
-- ============================================================================

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_action TEXT,
  p_limit INT,
  p_window_seconds INT
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INT;
BEGIN
  -- Look up existing rate limit row
  SELECT window_start, request_count
  INTO v_window_start, v_count
  FROM user_rate_limits
  WHERE user_id = p_user_id AND action = p_action;

  IF NOT FOUND THEN
    -- First request for this action
    INSERT INTO user_rate_limits (user_id, action, window_start, request_count)
    VALUES (p_user_id, p_action, NOW(), 1);
    RETURN;
  END IF;

  -- Check if window has expired
  IF v_window_start + (p_window_seconds || ' seconds')::INTERVAL < NOW() THEN
    -- Reset window
    UPDATE user_rate_limits
    SET window_start = NOW(), request_count = 1
    WHERE user_id = p_user_id AND action = p_action;
    RETURN;
  END IF;

  -- Window still active — check count
  IF v_count >= p_limit THEN
    RAISE EXCEPTION 'Rate limit exceeded for %. Try again later.', p_action;
  END IF;

  -- Increment counter
  UPDATE user_rate_limits
  SET request_count = request_count + 1
  WHERE user_id = p_user_id AND action = p_action;
END;
$$;

-- ============================================================================
-- 3. Recreate match_contacts with rate limit (5 per minute)
-- ============================================================================

CREATE OR REPLACE FUNCTION match_contacts(
  p_user_id UUID,
  p_hashed_phones TEXT[]
)
RETURNS TABLE(user_id UUID, username TEXT, avatar_url TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM check_rate_limit(p_user_id, 'match_contacts', 5, 60);

  RETURN QUERY
  WITH my_friends AS (
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS friend_id
    FROM friendships f
    WHERE f.status = 'accepted'
      AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
  ),
  pending_excluded AS (
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS excluded_id
    FROM friendships f
    WHERE f.status = 'pending'
      AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
  ),
  excluded AS (
    SELECT p_user_id AS id
    UNION
    SELECT friend_id AS id FROM my_friends
    UNION
    SELECT excluded_id AS id FROM pending_excluded
  )
  SELECT p.id AS user_id, p.username, p.avatar_url
  FROM profiles p
  WHERE p.phone_hash = ANY(p_hashed_phones)
    AND p.id NOT IN (SELECT e.id FROM excluded e)
  ORDER BY p.username ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION match_contacts(UUID, TEXT[]) TO authenticated;

-- ============================================================================
-- 4. Recreate get_friend_recommendations with rate limit (20 per minute)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_friend_recommendations(
  p_user_id UUID,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(user_id UUID, username TEXT, avatar_url TEXT, mutual_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM check_rate_limit(p_user_id, 'get_friend_recommendations', 20, 60);

  RETURN QUERY
  WITH my_friends AS (
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS friend_id
    FROM friendships f
    WHERE f.status = 'accepted'
      AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
  ),
  pending_excluded AS (
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS excluded_id
    FROM friendships f
    WHERE f.status = 'pending'
      AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
  ),
  excluded AS (
    SELECT p_user_id AS id
    UNION
    SELECT friend_id AS id FROM my_friends
    UNION
    SELECT excluded_id AS id FROM pending_excluded
  ),
  foaf AS (
    SELECT
      CASE WHEN f2.user_id = mf.friend_id THEN f2.friend_id ELSE f2.user_id END AS candidate_id,
      mf.friend_id AS via_friend
    FROM my_friends mf
    JOIN friendships f2
      ON f2.status = 'accepted'
      AND (f2.user_id = mf.friend_id OR f2.friend_id = mf.friend_id)
    WHERE CASE WHEN f2.user_id = mf.friend_id THEN f2.friend_id ELSE f2.user_id END
      NOT IN (SELECT id FROM excluded)
  )
  SELECT
    foaf.candidate_id AS user_id,
    p.username,
    p.avatar_url,
    COUNT(DISTINCT foaf.via_friend) AS mutual_count
  FROM foaf
  JOIN profiles p ON p.id = foaf.candidate_id
  GROUP BY foaf.candidate_id, p.username, p.avatar_url
  ORDER BY mutual_count DESC, p.username ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_friend_recommendations(UUID, INT) TO authenticated;

-- ============================================================================
-- 5. Recreate log_interaction_and_update_affinity with rate limit (60 per minute)
-- ============================================================================

CREATE OR REPLACE FUNCTION log_interaction_and_update_affinity(
  p_user_id UUID,
  p_explore_item_id UUID,
  p_event_type TEXT,
  p_item_kind TEXT,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS VOID AS $$
DECLARE
  v_events_count INTEGER;
  v_activities_count INTEGER;
  v_total INTEGER;
  v_tags TEXT[];
  v_weight FLOAT;
BEGIN
  PERFORM check_rate_limit(p_user_id, 'log_interaction', 60, 60);

  -- a) Insert interaction event
  INSERT INTO user_item_events (user_id, explore_item_id, event_type, metadata)
  VALUES (p_user_id, p_explore_item_id, p_event_type, p_metadata);

  -- b) Upsert type affinity counters
  INSERT INTO user_type_affinity (user_id, events_engaged, activities_engaged, last_updated_at)
  VALUES (
    p_user_id,
    CASE WHEN p_item_kind = 'event' THEN 1 ELSE 0 END,
    CASE WHEN p_item_kind = 'activity' THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    events_engaged = user_type_affinity.events_engaged
      + CASE WHEN p_item_kind = 'event' THEN 1 ELSE 0 END,
    activities_engaged = user_type_affinity.activities_engaged
      + CASE WHEN p_item_kind = 'activity' THEN 1 ELSE 0 END,
    last_updated_at = NOW();

  -- Recompute biases from updated counts
  SELECT events_engaged, activities_engaged
  INTO v_events_count, v_activities_count
  FROM user_type_affinity
  WHERE user_id = p_user_id;

  v_total := v_events_count + v_activities_count;

  IF v_total > 0 THEN
    UPDATE user_type_affinity SET
      event_bias = v_events_count::FLOAT / v_total,
      activity_bias = v_activities_count::FLOAT / v_total
    WHERE user_id = p_user_id;
  END IF;

  -- c) Look up item tags and update tag affinity
  SELECT tags INTO v_tags FROM explore_items WHERE id = p_explore_item_id;

  -- Determine weight based on event type
  v_weight := CASE p_event_type
    WHEN 'open_detail' THEN 1.0
    WHEN 'rsvp' THEN 1.5
    WHEN 'share' THEN 2.0
    WHEN 'check_in_post' THEN 3.0
    ELSE 1.0
  END;

  -- Update tag affinity (reuse existing function from migration 058)
  IF v_tags IS NOT NULL AND array_length(v_tags, 1) > 0 THEN
    PERFORM update_user_tag_affinity(p_user_id, v_tags, v_weight);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION log_interaction_and_update_affinity(UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;

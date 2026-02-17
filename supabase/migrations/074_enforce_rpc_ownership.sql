-- Migration 074: Enforce auth.uid() ownership on all user-facing SECURITY DEFINER RPCs
--
-- Fixes: 9 SECURITY DEFINER functions accept p_user_id without verifying it
-- matches auth.uid(). A malicious caller could pass another user's ID.
--
-- After this migration every user-facing RPC that takes p_user_id will reject
-- calls where p_user_id != auth.uid().

-- ============================================================================
-- 1. Helper: assert_caller — reusable ownership check
-- ============================================================================

CREATE OR REPLACE FUNCTION assert_caller(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Forbidden: caller does not own this resource';
  END IF;
END;
$$;

-- ============================================================================
-- 2. save_phone_number — MUTATES profiles (last defined: 072)
-- ============================================================================

CREATE OR REPLACE FUNCTION save_phone_number(
  p_user_id UUID,
  p_phone_number TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_clean TEXT;
  v_hash TEXT;
  v_salt TEXT;
BEGIN
  PERFORM assert_caller(p_user_id);

  -- Handle removal
  IF p_phone_number IS NULL OR trim(p_phone_number) = '' THEN
    UPDATE profiles
    SET phone_number = NULL,
        phone_hash = NULL,
        phone_verified_at = NULL
    WHERE id = p_user_id;
    RETURN;
  END IF;

  v_clean := trim(p_phone_number);

  -- Validate E.164 format: starts with +, 8-15 digits total
  IF v_clean !~ '^\+[0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Invalid phone number format. Use E.164 format (e.g. +14155551234)';
  END IF;

  -- Read salt from secure config table (never hardcoded in function body)
  SELECT value INTO v_salt FROM app_secrets WHERE key = 'phone_hash_salt';
  IF v_salt IS NULL OR v_salt = '' THEN
    RAISE EXCEPTION 'Phone hash salt not configured. Insert into app_secrets (key, value) VALUES (''phone_hash_salt'', ''<salt>'');';
  END IF;

  -- Compute SHA-256 hash with salt (must match client-side hashing)
  v_hash := encode(digest(v_clean || v_salt, 'sha256'), 'hex');

  UPDATE profiles
  SET phone_number = v_clean,
      phone_hash = v_hash,
      phone_verified_at = NOW()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION save_phone_number(UUID, TEXT) TO authenticated;

-- ============================================================================
-- 3. update_user_progression — MUTATES profiles (last defined: 014)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_progression(
  p_user_id UUID,
  p_xp_amount INTEGER,
  p_post_date TIMESTAMPTZ
)
RETURNS TABLE(new_xp INTEGER, new_streak INTEGER) AS $$
DECLARE
  v_current_xp INTEGER;
  v_current_streak INTEGER;
  v_last_post_date DATE;
  v_post_date DATE;
  v_new_xp INTEGER;
  v_new_streak INTEGER;
  v_days_diff INTEGER;
BEGIN
  PERFORM assert_caller(p_user_id);

  v_post_date := p_post_date::DATE;

  SELECT xp, streak, last_post_date
  INTO v_current_xp, v_current_streak, v_last_post_date
  FROM profiles
  WHERE id = p_user_id;

  v_new_xp := v_current_xp + p_xp_amount;

  IF v_last_post_date IS NULL THEN
    v_new_streak := 1;
  ELSE
    v_days_diff := v_post_date - v_last_post_date;
    IF v_days_diff = 0 THEN
      v_new_streak := v_current_streak;
    ELSIF v_days_diff = 1 THEN
      v_new_streak := v_current_streak + 1;
    ELSE
      v_new_streak := 1;
    END IF;
  END IF;

  UPDATE profiles
  SET xp = v_new_xp,
      streak = v_new_streak,
      last_post_date = v_post_date
  WHERE id = p_user_id;

  RETURN QUERY SELECT v_new_xp, v_new_streak;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_user_progression(UUID, INTEGER, TIMESTAMPTZ) TO authenticated;

-- ============================================================================
-- 4. update_user_tag_affinity — MUTATES user_tag_affinity (last defined: 058)
--    Also called internally by log_interaction_and_update_affinity.
--    Internal calls pass the same p_user_id from the already-validated caller.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_tag_affinity(
  p_user_id UUID,
  p_tags TEXT[],
  p_weight FLOAT DEFAULT 1.0
)
RETURNS VOID AS $$
BEGIN
  PERFORM assert_caller(p_user_id);

  IF p_tags IS NULL OR array_length(p_tags, 1) IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO user_tag_affinity (user_id, tag, score, interaction_count, last_interaction_at, updated_at)
  SELECT
    p_user_id,
    LOWER(TRIM(unnest(p_tags))),
    p_weight,
    1,
    NOW(),
    NOW()
  ON CONFLICT (user_id, tag) DO UPDATE SET
    score = user_tag_affinity.score + p_weight,
    interaction_count = user_tag_affinity.interaction_count + 1,
    last_interaction_at = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_user_tag_affinity(UUID, TEXT[], FLOAT) TO authenticated;

-- ============================================================================
-- 5. log_interaction_and_update_affinity — MUTATES (last defined: 073)
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
  PERFORM assert_caller(p_user_id);
  PERFORM check_rate_limit(p_user_id, 'log_interaction', 60, 60);

  INSERT INTO user_item_events (user_id, explore_item_id, event_type, metadata)
  VALUES (p_user_id, p_explore_item_id, p_event_type, p_metadata);

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

  SELECT tags INTO v_tags FROM explore_items WHERE id = p_explore_item_id;

  v_weight := CASE p_event_type
    WHEN 'open_detail' THEN 1.0
    WHEN 'rsvp' THEN 1.5
    WHEN 'share' THEN 2.0
    WHEN 'check_in_post' THEN 3.0
    ELSE 1.0
  END;

  IF v_tags IS NOT NULL AND array_length(v_tags, 1) > 0 THEN
    PERFORM update_user_tag_affinity(p_user_id, v_tags, v_weight);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION log_interaction_and_update_affinity(UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ============================================================================
-- 6. match_contacts — READS as another user (last defined: 073)
-- ============================================================================

CREATE OR REPLACE FUNCTION match_contacts(
  p_user_id UUID,
  p_hashed_phones TEXT[]
)
RETURNS TABLE(user_id UUID, username TEXT, avatar_url TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM assert_caller(p_user_id);
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
-- 7. get_friend_recommendations — READS as another user (last defined: 073)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_friend_recommendations(
  p_user_id UUID,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(user_id UUID, username TEXT, avatar_url TEXT, mutual_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM assert_caller(p_user_id);
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
-- 8. get_friends_going_for_items — READS friend data (last defined: 058)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_friends_going_for_items(
  p_user_id UUID,
  p_item_ids UUID[]
)
RETURNS TABLE(explore_item_id UUID, friends_going_count INTEGER) AS $$
BEGIN
  PERFORM assert_caller(p_user_id);

  RETURN QUERY
  WITH friend_ids AS (
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END as fid
    FROM friendships f
    WHERE (f.user_id = p_user_id OR f.friend_id = p_user_id)
      AND f.status = 'accepted'
  )
  SELECT
    r.explore_item_id,
    COUNT(*)::INTEGER as friends_going_count
  FROM explore_item_rsvps r
  INNER JOIN friend_ids fi ON r.user_id = fi.fid
  WHERE r.explore_item_id = ANY(p_item_ids)
  GROUP BY r.explore_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_friends_going_for_items(UUID, UUID[]) TO authenticated;

-- ============================================================================
-- 9. get_user_tag_affinity — READS another user's preferences (last defined: 058)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_tag_affinity(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(tag TEXT, score FLOAT, interaction_count INTEGER) AS $$
BEGIN
  PERFORM assert_caller(p_user_id);

  RETURN QUERY
  SELECT
    uta.tag,
    uta.score,
    uta.interaction_count
  FROM user_tag_affinity uta
  WHERE uta.user_id = p_user_id
  ORDER BY uta.score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_tag_affinity(UUID, INTEGER) TO authenticated;

-- ============================================================================
-- 10. get_user_type_affinity — READS another user's bias (last defined: 059)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_type_affinity(p_user_id UUID)
RETURNS TABLE(event_bias FLOAT, activity_bias FLOAT, total_interactions INTEGER) AS $$
BEGIN
  PERFORM assert_caller(p_user_id);

  RETURN QUERY
  SELECT uta.event_bias, uta.activity_bias,
         (uta.events_engaged + uta.activities_engaged)::INTEGER AS total_interactions
  FROM user_type_affinity uta
  WHERE uta.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0.5::FLOAT AS event_bias, 0.5::FLOAT AS activity_bias, 0::INTEGER AS total_interactions;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_type_affinity(UUID) TO authenticated;

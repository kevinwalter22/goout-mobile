-- Migration 060: Friend recommendations RPC (friends-of-friends)
-- Provides get_friend_recommendations(p_user_id, p_limit) for "People You May Know"

CREATE OR REPLACE FUNCTION get_friend_recommendations(
  p_user_id UUID,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(user_id UUID, username TEXT, avatar_url TEXT, mutual_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH my_friends AS (
    -- All accepted friends (bidirectional)
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS friend_id
    FROM friendships f
    WHERE f.status = 'accepted'
      AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
  ),
  pending_excluded AS (
    -- Anyone with a pending request in either direction
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS excluded_id
    FROM friendships f
    WHERE f.status = 'pending'
      AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
  ),
  excluded AS (
    -- Me + my friends + pending requests
    SELECT p_user_id AS id
    UNION
    SELECT friend_id AS id FROM my_friends
    UNION
    SELECT excluded_id AS id FROM pending_excluded
  ),
  foaf AS (
    -- Friends of my friends, excluding anyone in excluded set
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

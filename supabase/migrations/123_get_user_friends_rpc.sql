-- ============================================================================
-- get_user_friends RPC (123)
-- ============================================================================
-- Returns the friends list of a given user with access control:
--   - Caller is the user themselves → full list
--   - Caller is an accepted friend of p_user_id → full list
--   - Caller is not friends with p_user_id → empty set
--
-- SECURITY DEFINER bypasses the friendships RLS policy which only returns rows
-- where the caller is a direct party — preventing friends-of-friends visibility.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_friends(p_user_id UUID)
RETURNS TABLE (id UUID, username TEXT, avatar_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pp.id, pp.username, pp.avatar_url
  FROM friendships f
  JOIN public_profiles pp
    ON pp.id = CASE
      WHEN f.user_id = p_user_id THEN f.friend_id
      ELSE f.user_id
    END
  WHERE f.status = 'accepted'
    AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
    -- Access gate: caller must be the owner OR an accepted friend
    AND (
      auth.uid() = p_user_id
      OR EXISTS (
        SELECT 1 FROM friendships cf
        WHERE cf.status = 'accepted'
          AND (
            (cf.user_id   = auth.uid() AND cf.friend_id = p_user_id)
            OR (cf.friend_id = auth.uid() AND cf.user_id   = p_user_id)
          )
      )
    )
  ORDER BY pp.username;
$$;

GRANT EXECUTE ON FUNCTION get_user_friends(UUID) TO authenticated;

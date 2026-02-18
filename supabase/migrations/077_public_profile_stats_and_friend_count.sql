-- ============================================================================
-- 077: Expose XP/streak in public_profiles + add get_friend_count RPC
--
-- Context:
--   The restricted (non-friend) profile view needs to display XP, streak,
--   and an accurate friend count. Currently:
--     - public_profiles only exposes id, username, avatar_url, bio, created_at
--     - friendships RLS prevents non-friends from counting another user's friends
--
-- Changes:
--   1. Replace public_profiles VIEW to include xp, streak, last_post_date
--      (gamification metrics — NOT sensitive like phone_hash or is_admin)
--   2. Add get_friend_count(p_user_id) RPC (SECURITY DEFINER) so any
--      authenticated user can see an accurate friend count without
--      accessing the friendships table directly.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_friend_count(UUID);
--   CREATE OR REPLACE VIEW public_profiles AS
--     SELECT id, username, avatar_url, bio, created_at FROM profiles;
-- ============================================================================


-- ============================================================================
-- 1. Update public_profiles VIEW to include gamification stats
-- ============================================================================
CREATE OR REPLACE VIEW public_profiles AS
  SELECT id, username, avatar_url, bio, created_at, xp, streak, last_post_date
  FROM profiles;

-- Ensure grants are preserved after CREATE OR REPLACE
GRANT SELECT ON public_profiles TO authenticated;
REVOKE ALL ON public_profiles FROM anon;


-- ============================================================================
-- 2. Add get_friend_count RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_friend_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer FROM friendships
  WHERE status = 'accepted'
    AND (user_id = p_user_id OR friend_id = p_user_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_count(UUID) TO authenticated;

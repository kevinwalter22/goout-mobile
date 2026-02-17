-- ============================================================================
-- 071: Restrict profiles exposure + public_profiles view
--
-- Fixes CRIT-3 from security audit: profiles table is readable by all
-- authenticated users, exposing phone_hash, is_admin, xp, streak, etc.
--
-- Changes:
--   1. Drop the over-broad SELECT policy from 057
--   2. Drop the old friends policy from 011 (missing status='accepted' check)
--   3. Create tighter policy: self + accepted friends only
--   4. Create admin policy for moderation access
--   5. Create public_profiles VIEW with safe columns only
--
-- Rollback:
--   DROP VIEW IF EXISTS public_profiles;
--   DROP POLICY IF EXISTS "Users can read own and accepted friends profiles" ON profiles;
--   DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
--   -- Then re-create the 057 + 011 policies
-- ============================================================================


-- ============================================================================
-- 1. Drop the over-broad policy from migration 057
-- ============================================================================
-- This policy lets ANY authenticated user read ALL profile columns.
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON profiles;


-- ============================================================================
-- 2. Drop the old friends policy from migration 011
-- ============================================================================
-- This policy predates the friendship status column (added in 061) and does
-- not check status = 'accepted', so pending/declined requests also grant
-- full profile access.
DROP POLICY IF EXISTS "Users can read own and friends profiles" ON profiles;


-- ============================================================================
-- 3. Tighter SELECT policy: self + accepted friends
-- ============================================================================
CREATE POLICY "Users can read own and accepted friends profiles"
  ON profiles FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND (
          (user_id = auth.uid() AND friend_id = profiles.id)
          OR (friend_id = auth.uid() AND user_id = profiles.id)
        )
    )
  );


-- ============================================================================
-- 4. Admin policy for moderation / audit
-- ============================================================================
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (public.is_current_user_admin());


-- ============================================================================
-- 5. public_profiles VIEW — safe columns only
-- ============================================================================
-- Runs as the view owner (postgres), intentionally bypassing profiles RLS.
-- This is safe because the view only exposes non-sensitive columns.
-- Access is controlled via GRANT (authenticated only).
CREATE VIEW public_profiles AS
  SELECT id, username, avatar_url, bio, created_at
  FROM profiles;

GRANT SELECT ON public_profiles TO authenticated;
REVOKE ALL ON public_profiles FROM anon;

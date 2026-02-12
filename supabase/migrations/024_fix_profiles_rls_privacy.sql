-- Migration 024: Fix Profiles RLS Privacy Breach
-- P0 Fix: The wide-open search policy allows any authenticated user to read any profile
-- This migration removes that policy and creates a secure RPC for searching

-- Step 1: Drop the wide-open SELECT policy that was causing the breach
DROP POLICY IF EXISTS "Authenticated users can search profiles" ON profiles;

-- Step 2: Create a secure RPC function for profile search
-- This returns ONLY public fields (id, username, avatar_url) - NOT bio, xp, streak
-- Runs with SECURITY DEFINER to bypass RLS, but only returns safe fields
CREATE OR REPLACE FUNCTION search_profiles(query TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Require at least 2 characters for search
  IF char_length(query) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.avatar_url
  FROM profiles p
  WHERE p.username ILIKE '%' || query || '%'
  ORDER BY p.username
  LIMIT 20;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION search_profiles(TEXT) TO authenticated;

-- Note: The remaining policies on profiles are:
-- 1. "Users can read own and friends profiles" - restricted to self or accepted friends
-- 2. "Users can update own profile" - self only
-- 3. "Users can insert own profile" - self only (signup)
--
-- Private fields (bio, xp, streak) are now only visible to:
-- - The user themselves
-- - Accepted friends (via friendship check)

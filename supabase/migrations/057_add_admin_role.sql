-- ============================================================================
-- Migration 057: Admin Roles
-- ============================================================================
-- Adds is_admin flag to profiles for administrative access.
-- Admins can edit/delete any explore_item.
-- ============================================================================

-- Add is_admin column to profiles (defaults to false)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN profiles.is_admin IS 'Whether this user has admin privileges to manage all explore items';

-- ============================================================================
-- RLS POLICY UPDATES: Admin Access to explore_items
-- ============================================================================

-- Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Drop existing update/delete policies and recreate with admin support
DROP POLICY IF EXISTS "Users can update own events" ON explore_items;
DROP POLICY IF EXISTS "Users can delete own events" ON explore_items;

-- Users can update their own events OR admins can update any event
CREATE POLICY "Users can update own events or admins any"
  ON explore_items FOR UPDATE
  USING (
    created_by_user_id = auth.uid()
    OR public.is_current_user_admin()
  )
  WITH CHECK (
    created_by_user_id = auth.uid()
    OR public.is_current_user_admin()
  );

-- Users can delete their own events OR admins can delete any event
CREATE POLICY "Users can delete own events or admins any"
  ON explore_items FOR DELETE
  USING (
    created_by_user_id = auth.uid()
    OR public.is_current_user_admin()
  );

-- Allow admins to insert events without created_by_user_id (system events)
DROP POLICY IF EXISTS "Users can create own events" ON explore_items;

CREATE POLICY "Users can create own events or admins any"
  ON explore_items FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND (
      created_by_user_id = auth.uid()
      OR public.is_current_user_admin()
    )
  );

-- ============================================================================
-- PROFILES RLS: Allow reading admin status
-- ============================================================================

-- Allow authenticated users to read is_admin status of any profile
-- (needed for UI to check if current user is admin)
DROP POLICY IF EXISTS "Anyone can read profiles" ON profiles;
DROP POLICY IF EXISTS "Users can read any profile" ON profiles;

CREATE POLICY "Authenticated users can read profiles"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

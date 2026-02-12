-- ============================================================================
-- Migration 056: User-Created Events (Friends-Only MVP)
-- ============================================================================
-- Adds support for user-created events with friends-only visibility.
-- Users can create events visible only to themselves and accepted friends.
-- ============================================================================

-- Create visibility enum (if not exists)
DO $$ BEGIN
  CREATE TYPE event_visibility AS ENUM ('friends_only', 'public');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add user-created event columns to explore_items
ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS visibility event_visibility DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN explore_items.created_by_user_id IS 'User ID if this is a user-created event (NULL for system-ingested events)';
COMMENT ON COLUMN explore_items.visibility IS 'Visibility setting for user-created events (NULL for system events = public by default)';

-- Index for efficient queries on user-created events
CREATE INDEX IF NOT EXISTS idx_explore_items_created_by
  ON explore_items(created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

-- Create event source for user-created events (for tracking/analytics)
INSERT INTO event_sources (name, type, is_enabled, config_json) VALUES
  ('User Created', 'manual', true, '{"description": "Events created by users in the app"}')
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- RLS POLICIES: Friends-Only Visibility
-- ============================================================================

-- Drop the old simple SELECT policy
DROP POLICY IF EXISTS "Authenticated users can read explore_items" ON explore_items;

-- New visibility-aware SELECT policy
-- System events (no created_by_user_id) are visible to all authenticated users
-- User-created events follow visibility rules:
--   - Creator can always see their own events
--   - Friends-only events visible to accepted friends
--   - Public events visible to all (for future use)
CREATE POLICY "Authenticated users can read visible explore_items"
  ON explore_items FOR SELECT
  USING (
    auth.role() = 'authenticated' AND (
      -- System events (no creator) are visible to all authenticated users
      created_by_user_id IS NULL
      OR
      -- User-created events: creator can always see their own
      created_by_user_id = auth.uid()
      OR
      -- Friends-only: only accepted friends can see
      (visibility = 'friends_only' AND EXISTS (
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND (
            (user_id = auth.uid() AND friend_id = explore_items.created_by_user_id)
            OR
            (friend_id = auth.uid() AND user_id = explore_items.created_by_user_id)
          )
      ))
      OR
      -- Public visibility (for future expansion)
      visibility = 'public'
    )
  );

-- Users can create their own events
-- Requires: authenticated user, created_by_user_id must match current user
CREATE POLICY "Users can create own events"
  ON explore_items FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND created_by_user_id = auth.uid()
  );

-- Users can update their own events only
CREATE POLICY "Users can update own events"
  ON explore_items FOR UPDATE
  USING (created_by_user_id = auth.uid())
  WITH CHECK (created_by_user_id = auth.uid());

-- Users can delete their own events only
CREATE POLICY "Users can delete own events"
  ON explore_items FOR DELETE
  USING (created_by_user_id = auth.uid());

-- Note: The existing "Service role can manage explore_items" policy remains
-- for backend operations (migrations, ingestion pipelines, etc.)

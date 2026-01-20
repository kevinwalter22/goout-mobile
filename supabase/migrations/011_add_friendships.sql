-- Migration 011: Add Friendships and Update Feed Scoping
-- Phase 7: Friends system + friend-scoped feed visibility

-- Bidirectional friendship table
-- When user A adds user B as friend, insert one row: (A → B)
-- Query checks both directions: (A → B) OR (B → A)
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Only one friendship record per direction
  UNIQUE(user_id, friend_id),

  -- Prevent self-friendship
  CONSTRAINT no_self_friendship CHECK (user_id != friend_id)
);

-- Indexes for bidirectional lookups
CREATE INDEX friendships_user_id_idx ON friendships(user_id);
CREATE INDEX friendships_friend_id_idx ON friendships(friend_id);

-- Enable RLS
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Friendships
-- Users can see their own friendships (both directions)
CREATE POLICY "Users can view own friendships"
  ON friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Users can add friends (insert user_id = self)
CREATE POLICY "Users can add friends"
  ON friendships FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can remove friendships they created or received
CREATE POLICY "Users can remove friendships"
  ON friendships FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Update Posts RLS Policy: Change from "all authenticated" to "friends only"
-- Drop old policy
DROP POLICY IF EXISTS "Authenticated users can read posts" ON posts;

-- New friend-scoped policy
CREATE POLICY "Users can read own and friends posts"
  ON posts FOR SELECT
  USING (
    auth.uid() = user_id OR  -- Own posts
    EXISTS (
      SELECT 1 FROM friendships
      WHERE (user_id = auth.uid() AND friend_id = posts.user_id)
         OR (friend_id = auth.uid() AND user_id = posts.user_id)
    )
  );

-- Update Profiles RLS Policy: Allow viewing friends' profiles
-- Drop old policy
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;

-- New policy: own + friends
CREATE POLICY "Users can read own and friends profiles"
  ON profiles FOR SELECT
  USING (
    auth.uid() = id OR  -- Own profile
    EXISTS (
      SELECT 1 FROM friendships
      WHERE (user_id = auth.uid() AND friend_id = profiles.id)
         OR (friend_id = auth.uid() AND user_id = profiles.id)
    )
  );

-- NEW: Allow searching users by username (for adding friends)
CREATE POLICY "Authenticated users can search profiles"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

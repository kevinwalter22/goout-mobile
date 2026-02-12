-- Migration 013: Add friend request status to friendships
-- Changes instant-friend behavior to request → accept flow

-- Add status column to friendships table
ALTER TABLE friendships
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined'));

-- Update existing friendships to 'accepted' (preserve current behavior for existing data)
UPDATE friendships SET status = 'accepted' WHERE status = 'pending';

-- Add index for faster queries on status
CREATE INDEX IF NOT EXISTS friendships_status_idx ON friendships(status);

-- Update RLS policies to handle friend requests

-- Drop old policies
DROP POLICY IF EXISTS "Users can view own friendships" ON friendships;
DROP POLICY IF EXISTS "Users can add friends" ON friendships;
DROP POLICY IF EXISTS "Users can remove friendships" ON friendships;

-- New policies for friend request system

-- Users can view friendships where they are involved (any status)
CREATE POLICY "Users can view own friendships and requests"
  ON friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Users can send friend requests (insert with status = 'pending')
CREATE POLICY "Users can send friend requests"
  ON friendships FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Users can accept or decline incoming friend requests
CREATE POLICY "Users can respond to friend requests"
  ON friendships FOR UPDATE
  USING (auth.uid() = friend_id AND status = 'pending')
  WITH CHECK (status IN ('accepted', 'declined'));

-- Users can delete friendships they created or were accepted
CREATE POLICY "Users can remove friendships"
  ON friendships FOR DELETE
  USING (
    auth.uid() = user_id OR
    (auth.uid() = friend_id AND status = 'accepted')
  );

-- Note: This migration preserves existing friendships by marking them as 'accepted'
-- All new friend requests will start as 'pending' and require acceptance

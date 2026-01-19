-- Add latitude and longitude to events table if they don't exist
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude FLOAT8;
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude FLOAT8;

-- Drop and recreate posts table with simplified schema
DROP TABLE IF EXISTS post_photos CASCADE;
DROP TABLE IF EXISTS posts CASCADE;

-- Create simplified posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  caption TEXT,
  photo_path TEXT NOT NULL,
  camera_mode TEXT NOT NULL CHECK (camera_mode IN ('front', 'back', 'dual')),
  latitude FLOAT8,
  longitude FLOAT8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT caption_length CHECK (caption IS NULL OR char_length(caption) <= 100)
);

-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for posts
CREATE POLICY "Users can create own post"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can read posts"
  ON posts FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete own post"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX posts_user_id_idx ON posts(user_id);
CREATE INDEX posts_event_id_idx ON posts(event_id);
CREATE INDEX posts_created_at_idx ON posts(created_at DESC);

-- Update sample events with test coordinates (San Francisco area)
-- You should replace these with real coordinates for your events
UPDATE events SET
  latitude = 37.7749 + (RANDOM() * 0.1 - 0.05),
  longitude = -122.4194 + (RANDOM() * 0.1 - 0.05)
WHERE latitude IS NULL AND longitude IS NULL;

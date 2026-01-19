-- Create posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  caption TEXT,
  camera_mode TEXT NOT NULL CHECK (camera_mode IN ('front', 'back', 'dual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT caption_length CHECK (caption IS NULL OR char_length(caption) <= 100)
);

-- Create post_photos table
CREATE TABLE post_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('front', 'back', 'single')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_photos ENABLE ROW LEVEL SECURITY;

-- RLS Policies for posts
-- Users can insert their own posts
CREATE POLICY "Users can create own post"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- All authenticated users can read posts (V1: public feed)
-- In Phase 4, this will be restricted to friends only
CREATE POLICY "Authenticated users can read posts"
  ON posts FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can delete their own posts
CREATE POLICY "Users can delete own post"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for post_photos
-- Users can insert photos for their own posts
CREATE POLICY "Users can create own post photos"
  ON post_photos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_photos.post_id
      AND posts.user_id = auth.uid()
    )
  );

-- All authenticated users can read post photos
CREATE POLICY "Authenticated users can read post photos"
  ON post_photos FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can delete photos for their own posts
CREATE POLICY "Users can delete own post photos"
  ON post_photos FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_photos.post_id
      AND posts.user_id = auth.uid()
    )
  );

-- Create indexes for better performance
CREATE INDEX posts_user_id_idx ON posts(user_id);
CREATE INDEX posts_event_id_idx ON posts(event_id);
CREATE INDEX posts_created_at_idx ON posts(created_at DESC);
CREATE INDEX post_photos_post_id_idx ON post_photos(post_id);

-- Fix posts table foreign keys and refresh schema cache
-- This ensures Supabase can properly resolve relationships

-- Drop existing posts table
DROP TABLE IF EXISTS posts CASCADE;

-- Recreate posts table with proper foreign keys
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_id UUID,
  caption TEXT,
  photo_path TEXT NOT NULL,
  camera_mode TEXT NOT NULL CHECK (camera_mode IN ('front', 'back', 'dual')),
  latitude FLOAT8,
  longitude FLOAT8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT caption_length CHECK (caption IS NULL OR char_length(caption) <= 100),
  -- Foreign keys with explicit names
  CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT posts_event_id_fkey FOREIGN KEY (event_id)
    REFERENCES public.events(id) ON DELETE SET NULL
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

-- Create indexes for performance
CREATE INDEX posts_user_id_idx ON posts(user_id);
CREATE INDEX posts_event_id_idx ON posts(event_id);
CREATE INDEX posts_created_at_idx ON posts(created_at DESC);

-- Notify Supabase to reload the schema cache
NOTIFY pgrst, 'reload schema';

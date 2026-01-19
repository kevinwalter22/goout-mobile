-- Fix foreign key constraints for posts table
-- The issue is that the foreign key names might not match what Supabase expects

-- First, check what the actual foreign key names are
DO $$
BEGIN
  -- Drop the posts table and recreate with explicit constraint names
  DROP TABLE IF EXISTS posts CASCADE;

  -- Recreate posts table with explicit foreign key names
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
    CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT posts_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
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
END $$;

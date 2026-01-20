-- Migration 010: Add Reactions and Comments
-- Phase 6: Lightweight engagement features

-- Reactions table (emoji-based, one per user per post)
CREATE TABLE post_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('❤️', '😂', '🔥', '👏', '😮', '😢')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One reaction per user per post (can change emoji, not add multiple)
  UNIQUE(post_id, user_id)
);

-- Comments table (simple text, flat structure)
CREATE TABLE post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX post_reactions_post_id_idx ON post_reactions(post_id);
CREATE INDEX post_reactions_user_id_idx ON post_reactions(user_id);
CREATE INDEX post_comments_post_id_idx ON post_comments(post_id);
CREATE INDEX post_comments_created_at_idx ON post_comments(created_at DESC);

-- Enable RLS
ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Reactions
-- Users can manage their own reactions
CREATE POLICY "Users can manage own reactions"
  ON post_reactions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can read all reactions
CREATE POLICY "Authenticated users can read reactions"
  ON post_reactions FOR SELECT
  USING (auth.role() = 'authenticated');

-- RLS Policies for Comments
-- Users can insert their own comments
CREATE POLICY "Users can create comments"
  ON post_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments"
  ON post_comments FOR DELETE
  USING (auth.uid() = user_id);

-- Authenticated users can read all comments
CREATE POLICY "Authenticated users can read comments"
  ON post_comments FOR SELECT
  USING (auth.role() = 'authenticated');

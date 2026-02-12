-- Migration 023: Add explore_item_id to posts
-- Allows posts to reference explore_items instead of legacy events table

-- 1. Make event_id nullable (if not already)
ALTER TABLE posts ALTER COLUMN event_id DROP NOT NULL;

-- 2. Add explore_item_id column with FK to explore_items
ALTER TABLE posts
ADD COLUMN IF NOT EXISTS explore_item_id UUID REFERENCES explore_items(id) ON DELETE SET NULL;

-- 3. No check constraint - posts can be standalone (both null) or linked to event/explore_item
-- This allows flexibility for future features like standalone posts

-- 4. Add index for explore_item_id queries
CREATE INDEX IF NOT EXISTS idx_posts_explore_item_id ON posts(explore_item_id);

-- 5. Grant permissions
GRANT SELECT ON explore_items TO authenticated;

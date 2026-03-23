-- ============================================================================
-- Item Suppressions / "Not Interested" (093)
-- ============================================================================
-- Allows users to hide items from their explore feed.
-- Suppressed items won't appear in card groups, list, or postable now.
-- ============================================================================

CREATE TABLE IF NOT EXISTS explore_item_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  explore_item_id UUID NOT NULL REFERENCES explore_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, explore_item_id)
);

ALTER TABLE explore_item_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own suppressions"
  ON explore_item_suppressions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own suppressions"
  ON explore_item_suppressions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own suppressions"
  ON explore_item_suppressions FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_suppressions_user_id
  ON explore_item_suppressions(user_id);

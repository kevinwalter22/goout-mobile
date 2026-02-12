-- ============================================================================
-- Add explore_item_rsvps table
-- ============================================================================
-- RSVPs for explore_items (events and activities from the new ingestion system)
-- ============================================================================

CREATE TABLE IF NOT EXISTS explore_item_rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  explore_item_id UUID NOT NULL REFERENCES explore_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, explore_item_id)
);

-- Enable RLS
ALTER TABLE explore_item_rsvps ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Anyone authenticated can read RSVPs (to see who's going)
CREATE POLICY "Authenticated users can read explore_item_rsvps"
  ON explore_item_rsvps FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can insert their own RSVPs
CREATE POLICY "Users can create own explore_item_rsvp"
  ON explore_item_rsvps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own RSVPs
CREATE POLICY "Users can delete own explore_item_rsvp"
  ON explore_item_rsvps FOR DELETE
  USING (auth.uid() = user_id);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS explore_item_rsvps_explore_item_id_idx ON explore_item_rsvps(explore_item_id);
CREATE INDEX IF NOT EXISTS explore_item_rsvps_user_id_idx ON explore_item_rsvps(user_id);

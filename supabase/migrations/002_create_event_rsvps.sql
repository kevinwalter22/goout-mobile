-- Create event_rsvps table
CREATE TABLE event_rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

-- Enable RLS
ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Anyone authenticated can read RSVPs (to see who's going)
CREATE POLICY "Authenticated users can read RSVPs"
  ON event_rsvps FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can insert their own RSVPs
CREATE POLICY "Users can create own RSVP"
  ON event_rsvps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own RSVPs
CREATE POLICY "Users can delete own RSVP"
  ON event_rsvps FOR DELETE
  USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX event_rsvps_event_id_idx ON event_rsvps(event_id);
CREATE INDEX event_rsvps_user_id_idx ON event_rsvps(user_id);

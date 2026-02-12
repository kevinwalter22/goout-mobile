-- Analytics events table for app-level KPI tracking.
-- Stores lightweight, non-PII events that don't tie to a specific explore item.
-- Explore-item interactions (open_detail, rsvp, check_in_post, share) remain in user_item_events.

CREATE TABLE IF NOT EXISTS analytics_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name  text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for querying by event name (dashboard aggregations)
CREATE INDEX idx_analytics_events_name ON analytics_events(event_name);

-- Index for querying by user (debugging / per-user funnels)
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id);

-- Index for time-range queries
CREATE INDEX idx_analytics_events_created ON analytics_events(created_at);

-- RLS: users can only insert their own events, read nothing
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_events_insert ON analytics_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Service role can read all (for dashboard queries)
-- No SELECT policy for authenticated — analytics data is not user-facing

GRANT INSERT ON analytics_events TO authenticated;
GRANT ALL ON analytics_events TO service_role;

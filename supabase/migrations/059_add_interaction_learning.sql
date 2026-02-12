-- Migration 059: User Interaction Learning + Type Affinity
--
-- Adds append-only interaction event logging and derived type affinity
-- (event vs activity preference) for personalized Explore ranking.
-- All affinity updates are consolidated server-side in a single RPC.

-- ============================================================================
-- 1. user_item_events: Append-only interaction log
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  explore_item_id UUID NOT NULL REFERENCES explore_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('open_detail', 'rsvp', 'check_in_post', 'share')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary read pattern: aggregate by user for affinity derivation
CREATE INDEX IF NOT EXISTS idx_user_item_events_user
  ON user_item_events(user_id, created_at DESC);

-- Secondary: lookup by user + item (for potential dedup checks)
CREATE INDEX IF NOT EXISTS idx_user_item_events_user_item
  ON user_item_events(user_id, explore_item_id, event_type);

-- RLS
ALTER TABLE user_item_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own interaction events"
  ON user_item_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own interaction events"
  ON user_item_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages user_item_events"
  ON user_item_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 2. user_type_affinity: Materialized event-vs-activity preference (1 row/user)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_type_affinity (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  events_engaged INTEGER NOT NULL DEFAULT 0,
  activities_engaged INTEGER NOT NULL DEFAULT 0,
  event_bias FLOAT NOT NULL DEFAULT 0.5,
  activity_bias FLOAT NOT NULL DEFAULT 0.5,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE user_type_affinity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own type affinity"
  ON user_type_affinity FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages user_type_affinity"
  ON user_type_affinity FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 3. RPC: log_interaction_and_update_affinity
--    Single call from client that atomically:
--    a) Appends to user_item_events
--    b) Upserts user_type_affinity counters + recomputes bias
--    c) Looks up item tags and updates user_tag_affinity
-- ============================================================================

CREATE OR REPLACE FUNCTION log_interaction_and_update_affinity(
  p_user_id UUID,
  p_explore_item_id UUID,
  p_event_type TEXT,
  p_item_kind TEXT,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS VOID AS $$
DECLARE
  v_events_count INTEGER;
  v_activities_count INTEGER;
  v_total INTEGER;
  v_tags TEXT[];
  v_weight FLOAT;
BEGIN
  -- a) Insert interaction event
  INSERT INTO user_item_events (user_id, explore_item_id, event_type, metadata)
  VALUES (p_user_id, p_explore_item_id, p_event_type, p_metadata);

  -- b) Upsert type affinity counters
  INSERT INTO user_type_affinity (user_id, events_engaged, activities_engaged, last_updated_at)
  VALUES (
    p_user_id,
    CASE WHEN p_item_kind = 'event' THEN 1 ELSE 0 END,
    CASE WHEN p_item_kind = 'activity' THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    events_engaged = user_type_affinity.events_engaged
      + CASE WHEN p_item_kind = 'event' THEN 1 ELSE 0 END,
    activities_engaged = user_type_affinity.activities_engaged
      + CASE WHEN p_item_kind = 'activity' THEN 1 ELSE 0 END,
    last_updated_at = NOW();

  -- Recompute biases from updated counts
  SELECT events_engaged, activities_engaged
  INTO v_events_count, v_activities_count
  FROM user_type_affinity
  WHERE user_id = p_user_id;

  v_total := v_events_count + v_activities_count;

  IF v_total > 0 THEN
    UPDATE user_type_affinity SET
      event_bias = v_events_count::FLOAT / v_total,
      activity_bias = v_activities_count::FLOAT / v_total
    WHERE user_id = p_user_id;
  END IF;

  -- c) Look up item tags and update tag affinity
  SELECT tags INTO v_tags FROM explore_items WHERE id = p_explore_item_id;

  -- Determine weight based on event type
  v_weight := CASE p_event_type
    WHEN 'open_detail' THEN 1.0
    WHEN 'rsvp' THEN 1.5
    WHEN 'share' THEN 2.0
    WHEN 'check_in_post' THEN 3.0
    ELSE 1.0
  END;

  -- Update tag affinity (reuse existing function from migration 058)
  IF v_tags IS NOT NULL AND array_length(v_tags, 1) > 0 THEN
    PERFORM update_user_tag_affinity(p_user_id, v_tags, v_weight);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION log_interaction_and_update_affinity(UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ============================================================================
-- 4. RPC: get_user_type_affinity
--    Returns (event_bias, activity_bias, total_interactions) for a user.
--    Returns neutral defaults (0.5, 0.5, 0) if no row exists.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_type_affinity(p_user_id UUID)
RETURNS TABLE(event_bias FLOAT, activity_bias FLOAT, total_interactions INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT uta.event_bias, uta.activity_bias,
         (uta.events_engaged + uta.activities_engaged)::INTEGER AS total_interactions
  FROM user_type_affinity uta
  WHERE uta.user_id = p_user_id;

  -- If no rows, return default neutral values
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0.5::FLOAT AS event_bias, 0.5::FLOAT AS activity_bias, 0::INTEGER AS total_interactions;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_type_affinity(UUID) TO authenticated;

-- ============================================================================
-- 5. Feature flag for type affinity learning
-- ============================================================================

INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, config_json) VALUES
  ('type_affinity_learning', true, 100, '{"weight": 0.06}')
ON CONFLICT (flag_name) DO NOTHING;

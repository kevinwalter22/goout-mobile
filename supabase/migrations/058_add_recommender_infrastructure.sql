-- ============================================================================
-- Hybrid Recommender Infrastructure
-- Wave D1: AI-based recommendations (hybrid: heuristics + optional reranker)
-- ============================================================================

-- ============================================================================
-- User Tag Affinity Tracking
-- ============================================================================
-- Tracks user preferences based on interactions (posts, RSVPs)
-- This is transparent preference learning, not a black-box algorithm

CREATE TABLE IF NOT EXISTS user_tag_affinity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  score FLOAT NOT NULL DEFAULT 0,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_user_tag_affinity_user ON user_tag_affinity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tag_affinity_score ON user_tag_affinity(user_id, score DESC);

-- RLS for user_tag_affinity
ALTER TABLE user_tag_affinity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tag affinity"
  ON user_tag_affinity FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage user_tag_affinity"
  ON user_tag_affinity FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- LLM Reranker Cache
-- ============================================================================
-- Caches reranker results per user per time bucket to minimize API costs

CREATE TABLE IF NOT EXISTS llm_reranker_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  time_bucket TIMESTAMPTZ NOT NULL,
  input_item_ids UUID[] NOT NULL,
  output_ranking JSONB NOT NULL,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_llm_reranker_cache_lookup ON llm_reranker_cache(user_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_llm_reranker_cache_expiry ON llm_reranker_cache(expires_at);

-- RLS for llm_reranker_cache
ALTER TABLE llm_reranker_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage llm_reranker_cache"
  ON llm_reranker_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- Feature Flags Table
-- ============================================================================
-- Centralized feature flag management for recommender features

CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_name TEXT NOT NULL UNIQUE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage INTEGER DEFAULT 100 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  config_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for feature_flags
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read feature_flags"
  ON feature_flags FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage feature_flags"
  ON feature_flags FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Seed feature flags (AI reranker starts disabled, heuristics enabled)
INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, config_json) VALUES
  ('llm_reranker', false, 0, '{"max_tokens": 500, "cache_ttl_hours": 2}'),
  ('weather_boost', true, 100, '{"cache_minutes": 30}'),
  ('friends_rsvp_boost', true, 100, '{"boost_multiplier": 1.5}'),
  ('tag_affinity', true, 100, '{"decay_factor": 0.95, "max_tags_per_user": 20}')
ON CONFLICT (flag_name) DO NOTHING;

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Update tag affinity when user interacts with content
CREATE OR REPLACE FUNCTION update_user_tag_affinity(
  p_user_id UUID,
  p_tags TEXT[],
  p_weight FLOAT DEFAULT 1.0
)
RETURNS VOID AS $$
BEGIN
  -- Skip if no tags provided
  IF p_tags IS NULL OR array_length(p_tags, 1) IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO user_tag_affinity (user_id, tag, score, interaction_count, last_interaction_at, updated_at)
  SELECT
    p_user_id,
    LOWER(TRIM(unnest(p_tags))),
    p_weight,
    1,
    NOW(),
    NOW()
  ON CONFLICT (user_id, tag) DO UPDATE SET
    score = user_tag_affinity.score + p_weight,
    interaction_count = user_tag_affinity.interaction_count + 1,
    last_interaction_at = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION update_user_tag_affinity(UUID, TEXT[], FLOAT) TO authenticated;

-- Get friends going count for multiple items (bulk query for efficiency)
CREATE OR REPLACE FUNCTION get_friends_going_for_items(
  p_user_id UUID,
  p_item_ids UUID[]
)
RETURNS TABLE(explore_item_id UUID, friends_going_count INTEGER) AS $$
BEGIN
  RETURN QUERY
  WITH friend_ids AS (
    SELECT
      CASE WHEN user_id = p_user_id THEN friend_id ELSE user_id END as fid
    FROM friendships
    WHERE (user_id = p_user_id OR friend_id = p_user_id)
      AND status = 'accepted'
  )
  SELECT
    r.explore_item_id,
    COUNT(*)::INTEGER as friends_going_count
  FROM explore_item_rsvps r
  INNER JOIN friend_ids f ON r.user_id = f.fid
  WHERE r.explore_item_id = ANY(p_item_ids)
  GROUP BY r.explore_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_friends_going_for_items(UUID, UUID[]) TO authenticated;

-- Get user's top tag affinities
CREATE OR REPLACE FUNCTION get_user_tag_affinity(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(tag TEXT, score FLOAT, interaction_count INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT
    uta.tag,
    uta.score,
    uta.interaction_count
  FROM user_tag_affinity uta
  WHERE uta.user_id = p_user_id
  ORDER BY uta.score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_user_tag_affinity(UUID, INTEGER) TO authenticated;

-- ============================================================================
-- Budget Tracking for LLM Reranker
-- ============================================================================
-- Extends existing api_usage_counters pattern

INSERT INTO api_usage_counters (service, period_start, requests_used, requests_limit)
VALUES ('llm_reranker', date_trunc('month', CURRENT_DATE)::DATE, 0, 1000)
ON CONFLICT (service, period_start) DO NOTHING;

-- ============================================================================
-- Cleanup Job for Expired Cache Entries
-- ============================================================================
-- Can be called periodically to clean up expired cache entries

CREATE OR REPLACE FUNCTION cleanup_expired_reranker_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM llm_reranker_cache
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

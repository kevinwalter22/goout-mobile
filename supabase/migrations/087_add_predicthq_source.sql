-- ============================================================================
-- Migration 087: Add PredictHQ Source & Partition
-- ============================================================================
-- The enum value 'api_predicthq' already exists in event_source_type
-- (migration 017). This migration adds the source row, fetch partition,
-- and API usage budget counter.
--
-- Rollback:
--   DELETE FROM fetch_partitions WHERE source_id IN
--     (SELECT id FROM event_sources WHERE type = 'api_predicthq');
--   DELETE FROM event_sources WHERE type = 'api_predicthq';
--   DELETE FROM api_usage_counters WHERE service = 'predicthq';
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════
-- 1. PredictHQ source
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO event_sources (name, type, is_enabled, config_json)
VALUES (
  'PredictHQ',
  'api_predicthq',
  true,
  '{
    "api_version": "v1",
    "endpoint": "/v1/events/",
    "default_radius_km": 50,
    "default_categories": [
      "community", "concerts", "conferences", "expos",
      "festivals", "performing-arts", "sports"
    ],
    "monthly_limit": 1000
  }'::JSONB
)
ON CONFLICT (name) DO NOTHING;

-- PredictHQ fetch partition: Potsdam area events
INSERT INTO fetch_partitions (
  source_id, partition_label, config_json, priority, fetch_interval_minutes
)
SELECT
  id,
  'potsdam-events',
  '{
    "lat": 44.6697,
    "lng": -74.9814,
    "radius_km": 50,
    "categories": ["community", "concerts", "conferences", "expos", "festivals", "performing-arts", "sports"],
    "days_ahead": 90,
    "min_rank": 20
  }'::JSONB,
  8,
  720  -- 12 hours (events are more time-sensitive)
FROM event_sources
WHERE type = 'api_predicthq'
ON CONFLICT (source_id, partition_label) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 2. API Usage Budget Counter
-- ═══════════════════════════════════════════════════════════════════

-- PredictHQ: ~1000 events/month free tier, each request returns up to 10
INSERT INTO api_usage_counters (service, period_start, requests_used, requests_limit)
VALUES ('predicthq', date_trunc('month', CURRENT_DATE)::DATE, 0, 500)
ON CONFLICT (service, period_start) DO NOTHING;

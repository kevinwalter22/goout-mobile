-- ============================================================================
-- Web Collector Source Types (Wave 3, Phase 3)
-- ============================================================================
-- Adds enum values for web collectors. All collectors start DISABLED
-- and must be explicitly enabled after review.
--
-- The web collector framework enforces:
-- - robots.txt compliance
-- - Circuit breaker (auto-disable on repeated errors)
-- - DB kill switch (is_enabled = false blocks all fetches)
-- - Rate limiting between requests
-- - Health logging for every cycle
--
-- Rollback:
--   DELETE FROM fetch_partitions
--     WHERE source_id IN (SELECT id FROM event_sources WHERE type::TEXT LIKE 'web_%');
--   DELETE FROM event_sources WHERE type::TEXT LIKE 'web_%';
--   -- Note: enum values cannot be removed in PostgreSQL
-- ============================================================================

-- 1. Add web collector enum values
-- (These are additive — safe to run multiple times with IF NOT EXISTS pattern)
DO $$
BEGIN
  -- Generic web collector type for community calendars, municipal sites, etc.
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'web_community_calendar'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'event_source_type')) THEN
    ALTER TYPE event_source_type ADD VALUE 'web_community_calendar';
  END IF;
END$$;

-- 2. Insert a DISABLED example source (Potsdam community calendar)
-- This is a template — enable only after verifying robots.txt and content structure
INSERT INTO event_sources (name, type, is_enabled, config_json)
VALUES (
  'Potsdam Community Calendar',
  'web_community_calendar',
  false,  -- DISABLED by default — requires explicit opt-in
  '{
    "base_url": null,
    "disabled_reason": "template_only",
    "note": "Enable only after verifying robots.txt allows crawling and configuring base_url",
    "user_agent": "EudaBot/1.0 (+https://euda.app/bot)",
    "request_delay_ms": 2000,
    "max_consecutive_errors": 3
  }'::JSONB
)
ON CONFLICT DO NOTHING;

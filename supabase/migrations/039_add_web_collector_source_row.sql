-- ============================================================================
-- Web Collector Source Row — Part 2 (Wave 3, Phase 3)
-- ============================================================================
-- Inserts the disabled template source row for web_community_calendar.
-- Split from 038 because PostgreSQL requires enum values to be committed
-- before they can be used in DML statements.
--
-- Rollback:
--   DELETE FROM event_sources WHERE type = 'web_community_calendar';
-- ============================================================================

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

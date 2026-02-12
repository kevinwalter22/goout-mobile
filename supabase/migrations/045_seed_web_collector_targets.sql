-- ============================================================================
-- Seed Web Collector Source and Example Targets
-- ============================================================================
-- This migration must run AFTER 044_add_collector_targets.sql to allow the
-- web_collector enum value to be committed before use in INSERT statements.
--
-- Rollback:
--   DELETE FROM collector_targets WHERE source_id IN (
--     SELECT id FROM event_sources WHERE type = 'web_collector'
--   );
--   DELETE FROM event_sources WHERE type = 'web_collector';
-- ============================================================================

-- ============================================================================
-- 1. Seed a generic Web Collector source row
-- ============================================================================

INSERT INTO event_sources (name, type, is_enabled, config_json)
VALUES (
  'Web Collector',
  'web_collector',
  true,  -- Source enabled; individual targets control their own enable state
  jsonb_build_object(
    'description', 'Generic web collector for local event pages',
    'contact_email', 'bot@euda.app'
  )
)
ON CONFLICT (name) DO UPDATE SET
  config_json = EXCLUDED.config_json;

-- ============================================================================
-- 2. Seed example targets (all DISABLED by default)
-- ============================================================================

-- Example: Clarkson University Events
INSERT INTO collector_targets (
  name,
  base_url,
  discovery_urls,
  allowed_paths,
  parsing_strategy,
  dom_selectors,
  is_enabled,
  source_id
)
SELECT
  'Clarkson University Events',
  'https://www.clarkson.edu',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid',
  jsonb_build_object(
    'event_container', '.event-item',
    'title', '.event-title',
    'date', '.event-date',
    'location', '.event-location',
    'description', '.event-description',
    'link', 'a.event-link'
  ),
  false,  -- DISABLED until explicitly enabled
  es.id
FROM event_sources es
WHERE es.name = 'Web Collector'
ON CONFLICT (name) DO NOTHING;

-- Example: SUNY Potsdam Events (if they have a public events page)
INSERT INTO collector_targets (
  name,
  base_url,
  discovery_urls,
  allowed_paths,
  parsing_strategy,
  is_enabled,
  source_id
)
SELECT
  'SUNY Potsdam Events',
  'https://www.potsdam.edu',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid',
  false,  -- DISABLED until explicitly enabled
  es.id
FROM event_sources es
WHERE es.name = 'Web Collector'
ON CONFLICT (name) DO NOTHING;

-- Example: St. Lawrence University Events
INSERT INTO collector_targets (
  name,
  base_url,
  discovery_urls,
  allowed_paths,
  parsing_strategy,
  is_enabled,
  source_id
)
SELECT
  'St. Lawrence University Events',
  'https://www.stlawu.edu',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid',
  false,  -- DISABLED until explicitly enabled
  es.id
FROM event_sources es
WHERE es.name = 'Web Collector'
ON CONFLICT (name) DO NOTHING;

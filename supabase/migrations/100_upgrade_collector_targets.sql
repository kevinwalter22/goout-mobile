-- ============================================================================
-- Upgrade Collector Targets for Local Calendar Connectors
-- ============================================================================
-- Adds source_type categorization, updates existing targets with correct
-- metadata, enables campus targets, and seeds new local targets.
--
-- Rollback:
--   ALTER TABLE collector_targets DROP COLUMN IF EXISTS source_type;
--   -- Then manually revert individual target UPDATEs / DELETEs
-- ============================================================================

-- ============================================================================
-- 1. Add source_type column
-- ============================================================================

ALTER TABLE collector_targets
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'venue';

-- Add check constraint separately (IF NOT EXISTS not supported for constraints)
DO $$ BEGIN
  ALTER TABLE collector_targets
    ADD CONSTRAINT chk_source_type
    CHECK (source_type IN ('campus', 'venue', 'town', 'org'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN collector_targets.source_type IS
  'Categorization: campus (university), venue (bar/restaurant/museum), town (municipal), org (arts council, chamber, etc.)';

-- ============================================================================
-- 2. Update get_enabled_collector_targets() to return source_type
-- ============================================================================

DROP FUNCTION IF EXISTS get_enabled_collector_targets();

CREATE FUNCTION get_enabled_collector_targets()
RETURNS TABLE(
  target_id UUID,
  name TEXT,
  base_url TEXT,
  discovery_urls TEXT[],
  allowed_paths TEXT[],
  parsing_strategy parsing_strategy,
  dom_selectors JSONB,
  user_agent TEXT,
  rate_limit_rpm INTEGER,
  request_delay_ms INTEGER,
  max_pages_per_run INTEGER,
  minutes_since_last_run FLOAT8,
  crawl_frequency_minutes INTEGER,
  source_id UUID,
  town TEXT,
  venue_name TEXT,
  default_category TEXT,
  content_types TEXT[],
  site_config JSONB,
  source_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ct.id AS target_id,
    ct.name,
    ct.base_url,
    ct.discovery_urls,
    ct.allowed_paths,
    ct.parsing_strategy,
    ct.dom_selectors,
    ct.user_agent,
    ct.rate_limit_rpm,
    ct.request_delay_ms,
    ct.max_pages_per_run,
    CASE
      WHEN ct.last_run_at IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (NOW() - ct.last_run_at)) / 60.0)::FLOAT8
      ELSE NULL
    END AS minutes_since_last_run,
    ct.crawl_frequency_minutes,
    ct.source_id,
    ct.town,
    ct.venue_name,
    ct.default_category,
    ct.content_types,
    ct.site_config,
    ct.source_type
  FROM collector_targets ct
  WHERE ct.is_enabled = TRUE
    AND ct.circuit_breaker = 'closed'
    AND (
      ct.last_run_at IS NULL
      OR (NOW() - ct.last_run_at) > (ct.crawl_frequency_minutes * INTERVAL '1 minute')
    )
  ORDER BY
    ct.last_run_at ASC NULLS FIRST
  FOR UPDATE OF ct SKIP LOCKED;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_enabled_collector_targets() TO service_role;

-- ============================================================================
-- 3. Classify and enable existing campus targets (from migrations 045, 062)
-- ============================================================================

-- Clarkson University Events
UPDATE collector_targets
SET source_type = 'campus',
    is_enabled = true,
    parsing_strategy = 'hybrid',
    discovery_urls = ARRAY['/events', '/student-life/student-activities/events'],
    allowed_paths = ARRAY['/events/', '/student-life/'],
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'ignore_patterns', ARRAY['office hours', 'faculty meeting', 'staff meeting']
    )
WHERE name = 'Clarkson University Events';

-- SUNY Potsdam Events
UPDATE collector_targets
SET source_type = 'campus',
    is_enabled = true,
    parsing_strategy = 'hybrid',
    discovery_urls = ARRAY['/events', '/about/calendar'],
    allowed_paths = ARRAY['/events/', '/about/calendar/'],
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'ignore_patterns', ARRAY['office hours', 'advising']
    )
WHERE name = 'SUNY Potsdam Events';

-- St. Lawrence University Events
UPDATE collector_targets
SET source_type = 'campus',
    is_enabled = true,
    parsing_strategy = 'hybrid',
    discovery_urls = ARRAY['/events', '/campus-life/events'],
    allowed_paths = ARRAY['/events/', '/campus-life/'],
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'ignore_patterns', ARRAY['office hours', 'faculty meeting']
    )
WHERE name = 'St. Lawrence University Events';

-- Classify existing town/org targets (from migration 062)
UPDATE collector_targets
SET source_type = 'town'
WHERE name = 'Village of Potsdam Events';

UPDATE collector_targets
SET source_type = 'org'
WHERE name = 'Canton Community Events';

-- ============================================================================
-- 4. Seed new local targets (all DISABLED until verification script confirms)
-- ============================================================================

-- SLC Arts (St. Lawrence County Arts Council)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'SLC Arts',
  'https://www.slcarts.org',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid'::parsing_strategy,
  'org',
  'Potsdam', 'arts', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- North Country Public Radio Events
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'North Country Public Radio Events',
  'https://www.northcountrypublicradio.org',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid'::parsing_strategy,
  'org',
  'Canton', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Potsdam Chamber of Commerce
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Potsdam Chamber of Commerce',
  'https://www.potsdamchamber.com',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid'::parsing_strategy,
  'org',
  'Potsdam', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- SUNY Canton Events
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'SUNY Canton Events',
  'https://www.canton.edu',
  ARRAY['/events', '/campus-life/events'],
  ARRAY['/events/', '/campus-life/'],
  'hybrid'::parsing_strategy,
  'campus',
  'Canton', 'education', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Massena Events (Village of Massena)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Massena Events',
  'https://www.massena.us',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'town',
  'Massena', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Ogdensburg Events
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Ogdensburg Events',
  'https://www.ogdensburg.org',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid'::parsing_strategy,
  'town',
  'Ogdensburg', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Frederic Remington Art Museum
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Frederic Remington Art Museum',
  'https://www.fredericremington.org',
  ARRAY['/events', '/visit/calendar'],
  ARRAY['/events/', '/visit/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Ogdensburg', 'arts', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

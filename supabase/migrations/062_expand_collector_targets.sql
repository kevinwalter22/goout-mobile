-- ============================================================================
-- Expand Collector Targets for Hyperlocal Ingestion (Wave 5 Phase A)
-- ============================================================================
-- Adds town/venue/category/content-type metadata to collector_targets
-- so the normalization adapter can fill in gaps when extraction yields
-- partial data.  Also adds a site_config JSONB escape hatch for per-site
-- tuning (timezone, ignore patterns, etc.) without code changes.
--
-- Rollback:
--   ALTER TABLE collector_targets DROP COLUMN IF EXISTS town,
--     DROP COLUMN IF EXISTS venue_name,
--     DROP COLUMN IF EXISTS default_category,
--     DROP COLUMN IF EXISTS content_types,
--     DROP COLUMN IF EXISTS site_config;
-- ============================================================================

-- ============================================================================
-- 1. New columns on collector_targets
-- ============================================================================

ALTER TABLE collector_targets
  ADD COLUMN IF NOT EXISTS town TEXT,
  ADD COLUMN IF NOT EXISTS venue_name TEXT,
  ADD COLUMN IF NOT EXISTS default_category TEXT,
  ADD COLUMN IF NOT EXISTS content_types TEXT[] DEFAULT '{events}',
  ADD COLUMN IF NOT EXISTS site_config JSONB DEFAULT '{}';

COMMENT ON COLUMN collector_targets.town IS
  'Geographic hint (e.g. Potsdam). Flows to explore_items.town when address parsing fails.';
COMMENT ON COLUMN collector_targets.venue_name IS
  'Default venue name for single-venue sites. Injected when candidate lacks location_name.';
COMMENT ON COLUMN collector_targets.default_category IS
  'Fallback category when keyword inference returns "community".';
COMMENT ON COLUMN collector_targets.content_types IS
  'What this target produces: {events}, {activities}, or {events,activities}.';
COMMENT ON COLUMN collector_targets.site_config IS
  'Per-site tuning JSON: timezone, date_format, ignore_patterns, min_title_length, require_location.';

-- ============================================================================
-- 2. Update get_enabled_collector_targets() to return new columns
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
  site_config JSONB
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
    ct.site_config
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

-- ============================================================================
-- 3. Update existing targets with hyperlocal metadata
-- ============================================================================

UPDATE collector_targets
SET town = 'Potsdam',
    venue_name = 'Clarkson University',
    default_category = 'education',
    content_types = '{events}',
    site_config = '{"timezone": "America/New_York"}'::JSONB
WHERE name = 'Clarkson University Events';

UPDATE collector_targets
SET town = 'Potsdam',
    venue_name = 'SUNY Potsdam',
    default_category = 'education',
    content_types = '{events}',
    site_config = '{"timezone": "America/New_York"}'::JSONB
WHERE name = 'SUNY Potsdam Events';

UPDATE collector_targets
SET town = 'Canton',
    venue_name = 'St. Lawrence University',
    default_category = 'education',
    content_types = '{events}',
    site_config = '{"timezone": "America/New_York"}'::JSONB
WHERE name = 'St. Lawrence University Events';

-- ============================================================================
-- 4. Seed new hyperlocal targets (disabled by default)
-- ============================================================================

INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, dom_selectors,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Village of Potsdam Events',
  'https://www.vi.potsdam.ny.us',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  '{}'::JSONB,
  'Potsdam', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, dom_selectors,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Canton Community Events',
  'https://www.cantonchamber.org',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid'::parsing_strategy,
  '{}'::JSONB,
  'Canton', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- Seed Community Calendar Targets (Phase 1)
-- ============================================================================
-- Enables the manually-seeded targets from migrations 045/062/100 that have
-- been verified as live, and seeds 8 new North Country community calendar
-- targets.
--
-- All new targets start DISABLED (is_enabled = false). Enable them one-by-one
-- after a quick spot-check that the URL is live and has event content.
--
-- Rollback:
--   UPDATE collector_targets SET is_enabled = false
--   WHERE name IN (
--     'SLC Arts', 'North Country Public Radio Events', 'SUNY Canton Events',
--     'Canton Free Library', 'Potsdam Public Library', 'Massena Public Library',
--     'North Country This Week', 'Gouverneur Events', 'Adirondack North Country',
--     'Village of Canton Events', 'St. Lawrence County Historical Association'
--   );
-- ============================================================================

-- ============================================================================
-- 1. Enable previously-seeded targets that are confirmed live
-- ============================================================================

-- SLC Arts (slcarts.org) — verified events page
UPDATE collector_targets
SET is_enabled = true,
    source_trust_tier = 'gold'
WHERE name = 'SLC Arts';

-- North Country Public Radio Events — verified events listing
UPDATE collector_targets
SET is_enabled = true,
    source_trust_tier = 'gold'
WHERE name = 'North Country Public Radio Events';

-- SUNY Canton Events — verified campus calendar
UPDATE collector_targets
SET is_enabled = true,
    source_trust_tier = 'gold'
WHERE name = 'SUNY Canton Events';

-- Frederic Remington Art Museum — verified events calendar
UPDATE collector_targets
SET is_enabled = true,
    source_trust_tier = 'silver'
WHERE name = 'Frederic Remington Art Museum';

-- ============================================================================
-- 2. Seed new community calendar targets
-- ============================================================================

-- Canton Free Library
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  source_trust_tier, is_enabled, source_id
)
SELECT
  'Canton Free Library',
  'https://www.cantonfreelibrary.org',
  ARRAY['/events', '/calendar', '/programs'],
  ARRAY['/events/', '/calendar/', '/programs/'],
  'hybrid'::parsing_strategy,
  'org',
  'Canton', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  'gold', false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Potsdam Public Library
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  source_trust_tier, is_enabled, source_id
)
SELECT
  'Potsdam Public Library',
  'https://www.potsdampubliclibrary.org',
  ARRAY['/events', '/calendar', '/programs'],
  ARRAY['/events/', '/calendar/', '/programs/'],
  'hybrid'::parsing_strategy,
  'org',
  'Potsdam', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  'gold', false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Massena Public Library
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  source_trust_tier, is_enabled, source_id
)
SELECT
  'Massena Public Library',
  'https://www.massenapubliclibrary.org',
  ARRAY['/events', '/calendar', '/programs'],
  ARRAY['/events/', '/calendar/', '/programs/'],
  'hybrid'::parsing_strategy,
  'org',
  'Massena', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  'gold', false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- North Country This Week (local newspaper event listings)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  source_trust_tier, is_enabled, source_id
)
SELECT
  'North Country This Week',
  'https://www.northcountrythisweek.com',
  ARRAY['/events', '/calendar', '/community-events'],
  ARRAY['/events/', '/calendar/', '/community-events/'],
  'hybrid'::parsing_strategy,
  'org',
  'Potsdam', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  'gold', false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Gouverneur Chamber of Commerce (easternmost SLC coverage)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  source_trust_tier, is_enabled, source_id
)
SELECT
  'Gouverneur Chamber Events',
  'https://www.gouverneurchamber.net',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  'Gouverneur', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  'gold', false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Village of Canton Events
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  source_trust_tier, is_enabled, source_id
)
SELECT
  'Village of Canton Events',
  'https://www.villageofcanton.com',
  ARRAY['/events', '/calendar', '/recreation'],
  ARRAY['/events/', '/calendar/', '/recreation/'],
  'hybrid'::parsing_strategy,
  'town',
  'Canton', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  'gold', false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- St. Lawrence County Historical Association
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  source_trust_tier, is_enabled, source_id
)
SELECT
  'St. Lawrence County Historical Association',
  'https://www.slcha.org',
  ARRAY['/events', '/programs', '/calendar'],
  ARRAY['/events/', '/programs/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  'Canton', 'arts', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  'gold', false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Adirondack North Country Association
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  source_trust_tier, is_enabled, source_id
)
SELECT
  'Adirondack North Country Association',
  'https://www.adirondack.org',
  ARRAY['/events', '/calendar', '/whats-happening'],
  ARRAY['/events/', '/calendar/', '/whats-happening/'],
  'hybrid'::parsing_strategy,
  'org',
  'Potsdam', 'outdoors', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  'gold', false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 3. Schedule evaluate-venue-websites cron (Sundays 02:00 UTC)
-- ============================================================================
DO $$
BEGIN
  PERFORM cron.schedule(
    'evaluate-venue-websites',
    '0 2 * * 0',
    $CRON$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_FUNCTION_URL') || '/evaluate-venue-websites',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
        ),
        body := '{"batch_size": 20}'::jsonb
      );
    $CRON$
  );
  RAISE NOTICE 'pg_cron job scheduled: evaluate-venue-websites (Sundays 02:00 UTC)';
EXCEPTION
  WHEN undefined_function OR invalid_schema_name OR undefined_table THEN
    RAISE NOTICE 'pg_cron/vault not available — schedule evaluate-venue-websites manually via edge function cron';
END;
$$;

-- ============================================================================
-- 4. Summary
-- ============================================================================
DO $$
DECLARE
  v_enabled  INTEGER;
  v_disabled INTEGER;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE is_enabled = true),
    COUNT(*) FILTER (WHERE is_enabled = false)
  INTO v_enabled, v_disabled
  FROM collector_targets;
  RAISE NOTICE '121 community calendars: % enabled targets, % disabled (pending verification)', v_enabled, v_disabled;
END;
$$;

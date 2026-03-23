-- ============================================================================
-- Enable Verified Collector Targets
-- ============================================================================
-- After running verifyCollectorTargets.ts, these targets have confirmed
-- structured event data and are ready for production crawling.
--
-- Rollback: UPDATE collector_targets SET is_enabled = false WHERE name IN (...)
-- ============================================================================

-- ============================================================================
-- 1. Fix Village of Potsdam — domain moved from vi.potsdam.ny.us
-- ============================================================================

UPDATE collector_targets
SET base_url = 'https://villageofpotsdamny.gov',
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'json_api', 'https://villageofpotsdamny.gov/wp-json/tribe/events/v1/events',
      'platform', 'wordpress_tribe_events'
    )
WHERE name = 'Village of Potsdam Events';

-- ============================================================================
-- 2. Enable targets with verified structured data
-- ============================================================================

-- SLC Arts: 36 JSON-LD events + ICS feed (slcartscouncil.org)
-- Village of Potsdam: JSON-LD + iCal + JSON API (villageofpotsdamny.gov)
-- Massena Events: RSS feed with event data (massena.us)
-- Ogdensburg Events: RSS feed with event data (ogdensburgny.gov)

UPDATE collector_targets
SET is_enabled = true
WHERE name IN (
  'SLC Arts',
  'Village of Potsdam Events',
  'Massena Events',
  'Ogdensburg Events'
);

-- ============================================================================
-- 3. Fix Potsdam Chamber allowed_paths
--    '/events' doesn't startsWith '/events/' — need both forms
-- ============================================================================

UPDATE collector_targets
SET allowed_paths = ARRAY['/events', '/events/']
WHERE name = 'Potsdam Chamber of Commerce';

-- ============================================================================
-- 4. Reset Ogdensburg robots cache (stale from old ogdensburg.org domain)
-- ============================================================================

UPDATE collector_targets
SET robots_txt_cache = NULL,
    robots_txt_fetched_at = NULL,
    robots_txt_allows_crawl = NULL
WHERE name = 'Ogdensburg Events';

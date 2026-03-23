-- ============================================================================
-- Fix Collector Target URLs Based on Verification Results
-- ============================================================================
-- Corrects discovery URLs, base URLs, and configurations for all collector
-- targets based on actual site verification. Disables 3 campus targets that
-- were prematurely enabled in migration 100 (their pages lack structured data).
--
-- Rollback: Re-run migration 100 to restore previous values
-- ============================================================================

-- ============================================================================
-- 1. Disable campus targets that lack structured event data
--    (re-enable individually after DOM extraction is confirmed working)
-- ============================================================================

UPDATE collector_targets
SET is_enabled = false
WHERE name IN (
  'Clarkson University Events',
  'SUNY Potsdam Events',
  'St. Lawrence University Events'
);

-- ============================================================================
-- 2. Enable Potsdam Chamber of Commerce (verified: JSON-LD with 6 events)
-- ============================================================================

UPDATE collector_targets
SET is_enabled = true
WHERE name = 'Potsdam Chamber of Commerce';

-- ============================================================================
-- 3. Fix Clarkson University Events — events live on subdomain
-- ============================================================================

UPDATE collector_targets
SET base_url = 'https://calendar.clarkson.edu',
    discovery_urls = ARRAY['/MasterCalendar/MasterCalendar.aspx'],
    allowed_paths = ARRAY['/MasterCalendar/'],
    parsing_strategy = 'html_dom',
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'ignore_patterns', ARRAY['office hours', 'faculty meeting', 'staff meeting'],
      'note', 'Events embedded as JSON in inline JS var eventGridData. Requires Accept-Language header (collector sends this by default).'
    )
WHERE name = 'Clarkson University Events';

-- ============================================================================
-- 4. Fix SLC Arts — domain is slcartscouncil.org, has JSON API + iCal + JSON-LD
-- ============================================================================

UPDATE collector_targets
SET base_url = 'https://slcartscouncil.org',
    discovery_urls = ARRAY['/events/', '/events/?ical=1'],
    allowed_paths = ARRAY['/events/', '/event/'],
    parsing_strategy = 'hybrid',
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'json_api', 'https://slcartscouncil.org/wp-json/tribe/events/v1/events',
      'platform', 'wordpress_tribe_events'
    )
WHERE name = 'SLC Arts';

-- ============================================================================
-- 5. Fix Village of Potsdam — has Tribe Events JSON API + JSON-LD
-- ============================================================================

UPDATE collector_targets
SET discovery_urls = ARRAY['/events/list/', '/events/?ical=1'],
    allowed_paths = ARRAY['/events/', '/event/'],
    parsing_strategy = 'hybrid',
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'json_api', 'https://vi.potsdam.ny.us/wp-json/tribe/events/v1/events',
      'platform', 'wordpress_tribe_events'
    )
WHERE name = 'Village of Potsdam Events';

-- ============================================================================
-- 6. Fix Massena — correct path + RSS feed
-- ============================================================================

UPDATE collector_targets
SET discovery_urls = ARRAY[
      '/Calendar.aspx',
      '/RSSFeed.aspx?ModID=58&CID=All-calendar.xml'
    ],
    allowed_paths = ARRAY['/Calendar.aspx', '/RSSFeed.aspx'],
    parsing_strategy = 'hybrid',
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'platform', 'civicplus',
      'rss_feed', 'https://massena.us/RSSFeed.aspx?ModID=58&CID=All-calendar.xml',
      'ical_feed', 'https://massena.us/iCalendar.aspx'
    )
WHERE name = 'Massena Events';

-- ============================================================================
-- 7. Fix Ogdensburg — domain changed to ogdensburgny.gov + RSS feed
-- ============================================================================

UPDATE collector_targets
SET base_url = 'https://www.ogdensburgny.gov',
    discovery_urls = ARRAY[
      '/Calendar.aspx',
      '/RSSFeed.aspx?ModID=58&CID=All-calendar.xml'
    ],
    allowed_paths = ARRAY['/Calendar.aspx', '/RSSFeed.aspx'],
    parsing_strategy = 'hybrid',
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'platform', 'civicplus',
      'rss_feed', 'https://www.ogdensburgny.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml',
      'ical_feed', 'https://www.ogdensburgny.gov/iCalendar.aspx'
    )
WHERE name = 'Ogdensburg Events';

-- ============================================================================
-- 8. Fix Canton Community Events — wrong domain (cantonchamber.org = Ohio)
--    Replace with SLC Chamber calendar (covers Canton, NY area)
-- ============================================================================

UPDATE collector_targets
SET name = 'St. Lawrence County Chamber Events',
    base_url = 'https://business.visitstlc.com',
    discovery_urls = ARRAY['/events/calendar'],
    allowed_paths = ARRAY['/events/'],
    source_type = 'org',
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'platform', 'growthzone'
    )
WHERE name = 'Canton Community Events';

-- ============================================================================
-- 9. Fix SUNY Potsdam — remove dead /about/calendar path
-- ============================================================================

UPDATE collector_targets
SET discovery_urls = ARRAY['/events'],
    allowed_paths = ARRAY['/events/']
WHERE name = 'SUNY Potsdam Events';

-- ============================================================================
-- 10. Fix St. Lawrence University — remove dead /campus-life/events path
-- ============================================================================

UPDATE collector_targets
SET discovery_urls = ARRAY['/events'],
    allowed_paths = ARRAY['/events/']
WHERE name = 'St. Lawrence University Events';

-- ============================================================================
-- 11. Fix SUNY Canton — correct path to /calendar/events/
-- ============================================================================

UPDATE collector_targets
SET discovery_urls = ARRAY['/calendar/events/'],
    allowed_paths = ARRAY['/calendar/'],
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'note', 'Server consistently times out (>15s). Events may be dynamically loaded via JS. Low priority.'
    )
WHERE name = 'SUNY Canton Events';

-- ============================================================================
-- 12. Fix North Country Public Radio — correct path
-- ============================================================================

UPDATE collector_targets
SET discovery_urls = ARRAY['/upnorth/comcal/'],
    allowed_paths = ARRAY['/upnorth/comcal/'],
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'platform', 'custom_php',
      'note', 'Per-event iCal export available, no bulk feed'
    )
WHERE name = 'North Country Public Radio Events';

-- ============================================================================
-- 13. Fix Frederic Remington Art Museum — correct path
-- ============================================================================

UPDATE collector_targets
SET discovery_urls = ARRAY['/calendar-of-events.php'],
    allowed_paths = ARRAY['/calendar-of-events.php', '/Calendar/'],
    parsing_strategy = 'html_dom',
    site_config = jsonb_build_object(
      'timezone', 'America/New_York',
      'platform', 'custom_php',
      'note', 'No structured data - pure HTML calendar grid with JS popups'
    )
WHERE name = 'Frederic Remington Art Museum';

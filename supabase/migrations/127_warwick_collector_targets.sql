-- ============================================================================
-- Warwick, NY Web Collector Targets (127)
-- ============================================================================
-- 32 web collector targets covering Warwick and surrounding Hudson Valley /
-- Orange County / NJ-border venues, civic calendars, libraries, and orgs.
--
-- ALL TARGETS INSERTED WITH is_enabled = FALSE. Atomic flip after review:
--   UPDATE collector_targets
--      SET is_enabled = TRUE
--    WHERE town IN ('Warwick', 'Goshen', 'Middletown', 'Sugar Loaf',
--                   'New Windsor', 'Bethel', 'Vernon', 'Hamburg')
--      AND is_enabled = FALSE;
--
-- CIVIC MEETING FILTERING
--   Municipal targets (Town of Warwick, Village of Goshen, City of
--   Middletown) carry ignore_patterns that suppress planning/zoning/board
--   meeting titles BEFORE they reach LLM enrichment. Patterns are tested
--   not to over-trigger on legitimate event titles ("Art Workshop",
--   "Music Class", "Cooking Workshop" — all safe).
--
-- URL VERIFICATION
--   Several entries are best-guess URLs that should be confirmed live
--   before flipping is_enabled. Marked with "VERIFY:" in the comment.
--
-- Rollback:
--   DELETE FROM collector_targets WHERE town IN (
--     'Warwick', 'Goshen', 'Middletown', 'Sugar Loaf',
--     'New Windsor', 'Bethel', 'Vernon', 'Hamburg'
--   ) AND created_at >= NOW() - INTERVAL '1 day';
-- ============================================================================

-- ── Common civic-meeting ignore patterns ─────────────────────────────────
-- Case-insensitive substring regexes applied to candidate event titles.
-- Tuned to catch deliberative-body vocabulary without false-positives on
-- legitimate community programming.
--
--   "planning board", "zoning board",
--   "town board", "village board",
--   "city council", "town council",
--   "(board|council|committee) meeting",
--   "public hearing", "executive session",
--   "caucus", "ethics board"

-- ============================================================================
-- SECTION 1 — MUNICIPAL / CIVIC (with civic-meeting filters)
-- ============================================================================

-- Town of Warwick (municipal)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Town of Warwick',
  'https://www.townofwarwick.org',
  ARRAY['/calendar', '/events'],
  ARRAY['/calendar/', '/events/'],
  'hybrid'::parsing_strategy,
  'town',
  'Warwick', 'community', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'ignore_patterns', ARRAY[
      'planning board', 'zoning board', 'town board', 'village board',
      'city council', 'town council',
      '(board|council|committee) meeting',
      'public hearing', 'executive session', 'caucus', 'ethics board'
    ]
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Village of Goshen
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Village of Goshen',
  'https://www.villageofgoshen.org',
  ARRAY['/calendar', '/events'],
  ARRAY['/calendar/', '/events/'],
  'hybrid'::parsing_strategy,
  'town',
  'Goshen', 'community', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'ignore_patterns', ARRAY[
      'planning board', 'zoning board', 'town board', 'village board',
      'city council', 'town council',
      '(board|council|committee) meeting',
      'public hearing', 'executive session', 'caucus', 'ethics board'
    ]
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- City of Middletown NY  (VERIFY domain: also seen as middletownnewyork.com)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'City of Middletown NY',
  'https://www.middletown-ny.gov',
  ARRAY['/calendar', '/events'],
  ARRAY['/calendar/', '/events/'],
  'hybrid'::parsing_strategy,
  'town',
  'Middletown', 'community', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'ignore_patterns', ARRAY[
      'planning board', 'zoning board', 'town board', 'village board',
      'city council', 'town council',
      '(board|council|committee) meeting',
      'public hearing', 'executive session', 'caucus', 'ethics board'
    ]
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SECTION 2 — CHAMBERS, ORGS, TOURISM, NEWSPAPERS
-- ============================================================================

-- Warwick Valley Chamber of Commerce  (VERIFY: warwickcc.org vs warwickvalleychamber.org)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Warwick Valley Chamber of Commerce',
  'https://www.warwickcc.org',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  'Warwick', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Orange County Tourism (county aggregator)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Orange County Tourism',
  'https://www.orangecountytourism.org',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  'Goshen', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Warwick Advertiser (Straus News)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Warwick Advertiser',
  'https://www.warwickadvertiser.com',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid'::parsing_strategy,
  'org',
  'Warwick', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Warwick Historical Society
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Warwick Historical Society',
  'https://www.warwickhistoricalsociety.org',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  'Warwick', 'arts', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Sugar Loaf Guild (artist village events)  (VERIFY: sugarloafnewyork.com domain)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Sugar Loaf Guild',
  'https://www.sugarloafnewyork.com',
  ARRAY['/events', '/festivals'],
  ARRAY['/events/', '/festivals/'],
  'hybrid'::parsing_strategy,
  'org',
  'Sugar Loaf', 'arts', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Black Bear Film Festival (annual Warwick festival)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Black Bear Film Festival',
  'https://www.blackbearfilm.com',
  ARRAY['/schedule', '/events'],
  ARRAY['/schedule/', '/events/'],
  'hybrid'::parsing_strategy,
  'org',
  'Warwick', 'arts', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'Annual festival — most content concentrated late summer/early fall. Off-season may show prior-year schedule.'
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SECTION 3 — CAMPUS / LIBRARIES
-- ============================================================================

-- SUNY Orange Events
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'SUNY Orange Events',
  'https://www.sunyorange.edu',
  ARRAY['/events', '/student-services/calendar'],
  ARRAY['/events/', '/student-services/'],
  'hybrid'::parsing_strategy,
  'campus',
  'Middletown', 'education', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'ignore_patterns', ARRAY['office hours', 'faculty meeting', 'staff meeting', 'advising']
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Albert Wisner Public Library (Warwick)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Albert Wisner Public Library',
  'https://www.albertwisnerlibrary.org',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  'Warwick', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Goshen Public Library
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Goshen Public Library',
  'https://www.goshenpubliclibrary.org',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  'Goshen', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Thrall Library (Middletown)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Thrall Library',
  'https://www.thrall.org',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  'Middletown', 'community', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Warwick Town Recreation (adjusted: org, not town — it's a programs dept)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Warwick Town Recreation',
  'https://www.townofwarwick.org',
  ARRAY['/recreation/programs', '/recreation/calendar'],
  ARRAY['/recreation/'],
  'html_dom'::parsing_strategy,
  'org',
  'Warwick', 'sports', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SECTION 4 — PERFORMING ARTS / THEATER / FILM
-- ============================================================================

-- Sugar Loaf Performing Arts Center  (VERIFY OPERATIONAL before flipping on)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Sugar Loaf Performing Arts Center',
  'https://www.sugarloafpac.org',
  ARRAY['/events', '/shows', '/calendar'],
  ARRAY['/events/', '/shows/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Sugar Loaf', 'arts', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'VERIFY OPERATIONAL: confirm site is still live and active before enabling'
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Storm King Art Center (major regional institution)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Storm King Art Center',
  'https://stormking.org',
  ARRAY['/events', '/visit/calendar', '/programs'],
  ARRAY['/events/', '/visit/', '/programs/'],
  'hybrid'::parsing_strategy,
  'venue',
  'New Windsor', 'arts', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Bethel Woods Center for the Arts (free/community events the TM API misses)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Bethel Woods Center for the Arts',
  'https://www.bethelwoodscenter.org',
  ARRAY['/events', '/calendar', '/museum'],
  ARRAY['/events/', '/calendar/', '/museum/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Bethel', 'arts', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'Most ticketed events on Ticketmaster; this catches free/community/museum programs.'
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Cornerstone Theatre Arts (Goshen)  (VERIFY: exact name + URL)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Cornerstone Theatre Arts',
  'https://www.cornerstonetheatrearts.org',
  ARRAY['/events', '/shows', '/season'],
  ARRAY['/events/', '/shows/', '/season/'],
  'hybrid'::parsing_strategy,
  'org',
  'Goshen', 'arts', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SECTION 5 — WINERIES, BREWERIES, FOOD-DRINK VENUES
-- ============================================================================

-- Warwick Valley Winery
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Warwick Valley Winery',
  'https://www.wvwinery.com',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Warwick', 'nightlife', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Long Lot Brewery
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Long Lot Brewery',
  'https://www.longlotfarmbrewery.com',
  ARRAY['/events', '/live-music'],
  ARRAY['/events/', '/live-music/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Warwick', 'nightlife', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Drowned Lands Brewery
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Drowned Lands Brewery',
  'https://www.drownedlandsbrewery.com',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Warwick', 'nightlife', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Tuscan Cafe Warwick  (VERIFY exact URL)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Tuscan Cafe Warwick',
  'https://www.tuscancafewarwick.com',
  ARRAY['/events', '/live-music'],
  ARRAY['/events/', '/live-music/'],
  'html_dom'::parsing_strategy,
  'venue',
  'Warwick', 'food_drink', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Warwick Valley Farmers Market
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Warwick Valley Farmers Market',
  'https://www.warwickvalleyfarmersmarket.org',
  ARRAY['/events', '/schedule'],
  ARRAY['/events/', '/schedule/'],
  'html_dom'::parsing_strategy,
  'venue',
  'Warwick', 'food_drink', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SECTION 6 — ORCHARDS & FARM EVENTS (heavily fall-seasonal)
-- ============================================================================
-- These are small custom sites unlikely to have JSON-LD; html_dom strategy.
-- Bulk of programming concentrated Aug-Nov (U-pick) and Nov-Dec (holiday).

-- Pennings Farm Market
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Pennings Farm Market',
  'https://www.penningsfarmmarket.com',
  ARRAY['/events'],
  ARRAY['/events/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Warwick', 'family', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Pennings Farm Cidery (live music + cidery events)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Pennings Farm Cidery',
  'https://www.penningsfarmcidery.com',
  ARRAY['/events', '/live-music'],
  ARRAY['/events/', '/live-music/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Warwick', 'nightlife', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Apple Ridge Orchards  (VERIFY URL)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Apple Ridge Orchards',
  'https://www.appleridgeorchards.com',
  ARRAY['/events'],
  ARRAY['/events/'],
  'html_dom'::parsing_strategy,
  'venue',
  'Warwick', 'family', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'Heavily seasonal (Aug-Dec). Off-season may show prior-year content.'
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Ochs Orchard  (VERIFY URL)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Ochs Orchard',
  'https://www.ochsorchard.com',
  ARRAY['/events'],
  ARRAY['/events/'],
  'html_dom'::parsing_strategy,
  'venue',
  'Warwick', 'family', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'Heavily seasonal (Aug-Dec).'
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Soons Orchards (New Hampton, near Middletown)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Soons Orchards',
  'https://www.soonsorchards.com',
  ARRAY['/events'],
  ARRAY['/events/'],
  'html_dom'::parsing_strategy,
  'venue',
  'Middletown', 'family', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'Heavily seasonal (Aug-Dec). Physically in New Hampton near Middletown.'
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- SECTION 7 — DESTINATIONS / RESORTS / MAJOR VENUES
-- ============================================================================

-- Mountain Creek Resort (Vernon, NJ) — ski/water park/festivals
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Mountain Creek Resort',
  'https://www.mountaincreek.com',
  ARRAY['/events', '/things-to-do', '/calendar'],
  ARRAY['/events/', '/things-to-do/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Vernon', 'outdoor', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Crystal Springs Resort (Hamburg, NJ) — golf, dining, public events
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Crystal Springs Resort',
  'https://www.crystalgolfresort.com',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Hamburg', 'outdoor', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'VERIFY domain: also seen as crystalsprings.com. Mixed wedding/conference content; rely on enrichment to filter B2B events.'
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Legoland New York
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Legoland New York',
  'https://www.legoland.com',
  ARRAY['/new-york/events', '/new-york/whats-on'],
  ARRAY['/new-york/'],
  'hybrid'::parsing_strategy,
  'venue',
  'Goshen', 'family', '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

-- Warwick Town Park (summer concerts)  (VERIFY URL — may be subpage of townofwarwick.org)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  is_enabled, source_id
)
SELECT
  'Warwick Town Park',
  'https://www.townofwarwick.org',
  ARRAY['/park', '/park/concerts', '/park/events'],
  ARRAY['/park/'],
  'html_dom'::parsing_strategy,
  'venue',
  'Warwick', 'outdoor', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'Summer concert series concentrated Jun-Aug. URL may need adjustment.'
  ),
  false,
  es.id
FROM event_sources es WHERE es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO NOTHING;

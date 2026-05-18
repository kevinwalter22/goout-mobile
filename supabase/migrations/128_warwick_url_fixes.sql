-- ============================================================================
-- Warwick URL Verification Fixes (128)
-- ============================================================================
-- Follow-up to 127. Phase 1 URL verification (May 2026) surfaced multiple
-- corrections that should land BEFORE the atomic-enable flip.
--
-- Summary of issues:
--   • townofwarwick.org now 301-redirects to townofwarwickny.gov
--     → rebases 3 targets (Town of Warwick, Warwick Town Recreation,
--       Warwick Town Park) onto the .gov domain
--     → Town of Warwick exposes an iCal feed → switch to 'ics' strategy
--   • middletown-ny.gov is unreachable; the correct domain is
--     middletownny.gov. CivicEngage path /Calendar.aspx?CID=22 is
--     "Community Events only" (meetings excluded at source).
--   • sugarloafpac.org is a thin tracking landing; live venue site is
--     sugarloafpacny.com (verified active with 2026 shows).
--   • warwickcc.org is operational, but the public events calendar lives
--     on the directory.warwickcc.org SUBDOMAIN — rebase base_url.
--   • cornerstonetheatrearts.org uses static .html season pages
--     (/2026-season.html, individual shows at /show-name.html) and has
--     no /events or /shows index. Yearly bump required.
--   • crystalsprings.com is a parked domain; crystalgolfresort.com is
--     correct. Calendar paths nested under /things-to-do/.
--   • Apple Ridge Orchards has no /events index — root navigation links
--     to seasonal event pages directly.
--   • Sugar Loaf "Guild" target is operated by the Sugar Loaf NY
--     Arts & Crafts Village Chamber of Commerce — operator note added,
--     internal name preserved.
--   • Tuscan Cafe Warwick: events promoted via Instagram only — no web
--     events surface to scrape. DELETED.
--   • Ochs Orchard: events promoted via Facebook only — no web events
--     surface to scrape. DELETED.
--   • Warwick Town Park: no standalone subpage exists — repointed at
--     /parks-recreation/ and main calendar with a venue_filter hint.
--     The main Town of Warwick target will pick up park-attributed
--     events; dedupe at storage time.
--
-- Order of operations:
--   1. Apply 126 (partitions, staged)
--   2. Apply 127 (collector targets, staged)
--   3. Apply 128 (this file — URL fixes, also staged)
--   4. Review SELECT output
--   5. Atomic flip (see headers in 126 / 127)
--
-- Rollback: re-create deleted rows from 127 source and revert UPDATEs;
-- not provided as a script since the changes are corrective.
-- ============================================================================

-- ============================================================================
-- SECTION 1 — Town of Warwick domain rebase (.org → .gov, affects 3 targets)
-- ============================================================================

-- Town of Warwick: rebase + switch to iCal strategy
UPDATE collector_targets
   SET base_url = 'https://townofwarwickny.gov',
       discovery_urls = ARRAY['/town-of-warwick-calendar/'],
       allowed_paths = ARRAY['/town-of-warwick-calendar/', '/events/', '/venue/'],
       parsing_strategy = 'ics'::parsing_strategy,
       site_config = site_config || jsonb_build_object(
         'note', 'Uses iCal feed surfaced via /town-of-warwick-calendar/. '
                 || 'Switched from hybrid → ics for structured, reliable data.'
       )
 WHERE name = 'Town of Warwick';

-- Warwick Town Recreation: rebase + correct path
UPDATE collector_targets
   SET base_url = 'https://townofwarwickny.gov',
       discovery_urls = ARRAY['/parks-recreation/'],
       allowed_paths = ARRAY['/parks-recreation/']
 WHERE name = 'Warwick Town Recreation';

-- Warwick Town Park: no standalone page exists. Repoint to recreation +
-- main calendar with a venue_filter hint. The primary Town of Warwick
-- target will surface park events too; dedupe handles overlap.
UPDATE collector_targets
   SET base_url = 'https://townofwarwickny.gov',
       discovery_urls = ARRAY['/parks-recreation/', '/town-of-warwick-calendar/'],
       allowed_paths = ARRAY['/parks-recreation/', '/town-of-warwick-calendar/'],
       site_config = site_config || jsonb_build_object(
         'venue_filter', 'Park',
         'note', 'No standalone park subpage exists. Main municipal calendar '
                 || 'surfaces park events with venue=Park. Primary Town of Warwick '
                 || 'target also pulls these; rely on dedupe at storage time.'
       )
 WHERE name = 'Warwick Town Park';

-- ============================================================================
-- SECTION 2 — City of Middletown NY: wrong domain → middletownny.gov
-- ============================================================================
-- CID=22 = "Community Events" (CivicEngage category). This excludes
-- municipal/board meetings at the source, making this our cleanest civic
-- filter on the entire migration. ignore_patterns retained as defense in
-- depth in case category-22 leakage occurs.

UPDATE collector_targets
   SET base_url = 'https://www.middletownny.gov',
       discovery_urls = ARRAY['/Calendar.aspx?CID=22'],
       allowed_paths = ARRAY['/Calendar.aspx', '/158/Events'],
       site_config = site_config || jsonb_build_object(
         'note', 'CID=22 (CivicEngage) = Community Events only — meetings '
                 || 'excluded at source. ignore_patterns retained as defense '
                 || 'in depth.'
       )
 WHERE name = 'City of Middletown NY';

-- ============================================================================
-- SECTION 3 — Sugar Loaf PAC: wrong domain → sugarloafpacny.com
-- ============================================================================

UPDATE collector_targets
   SET base_url = 'https://www.sugarloafpacny.com',
       discovery_urls = ARRAY['/shows', '/events'],
       allowed_paths = ARRAY['/shows/', '/events/'],
       site_config = site_config || jsonb_build_object(
         'note', 'Live operational venue (verified May 2026 with active 2026 '
                 || 'show calendar). Address is Chester, NY; town label '
                 || 'preserved as Sugar Loaf (hamlet within Town of Chester).'
       )
 WHERE name = 'Sugar Loaf Performing Arts Center';

-- ============================================================================
-- SECTION 4 — Warwick Chamber: events on directory.warwickcc.org subdomain
-- ============================================================================

UPDATE collector_targets
   SET base_url = 'https://directory.warwickcc.org',
       discovery_urls = ARRAY['/events/calendar'],
       allowed_paths = ARRAY['/events/'],
       site_config = site_config || jsonb_build_object(
         'note', 'Public events calendar lives on directory.warwickcc.org '
                 || 'subdomain. Member login optional; calendar accessible '
                 || 'without auth. warwickvalleychamber.org does not exist.'
       )
 WHERE name = 'Warwick Valley Chamber of Commerce';

-- ============================================================================
-- SECTION 5 — Cornerstone Theatre Arts: static .html season pages
-- ============================================================================
-- URL convention: lowercase-hyphenated show titles at site root.
-- Example: "On Golden Pond" → /on-golden-pond.html
-- No /events or /shows index exists. Yearly maintenance: bump 2026→2027
-- in January.

UPDATE collector_targets
   SET discovery_urls = ARRAY['/2026-season.html', '/past-seasons.html'],
       allowed_paths = ARRAY['/'],
       parsing_strategy = 'html_dom'::parsing_strategy,
       site_config = site_config || jsonb_build_object(
         'note', 'Static .html season pages. Show pages at site root '
                 || '(e.g. /on-golden-pond.html). YEARLY BUMP REQUIRED: '
                 || 'update 2026 → 2027 in discovery_urls each January.'
       )
 WHERE name = 'Cornerstone Theatre Arts';

-- ============================================================================
-- SECTION 6 — Crystal Springs Resort: nested /things-to-do/ paths
-- ============================================================================
-- Discovery URLs selected to surface public events + dining; skipped
-- /golf-calendar and /sports-club-calendar to avoid B2B tournament/league
-- clutter that would be downweighted by enrichment anyway.

UPDATE collector_targets
   SET discovery_urls = ARRAY[
         '/things-to-do/culinary-calendar',
         '/things-to-do/social-member-calendar',
         '/things-to-do/events-holidays'
       ],
       allowed_paths = ARRAY['/things-to-do/'],
       site_config = site_config || jsonb_build_object(
         'note', 'crystalgolfresort.com confirmed; crystalsprings.com is a '
                 || 'parked domain. Skipped /golf-calendar and '
                 || '/sports-club-calendar discovery paths to avoid B2B '
                 || 'tournament/league noise.'
       )
 WHERE name = 'Crystal Springs Resort';

-- ============================================================================
-- SECTION 7 — Apple Ridge Orchards: no /events index, crawl root
-- ============================================================================

UPDATE collector_targets
   SET discovery_urls = ARRAY['/'],
       allowed_paths = ARRAY['/'],
       site_config = site_config || jsonb_build_object(
         'note', 'No /events index. Root navigation links to seasonal event '
                 || 'pages directly (Pumpkin Picking, Christmas on the Farm, '
                 || 'Spookley Movie Night). html_dom crawls root and follows '
                 || 'event-named subpages. Heavily seasonal Aug-Dec.'
       )
 WHERE name = 'Apple Ridge Orchards';

-- ============================================================================
-- SECTION 8 — Sugar Loaf Guild: operator clarified, paths confirmed
-- ============================================================================
-- URL was correct; site footer identifies the operator as the
-- "Sugar Loaf NY Arts & Crafts Village Chamber of Commerce". Internal
-- name "Sugar Loaf Guild" preserved as a friendly handle.

UPDATE collector_targets
   SET discovery_urls = ARRAY['/events/', '/event-calendar/'],
       allowed_paths = ARRAY['/events/', '/event-calendar/'],
       site_config = site_config || jsonb_build_object(
         'operator', 'Sugar Loaf NY Arts & Crafts Village Chamber of Commerce',
         'note', 'Internal name "Sugar Loaf Guild" preserved as friendly '
                 || 'handle. Footer of site identifies operator as the Chamber.'
       )
 WHERE name = 'Sugar Loaf Guild';

-- ============================================================================
-- SECTION 9 — REMOVALS: no usable web events surface
-- ============================================================================
-- Both venues are live, operating businesses but promote events
-- exclusively via social channels (Instagram / Facebook). The web
-- collector pipeline cannot scrape these surfaces without authenticated,
-- rate-limited social APIs that aren't worth the engineering cost for
-- two low-volume venues. Removing rather than leaving dead targets that
-- would return empty fetches and clutter monitoring.
--
-- Reinstatement path: if either venue later publishes a website /events
-- page, re-add via a future migration.

DELETE FROM collector_targets WHERE name = 'Tuscan Cafe Warwick';
DELETE FROM collector_targets WHERE name = 'Ochs Orchard';

-- ============================================================================
-- VERIFICATION HELPER
-- ============================================================================
-- After applying, run this to confirm:
--
-- SELECT name, base_url, parsing_strategy, is_enabled,
--        site_config->>'note' AS note
--   FROM collector_targets
--  WHERE town IN ('Warwick', 'Goshen', 'Middletown', 'Sugar Loaf',
--                 'New Windsor', 'Bethel', 'Vernon', 'Hamburg')
--  ORDER BY town, name;
--
-- Expected: 30 rows (32 from 127 minus 2 deletions), all is_enabled=false,
-- all base_url values are non-redirecting live domains.
-- ============================================================================

-- ============================================================================
-- Portland, ME Aggregator Collector Targets (143) — Phase P-C
-- ============================================================================
-- Two high-yield multi-venue event aggregators for the Greater Portland catalog,
-- inserted is_enabled = TRUE. They follow the proven web_collector pattern
-- (hybrid parsing + LLM fallback), identical in shape to the Warwick targets in
-- migration 127.
--
-- WHY THESE TWO (dry-run yields, single listing-page crawl, prod, 2026-06-27):
--   Visit Portland (Greater Portland CVB)  → 14 valid events / crawl, $0.03, 100% valid
--   Maine Public Community Calendar        →  9 valid events / crawl, $0.04, 100% valid
--   Both clean: 0 pages blocked, 0 civic-filtered, 0 invalid.
--
-- NOT INCLUDED (also dry-ran):
--   Portland Downtown        → 0 events (informational hub, not a calendar) — DROPPED.
--   Press Herald "Do This"   → 1 event (JS-rendered/embedded calendar; static HTML
--                              is empty) — HELD for a separate embed-URL investigation.
--
-- NOTES
--   - Maine Public is STATEWIDE (434+ calendar pages). A share of each crawl will
--     be non-Portland events; the map viewport + the geo+time post invariant
--     (migration 137) gate anything outside the catalog rectangle / lacking
--     geo+time. town is left NULL so events geocode per-event rather than all
--     defaulting to Portland.
--   - source_id = the shared "Web Collector" event_source (all existing targets
--     use it); resolved by name to stay environment-portable.
--   - max_pages_per_run = 10 keeps per-crawl LLM spend bounded; crawl cadence is
--     the table default (every 6h).
--   - Idempotent: ON CONFLICT (name) DO UPDATE refreshes config and ensures
--     is_enabled = TRUE, so re-applying (or applying after the disabled P-C
--     experiment rows were cleaned) is safe.
--
-- Rollback:
--   UPDATE collector_targets SET is_enabled = FALSE
--    WHERE name IN ('Visit Portland (Greater Portland CVB)',
--                   'Maine Public Community Calendar');
--   -- or DELETE the same two rows to remove entirely.
-- ============================================================================

INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  use_llm_fallback, max_pages_per_run, is_enabled, source_id
)
SELECT
  'Visit Portland (Greater Portland CVB)',
  'https://www.visitportland.com',
  ARRAY['/visit/things-to-do/event-calendar/'],
  ARRAY['/event/', '/visit/things-to-do/'],
  'hybrid'::parsing_strategy,
  'org',
  'Portland', 'community', '{events}',
  jsonb_build_object('timezone', 'America/New_York'),
  true, 10, true,
  es.id
FROM event_sources es WHERE es.name = 'Web Collector' AND es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO UPDATE SET
  base_url          = EXCLUDED.base_url,
  discovery_urls    = EXCLUDED.discovery_urls,
  allowed_paths     = EXCLUDED.allowed_paths,
  parsing_strategy  = EXCLUDED.parsing_strategy,
  source_type       = EXCLUDED.source_type,
  town              = EXCLUDED.town,
  default_category  = EXCLUDED.default_category,
  content_types     = EXCLUDED.content_types,
  site_config       = EXCLUDED.site_config,
  use_llm_fallback  = EXCLUDED.use_llm_fallback,
  max_pages_per_run = EXCLUDED.max_pages_per_run,
  is_enabled        = TRUE,
  source_id         = EXCLUDED.source_id;

INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_type,
  town, default_category, content_types, site_config,
  use_llm_fallback, max_pages_per_run, is_enabled, source_id
)
SELECT
  'Maine Public Community Calendar',
  'https://www.mainepublic.org',
  ARRAY['/community-calendar'],
  ARRAY['/community-calendar/'],
  'hybrid'::parsing_strategy,
  'org',
  NULL, 'community', '{events}',
  jsonb_build_object(
    'timezone', 'America/New_York',
    'note', 'Statewide (434+ pages); per-event geocoding; geo+time invariant gates undated/unlocated. Non-Portland events filtered by map viewport.'
  ),
  true, 10, true,
  es.id
FROM event_sources es WHERE es.name = 'Web Collector' AND es.type = 'web_collector'
LIMIT 1
ON CONFLICT (name) DO UPDATE SET
  base_url          = EXCLUDED.base_url,
  discovery_urls    = EXCLUDED.discovery_urls,
  allowed_paths     = EXCLUDED.allowed_paths,
  parsing_strategy  = EXCLUDED.parsing_strategy,
  source_type       = EXCLUDED.source_type,
  town              = EXCLUDED.town,
  default_category  = EXCLUDED.default_category,
  content_types     = EXCLUDED.content_types,
  site_config       = EXCLUDED.site_config,
  use_llm_fallback  = EXCLUDED.use_llm_fallback,
  max_pages_per_run = EXCLUDED.max_pages_per_run,
  is_enabled        = TRUE,
  source_id         = EXCLUDED.source_id;

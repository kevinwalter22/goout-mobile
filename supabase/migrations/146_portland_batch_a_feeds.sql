-- ============================================================================
-- 146_portland_batch_a_feeds.sql — Batch A structured-feed collector targets
-- ============================================================================
-- Four clean iCal (The Events Calendar / Tribe) feeds for the Greater Portland
-- catalog, is_enabled = TRUE. Same web_collector pattern as migration 143.
--
-- Dry-run yields (prod, EudaBot UA, parsing_strategy='ics', 1 page each, $0 LLM,
-- 0 robots blocks, 2026-07-07):
--   Thompson's Point (Portland)  → 30 valid events / crawl
--   Portland Stage Company       → 29 valid events / crawl
--   Portland Museum of Art       → 27 valid events / crawl
--   Bissell Brothers Brewing     → 20 valid events / crawl
--   (106 valid events total; all deterministic ICS, no LLM cost.)
--
-- NOT INCLUDED:
--   Portland Old Port  → not robots-blocked, but JS-rendered (0 valid even with
--                        LLM) — HELD for an embed-URL dig (with Press Herald).
--   Portland Public Library → librarycalendar.com is Communico; iCal not publicly
--                        exposed — HELD until the exact feed URL is pinned.
--
-- source_id = the shared "Web Collector" event_source, resolved by name (env-portable).
-- parsing_strategy='ics' forces the deterministic VEVENT parser on the ?ical=1 feed.
-- Idempotent: ON CONFLICT (name) DO UPDATE flips the disabled dry-run rows enabled.
--
-- Rollback:
--   UPDATE collector_targets SET is_enabled = FALSE
--    WHERE name IN ('Thompson''s Point (Portland)','Portland Stage Company',
--                   'Portland Museum of Art','Bissell Brothers Brewing');
-- ============================================================================

WITH src AS (
  SELECT id FROM event_sources WHERE name='Web Collector' AND type='web_collector' LIMIT 1
),
v(name, base_url, disc, allow, town, cat) AS (
  VALUES
   ('Thompson''s Point (Portland)','https://thompsonspoint.com', ARRAY['/things-to-do/events-calendar/?ical=1'], ARRAY['/things-to-do/'], 'Portland','music'),
   ('Portland Stage Company','https://www.portlandstage.org', ARRAY['/events/?ical=1'], ARRAY['/events/'], 'Portland','arts'),
   ('Portland Museum of Art','https://www.portlandmuseum.org', ARRAY['/events/?ical=1'], ARRAY['/events/'], 'Portland','arts'),
   ('Bissell Brothers Brewing','https://bissellbrothers.com', ARRAY['/events/?ical=1'], ARRAY['/events/'], 'Portland','food-drink')
)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths, parsing_strategy, source_type,
  town, default_category, content_types, site_config, use_llm_fallback,
  max_pages_per_run, is_enabled, source_id
)
SELECT v.name, v.base_url, v.disc, v.allow, 'ics'::parsing_strategy, 'org',
       v.town, v.cat, '{events}', jsonb_build_object('timezone','America/New_York'),
       false, 3, true, src.id
FROM v CROSS JOIN src
ON CONFLICT (name) DO UPDATE SET
  base_url=EXCLUDED.base_url, discovery_urls=EXCLUDED.discovery_urls,
  allowed_paths=EXCLUDED.allowed_paths, parsing_strategy=EXCLUDED.parsing_strategy,
  source_type=EXCLUDED.source_type, town=EXCLUDED.town,
  default_category=EXCLUDED.default_category, content_types=EXCLUDED.content_types,
  site_config=EXCLUDED.site_config, use_llm_fallback=EXCLUDED.use_llm_fallback,
  max_pages_per_run=EXCLUDED.max_pages_per_run, is_enabled=TRUE,
  source_id=EXCLUDED.source_id;

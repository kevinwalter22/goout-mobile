-- ============================================================================
-- 148_one_longfellow_feed.sql — enable One Longfellow Square (Batch B winner)
-- ============================================================================
-- The one clean yield from the Batch B dry-runs (prod, EudaBot UA, 2026-07-08):
-- One Longfellow Square (listening-room music venue) → 41 valid events / crawl,
-- deterministic HTML/JSON-LD extraction. The other 5 Batch B sources are held:
-- SPACE/Ovations/Portland Downtown need URL tuning (capped); Mayo Street (403)
-- and City of Portland Parks (robots.txt disallow) are out.
--
-- Same web_collector pattern as 143/146. Idempotent: the disabled dry-run row is
-- flipped enabled; on staging it inserts fresh. Rollback: is_enabled = FALSE.
-- ============================================================================

WITH src AS (
  SELECT id FROM event_sources WHERE name='Web Collector' AND type='web_collector' LIMIT 1
)
INSERT INTO collector_targets (
  name, base_url, discovery_urls, allowed_paths, parsing_strategy, source_type,
  town, default_category, content_types, site_config, use_llm_fallback,
  max_pages_per_run, is_enabled, source_id
)
SELECT 'One Longfellow Square', 'https://onelongfellowsquare.com',
       ARRAY['/','/shows/'], ARRAY['/'], 'hybrid'::parsing_strategy, 'org',
       'Portland', 'music', '{events}', jsonb_build_object('timezone','America/New_York'),
       true, 5, true, src.id
FROM src
ON CONFLICT (name) DO UPDATE SET
  base_url=EXCLUDED.base_url, discovery_urls=EXCLUDED.discovery_urls,
  allowed_paths=EXCLUDED.allowed_paths, parsing_strategy=EXCLUDED.parsing_strategy,
  source_type=EXCLUDED.source_type, town=EXCLUDED.town,
  default_category=EXCLUDED.default_category, content_types=EXCLUDED.content_types,
  site_config=EXCLUDED.site_config, use_llm_fallback=EXCLUDED.use_llm_fallback,
  max_pages_per_run=EXCLUDED.max_pages_per_run, is_enabled=TRUE,
  source_id=EXCLUDED.source_id;

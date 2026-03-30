-- ============================================================================
-- Backfill source_url on Google Places explore_items
-- ============================================================================
-- Copies websiteUri from event_ingest_raw.raw_json → explore_items.source_url
-- for all Google Places activity items that currently have source_url = NULL.
--
-- Root cause: explore_items rows were normalized before websiteUri was added to
-- the Places API field mask, OR normalization jobs for updated records are
-- still queued. Either way, 575 raw records already have websiteUri but it
-- hasn't propagated to explore_items yet.
--
-- After this migration, run:
--   SELECT score_venue_for_events(30);
-- to seed venue_website_candidates with the newly-populated URLs.
--
-- Rollback:
--   UPDATE explore_items ei
--   SET source_url = NULL
--   FROM event_sources es
--   WHERE ei.source_id = es.id
--     AND es.type = 'api_google_places'
--     AND ei.kind = 'activity';
-- ============================================================================

-- ── Backfill source_url from raw JSON websiteUri ──────────────────────────────
UPDATE explore_items ei
SET
  source_url = eir.raw_json->>'websiteUri',
  updated_at = NOW()
FROM event_ingest_raw eir
JOIN event_sources es ON es.id = eir.source_id AND es.type = 'api_google_places'
WHERE
  ei.source_id = eir.source_id
  AND ei.external_id = eir.external_id
  AND ei.source_url IS NULL
  AND eir.raw_json->>'websiteUri' IS NOT NULL
  AND eir.raw_json->>'websiteUri' != '';

-- ── Summary ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_updated INTEGER;
  v_total   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_updated
  FROM explore_items ei
  JOIN event_sources es ON es.id = ei.source_id AND es.type = 'api_google_places'
  WHERE ei.source_url IS NOT NULL AND ei.kind = 'activity';

  SELECT COUNT(*) INTO v_total
  FROM explore_items ei
  JOIN event_sources es ON es.id = ei.source_id AND es.type = 'api_google_places'
  WHERE ei.kind = 'activity';

  RAISE NOTICE '120 backfill: % / % Google Places activities now have source_url', v_updated, v_total;
END;
$$;

-- ── Re-seed venue candidates with newly-populated URLs ────────────────────────
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT score_venue_for_events(30) INTO v_count;
  RAISE NOTICE '120 bootstrap: seeded % venue candidates after source_url backfill', v_count;
END;
$$;

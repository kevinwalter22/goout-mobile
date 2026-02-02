-- ============================================================================
-- Disable Eventbrite Geo-Discovery (Wave 3, Phase 0)
-- ============================================================================
-- Eventbrite removed public location-based event search (/v3/events/search/)
-- in February 2020. There is no replacement endpoint for geo-discovery.
--
-- This migration:
-- 1. Disables the Eventbrite source (is_enabled = false)
-- 2. Disables any Eventbrite fetch partitions
-- 3. Clears consecutive errors so health dashboard shows clean state
--
-- The source row and adapter code are preserved for potential future use
-- with curated organizer_id-based ingestion.
--
-- Rollback:
--   UPDATE event_sources SET is_enabled = true WHERE type = 'api_eventbrite';
--   UPDATE fetch_partitions SET is_enabled = true
--     WHERE source_id IN (SELECT id FROM event_sources WHERE type = 'api_eventbrite');
-- ============================================================================

-- 1. Disable Eventbrite source
UPDATE event_sources
SET
  is_enabled = false,
  config_json = COALESCE(config_json, '{}'::JSONB) || '{"disabled_reason": "geo_discovery_endpoint_removed", "disabled_at": "2026-02-01"}'::JSONB
WHERE type = 'api_eventbrite';

-- 2. Disable Eventbrite fetch partitions and clear error state
UPDATE fetch_partitions
SET
  is_enabled = false,
  consecutive_errors = 0,
  last_error = NULL
WHERE source_id IN (
  SELECT id FROM event_sources WHERE type = 'api_eventbrite'
);

-- 3. Clean up any failed normalization jobs from Eventbrite raw records
UPDATE event_normalization_jobs
SET status = 'failed', last_error = 'Source disabled: Eventbrite geo-discovery removed'
WHERE status IN ('queued', 'running')
AND raw_id IN (
  SELECT eir.id FROM event_ingest_raw eir
  JOIN event_sources es ON es.id = eir.source_id
  WHERE es.type = 'api_eventbrite'
);

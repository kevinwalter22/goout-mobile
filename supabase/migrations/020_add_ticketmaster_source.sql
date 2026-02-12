-- ============================================================================
-- Add Ticketmaster Event Source and Scheduling
-- ============================================================================
-- This migration:
-- 1. Adds Ticketmaster as an event source
-- 2. Creates helper functions for scheduled ingestion
-- 3. Sets up pg_cron jobs (if extension is available)
-- ============================================================================

-- ============================================================================
-- SEED: Ticketmaster source
-- ============================================================================

INSERT INTO event_sources (name, type, is_enabled, config_json, fetch_interval_minutes) VALUES
  ('Ticketmaster', 'api_ticketmaster', true, '{
    "description": "Ticketmaster Discovery API events",
    "default_lat": 44.6697,
    "default_lng": -74.9814,
    "default_radius": 50,
    "default_radius_unit": "miles",
    "days_ahead": 90
  }', 360)  -- Every 6 hours
ON CONFLICT (name) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  config_json = EXCLUDED.config_json,
  fetch_interval_minutes = EXCLUDED.fetch_interval_minutes;

-- ============================================================================
-- HELPER: Function to check if a source needs fetching
-- ============================================================================

CREATE OR REPLACE FUNCTION source_needs_fetch(p_source_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_last_fetch TIMESTAMPTZ;
  v_interval_minutes INTEGER;
  v_is_enabled BOOLEAN;
BEGIN
  SELECT last_fetch_at, fetch_interval_minutes, is_enabled
  INTO v_last_fetch, v_interval_minutes, v_is_enabled
  FROM event_sources
  WHERE name = p_source_name;

  -- Not enabled
  IF NOT v_is_enabled THEN
    RETURN FALSE;
  END IF;

  -- Never fetched
  IF v_last_fetch IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Check if interval has passed
  RETURN v_last_fetch + (v_interval_minutes || ' minutes')::INTERVAL < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER: Get sources due for fetch
-- ============================================================================

CREATE OR REPLACE FUNCTION get_sources_due_for_fetch()
RETURNS TABLE(
  source_name TEXT,
  source_type event_source_type,
  config JSONB,
  last_fetch TIMESTAMPTZ,
  minutes_overdue INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    es.name,
    es.type,
    es.config_json,
    es.last_fetch_at,
    EXTRACT(EPOCH FROM (NOW() - (es.last_fetch_at + (es.fetch_interval_minutes || ' minutes')::INTERVAL)))::INTEGER / 60
  FROM event_sources es
  WHERE es.is_enabled = true
    AND (
      es.last_fetch_at IS NULL
      OR es.last_fetch_at + (es.fetch_interval_minutes || ' minutes')::INTERVAL < NOW()
    )
  ORDER BY es.last_fetch_at NULLS FIRST;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER: Ingestion stats for monitoring
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ingestion_stats()
RETURNS TABLE(
  source_name TEXT,
  total_raw INTEGER,
  status_new INTEGER,
  status_normalized INTEGER,
  status_failed INTEGER,
  status_skipped INTEGER,
  last_fetch TIMESTAMPTZ,
  next_fetch TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    es.name,
    COUNT(eir.id)::INTEGER,
    COUNT(eir.id) FILTER (WHERE eir.status = 'new')::INTEGER,
    COUNT(eir.id) FILTER (WHERE eir.status = 'normalized')::INTEGER,
    COUNT(eir.id) FILTER (WHERE eir.status = 'failed')::INTEGER,
    COUNT(eir.id) FILTER (WHERE eir.status = 'skipped')::INTEGER,
    es.last_fetch_at,
    es.last_fetch_at + (es.fetch_interval_minutes || ' minutes')::INTERVAL
  FROM event_sources es
  LEFT JOIN event_ingest_raw eir ON eir.source_id = es.id
  GROUP BY es.id, es.name, es.last_fetch_at, es.fetch_interval_minutes
  ORDER BY es.name;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION source_needs_fetch(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_sources_due_for_fetch() TO service_role;
GRANT EXECUTE ON FUNCTION get_ingestion_stats() TO service_role;

-- ============================================================================
-- PG_CRON SCHEDULING (if extension is available)
-- ============================================================================
-- Note: pg_cron may not be available on all Supabase plans.
-- If not available, use Supabase Dashboard > Database > Extensions to enable it,
-- or use external scheduling (GitHub Actions, Vercel Cron, etc.)

DO $$
BEGIN
  -- Check if pg_cron is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Schedule Ticketmaster ingestion every 6 hours
    -- This calls the Edge Function via pg_net
    PERFORM cron.schedule(
      'ticketmaster-ingest',
      '0 */6 * * *',  -- Every 6 hours at minute 0
      $$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/ingest-ticketmaster',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      )
      $$
    );

    -- Schedule normalization every 15 minutes
    PERFORM cron.schedule(
      'normalize-events',
      '*/15 * * * *',  -- Every 15 minutes
      $$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/normalize-raw-events',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_items": 50}'::jsonb
      )
      $$
    );

    -- Schedule LLM enrichment every 30 minutes
    PERFORM cron.schedule(
      'enrich-events',
      '*/30 * * * *',  -- Every 30 minutes
      $$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/run-enrichment-queue',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_items": 20}'::jsonb
      )
      $$
    );

    RAISE NOTICE 'pg_cron jobs scheduled successfully';
  ELSE
    RAISE NOTICE 'pg_cron extension not available. Set up external scheduling for Edge Functions.';
  END IF;
END $$;

-- ============================================================================
-- COMMENT: Scheduling alternatives
-- ============================================================================

COMMENT ON FUNCTION get_sources_due_for_fetch() IS '
Returns event sources that are due for fetching based on their interval.
Use this with external scheduling if pg_cron is not available.

Example external scheduling options:
1. Supabase Cron (Pro plan): Dashboard > Database > Scheduled Functions
2. GitHub Actions: .github/workflows/ingest.yml with cron trigger
3. Vercel Cron: vercel.json with cron configuration
4. AWS EventBridge: Schedule Lambda to call Edge Functions

Edge Function URLs to call:
- POST /functions/v1/ingest-ticketmaster
- POST /functions/v1/normalize-raw-events
- POST /functions/v1/run-enrichment-queue
';

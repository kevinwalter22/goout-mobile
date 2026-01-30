-- ============================================================================
-- Pipeline Health Monitoring
-- ============================================================================
-- Adds a pipeline_health_log table for recording per-run metrics from
-- ingestion, normalization, enrichment, and dedup stages.
--
-- Also adds a snapshot RPC (pipeline_health_snapshot) that returns a
-- real-time summary of the pipeline state, usable by the health-summary
-- Edge Function.
--
-- Rollback:
--   DROP TABLE IF EXISTS pipeline_health_log;
--   DROP FUNCTION IF EXISTS pipeline_health_snapshot();
-- ============================================================================

-- ============================================================================
-- 1. Health log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_health_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage         TEXT NOT NULL,            -- 'ingest', 'normalize', 'enrich', 'dedup', 'schedule'
  source_name   TEXT,                     -- e.g. 'Ticketmaster', 'Eventbrite', NULL for global
  status        TEXT NOT NULL DEFAULT 'ok', -- 'ok', 'warn', 'error'
  items_processed INTEGER DEFAULT 0,
  items_failed  INTEGER DEFAULT 0,
  duration_ms   INTEGER,
  details_json  JSONB,                    -- stage-specific details
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_health_log_stage
  ON pipeline_health_log (stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_health_log_created
  ON pipeline_health_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_health_log_status
  ON pipeline_health_log (status) WHERE status != 'ok';

-- Auto-cleanup: drop rows older than 30 days
-- (will be run by pg_cron or manually)
CREATE OR REPLACE FUNCTION cleanup_old_health_logs(p_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM pipeline_health_log
  WHERE created_at < NOW() - (p_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. Real-time health snapshot RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION pipeline_health_snapshot()
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_sources JSONB;
  v_queues JSONB;
  v_quality JSONB;
  v_recent_errors JSONB;
BEGIN
  -- Per-source summary
  SELECT COALESCE(jsonb_agg(source_row), '[]'::JSONB) INTO v_sources
  FROM (
    SELECT jsonb_build_object(
      'name', es.name,
      'type', es.type::TEXT,
      'is_enabled', es.is_enabled,
      'last_fetch_at', es.last_fetch_at,
      'fetch_interval_minutes', es.fetch_interval_minutes,
      'minutes_since_fetch', CASE
        WHEN es.last_fetch_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (NOW() - es.last_fetch_at)) / 60
        ELSE NULL
      END,
      'is_overdue', CASE
        WHEN es.last_fetch_at IS NOT NULL AND es.is_enabled
        THEN (NOW() - es.last_fetch_at) > (es.fetch_interval_minutes * INTERVAL '1 minute' * 2)
        ELSE FALSE
      END,
      'total_items', (
        SELECT COUNT(*) FROM explore_items ei
        WHERE ei.source_id = es.id AND ei.priority >= 0
      ),
      'raw_pending', (
        SELECT COUNT(*) FROM event_ingest_raw eir
        WHERE eir.source_id = es.id AND eir.status = 'new'
      )
    ) AS source_row
    FROM event_sources es
    ORDER BY es.name
  ) sub;

  -- Queue depths
  SELECT jsonb_build_object(
    'normalization', jsonb_build_object(
      'queued', (SELECT COUNT(*) FROM event_normalization_jobs WHERE status = 'queued'),
      'running', (SELECT COUNT(*) FROM event_normalization_jobs WHERE status = 'running'),
      'failed', (SELECT COUNT(*) FROM event_normalization_jobs WHERE status = 'failed'),
      'done', (SELECT COUNT(*) FROM event_normalization_jobs WHERE status = 'done')
    ),
    'enrichment', jsonb_build_object(
      'queued', (SELECT COUNT(*) FROM enrichment_queue WHERE status = 'queued'),
      'running', (SELECT COUNT(*) FROM enrichment_queue WHERE status = 'running'),
      'failed', (SELECT COUNT(*) FROM enrichment_queue WHERE status = 'failed'),
      'done', (SELECT COUNT(*) FROM enrichment_queue WHERE status = 'done')
    )
  ) INTO v_queues;

  -- Data quality metrics
  SELECT jsonb_build_object(
    'total_items', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0),
    'active_items', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate),
    'duplicates_marked', (SELECT COUNT(*) FROM explore_items WHERE is_duplicate = TRUE),
    'missing_confidence', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND normalized_confidence IS NULL),
    'low_confidence', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND normalized_confidence IS NOT NULL AND normalized_confidence < 40),
    'avg_confidence', (SELECT ROUND(AVG(normalized_confidence)) FROM explore_items WHERE priority >= 0 AND normalized_confidence IS NOT NULL),
    'missing_hook_line', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND (hook_line IS NULL OR LENGTH(hook_line) < 10)),
    'missing_tags', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND (tags IS NULL OR array_length(tags, 1) IS NULL)),
    'missing_availability', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND kind = 'event' AND availability_json IS NULL),
    'unknown_price', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND price_bucket = 'unknown'),
    'stale_items', (SELECT COUNT(*) FROM explore_items WHERE priority < 0)
  ) INTO v_quality;

  -- Recent errors (last 24h)
  SELECT COALESCE(jsonb_agg(err_row), '[]'::JSONB) INTO v_recent_errors
  FROM (
    SELECT jsonb_build_object(
      'stage', stage,
      'source_name', source_name,
      'status', status,
      'items_failed', items_failed,
      'created_at', created_at,
      'details', details_json
    ) AS err_row
    FROM pipeline_health_log
    WHERE status != 'ok'
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 20
  ) sub;

  -- Assemble final result
  v_result := jsonb_build_object(
    'snapshot_at', NOW(),
    'sources', v_sources,
    'queues', v_queues,
    'quality', v_quality,
    'recent_errors', v_recent_errors
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 3. Permissions
-- ============================================================================

-- RLS: health log is service-role only (no public read/write)
ALTER TABLE pipeline_health_log ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_full_access" ON pipeline_health_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- The snapshot RPC is safe for authenticated users (read-only aggregates)
GRANT EXECUTE ON FUNCTION pipeline_health_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_health_logs(INTEGER) TO service_role;

-- ============================================================================
-- 4. Optional pg_cron cleanup (weekly)
-- ============================================================================

DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-health-logs',
    '0 5 * * 0',  -- Sunday 05:00 UTC
    'SELECT cleanup_old_health_logs(30)'
  );
  RAISE NOTICE 'pg_cron job scheduled: cleanup-health-logs (weekly Sunday 05:00 UTC)';
EXCEPTION
  WHEN undefined_function OR invalid_schema_name THEN
    RAISE NOTICE 'pg_cron not available — run cleanup_old_health_logs() manually';
END;
$$;

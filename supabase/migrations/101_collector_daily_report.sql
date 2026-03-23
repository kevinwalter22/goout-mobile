-- ============================================================================
-- Collector Daily Report Function
-- ============================================================================
-- Aggregation function for monitoring web collector activity.
-- Returns per-source ingestion stats, dedup rates, and top errors.
--
-- Usage:
--   SELECT collector_daily_report();        -- last 24 hours
--   SELECT collector_daily_report(48);      -- last 48 hours
--
-- Rollback:
--   DROP FUNCTION IF EXISTS collector_daily_report(INTEGER);
-- ============================================================================

CREATE OR REPLACE FUNCTION collector_daily_report(
  p_hours INTEGER DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_per_source JSONB;
  v_dedup_stats JSONB;
  v_top_errors JSONB;
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := NOW() - (p_hours || ' hours')::INTERVAL;

  -- Per-source ingestion stats
  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'target_name'), '[]'::JSONB)
  INTO v_per_source
  FROM (
    SELECT jsonb_build_object(
      'target_name', ct.name,
      'source_type', ct.source_type,
      'is_enabled', ct.is_enabled,
      'circuit_breaker', ct.circuit_breaker::TEXT,
      'last_run_at', ct.last_run_at,
      'last_run_pages_fetched', ct.last_run_pages_fetched,
      'last_run_items_found', ct.last_run_items_found,
      'total_items_collected', ct.total_items_collected,
      'raw_ingested', (
        SELECT COUNT(*) FROM event_ingest_raw eir
        WHERE eir.source_id = ct.source_id
          AND eir.fetched_at > v_cutoff
      ),
      'items_created', (
        SELECT COUNT(*) FROM explore_items ei
        WHERE ei.source_id = ct.source_id
          AND ei.created_at > v_cutoff
      ),
      'duplicates', (
        SELECT COUNT(*) FROM explore_items ei
        WHERE ei.source_id = ct.source_id
          AND ei.is_duplicate = TRUE
          AND ei.updated_at > v_cutoff
      )
    ) AS row_data
    FROM collector_targets ct
    WHERE ct.source_id IS NOT NULL
    ORDER BY ct.is_enabled DESC, ct.name
  ) sub;

  -- Overall dedup and rejection stats
  SELECT jsonb_build_object(
    'total_raw', (
      SELECT COUNT(*) FROM event_ingest_raw
      WHERE fetched_at > v_cutoff
    ),
    'total_items_created', (
      SELECT COUNT(*) FROM explore_items
      WHERE created_at > v_cutoff
    ),
    'duplicates_marked', (
      SELECT COUNT(*) FROM explore_items
      WHERE is_duplicate = TRUE
        AND updated_at > v_cutoff
    ),
    'failed_normalization', (
      SELECT COUNT(*) FROM event_ingest_raw
      WHERE status = 'failed'
        AND fetched_at > v_cutoff
    )
  ) INTO v_dedup_stats;

  -- Top errors from pipeline_health_log
  SELECT COALESCE(jsonb_agg(err_row), '[]'::JSONB)
  INTO v_top_errors
  FROM (
    SELECT jsonb_build_object(
      'source_name', phl.source_name,
      'stage', phl.stage,
      'status', phl.status,
      'items_failed', phl.items_failed,
      'created_at', phl.created_at,
      'error_summary', phl.details_json->'errors'
    ) AS err_row
    FROM pipeline_health_log phl
    WHERE phl.status IN ('warn', 'error')
      AND phl.created_at > v_cutoff
    ORDER BY phl.created_at DESC
    LIMIT 20
  ) sub;

  v_result := jsonb_build_object(
    'report_at', NOW(),
    'period_hours', p_hours,
    'per_source', v_per_source,
    'dedup_stats', v_dedup_stats,
    'top_errors', v_top_errors
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION collector_daily_report(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION collector_daily_report(INTEGER) TO service_role;

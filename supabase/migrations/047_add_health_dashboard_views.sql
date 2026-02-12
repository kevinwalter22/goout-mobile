-- ============================================================================
-- Health Dashboard Views for Pipeline Monitoring
-- ============================================================================
-- Adds views and functions for monitoring the web collector system and
-- overall pipeline health. Designed for operational dashboards.
--
-- Rollback:
--   DROP VIEW IF EXISTS v_collector_target_health;
--   DROP VIEW IF EXISTS v_pipeline_stage_health;
--   DROP VIEW IF EXISTS v_ingestion_activity;
--   DROP FUNCTION IF EXISTS web_collector_health_snapshot();
-- ============================================================================

-- ============================================================================
-- 1. Web Collector Target Health View
-- ============================================================================

CREATE OR REPLACE VIEW v_collector_target_health AS
SELECT
  ct.id AS target_id,
  ct.name,
  ct.base_url,
  ct.is_enabled,
  ct.circuit_breaker,
  ct.consecutive_errors,
  ct.parsing_strategy::TEXT AS strategy,
  ct.crawl_frequency_minutes,
  ct.last_run_at,
  ct.last_run_pages_fetched,
  ct.last_run_items_found,
  -- Time since last run
  CASE
    WHEN ct.last_run_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (NOW() - ct.last_run_at)) / 60
    ELSE NULL
  END AS minutes_since_run,
  -- Is overdue for crawl?
  CASE
    WHEN ct.is_enabled AND ct.last_run_at IS NOT NULL
    THEN (NOW() - ct.last_run_at) > (ct.crawl_frequency_minutes * INTERVAL '1 minute')
    WHEN ct.is_enabled AND ct.last_run_at IS NULL
    THEN TRUE
    ELSE FALSE
  END AS is_overdue,
  -- Robots.txt status
  ct.robots_txt_allows_crawl,
  ct.robots_txt_fetched_at,
  CASE
    WHEN ct.robots_txt_fetched_at IS NOT NULL
    THEN (NOW() - ct.robots_txt_fetched_at) > INTERVAL '24 hours'
    ELSE TRUE
  END AS robots_cache_stale,
  -- Page cache stats (subquery)
  (SELECT COUNT(*) FROM collector_page_cache cpc WHERE cpc.target_id = ct.id) AS total_cached_pages,
  (SELECT COUNT(*) FROM collector_page_cache cpc
   WHERE cpc.target_id = ct.id AND cpc.extracted_candidates IS NOT NULL) AS pages_with_extractions,
  (SELECT SUM(jsonb_array_length(cpc.extracted_candidates))
   FROM collector_page_cache cpc
   WHERE cpc.target_id = ct.id AND cpc.extracted_candidates IS NOT NULL) AS total_candidates_extracted,
  ct.created_at,
  ct.updated_at
FROM collector_targets ct
ORDER BY ct.is_enabled DESC, ct.name;

COMMENT ON VIEW v_collector_target_health IS
'Operational view of web collector targets with health indicators';

-- ============================================================================
-- 2. Pipeline Stage Health Summary View
-- ============================================================================

CREATE OR REPLACE VIEW v_pipeline_stage_health AS
WITH recent_logs AS (
  SELECT
    stage,
    source_name,
    status,
    items_processed,
    items_failed,
    duration_ms,
    details_json,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY stage, source_name ORDER BY created_at DESC) AS rn
  FROM pipeline_health_log
  WHERE created_at > NOW() - INTERVAL '7 days'
),
stage_stats AS (
  SELECT
    stage,
    source_name,
    COUNT(*) AS runs_last_7d,
    SUM(items_processed) AS total_processed,
    SUM(items_failed) AS total_failed,
    AVG(duration_ms)::INTEGER AS avg_duration_ms,
    COUNT(*) FILTER (WHERE status = 'error') AS error_runs,
    COUNT(*) FILTER (WHERE status = 'warn') AS warn_runs,
    MAX(created_at) AS last_run_at
  FROM recent_logs
  GROUP BY stage, source_name
),
last_status AS (
  SELECT stage, source_name, status AS last_status, details_json AS last_details
  FROM recent_logs
  WHERE rn = 1
)
SELECT
  s.stage,
  COALESCE(s.source_name, 'ALL') AS source_name,
  s.runs_last_7d,
  s.total_processed,
  s.total_failed,
  CASE
    WHEN s.total_processed + s.total_failed > 0
    THEN ROUND(100.0 * s.total_processed / (s.total_processed + s.total_failed), 1)
    ELSE 100.0
  END AS success_rate_pct,
  s.avg_duration_ms,
  s.error_runs,
  s.warn_runs,
  s.last_run_at,
  l.last_status,
  l.last_details
FROM stage_stats s
LEFT JOIN last_status l ON s.stage = l.stage
  AND (s.source_name = l.source_name OR (s.source_name IS NULL AND l.source_name IS NULL))
ORDER BY s.stage, s.source_name NULLS FIRST;

COMMENT ON VIEW v_pipeline_stage_health IS
'7-day health summary by pipeline stage (ingest, normalize, enrich, dedup, web_collect)';

-- ============================================================================
-- 3. Ingestion Activity View (last 24h)
-- ============================================================================

CREATE OR REPLACE VIEW v_ingestion_activity AS
SELECT
  es.name AS source_name,
  es.type::TEXT AS source_type,
  es.is_enabled,
  es.last_fetch_at,
  -- Raw records
  (SELECT COUNT(*) FROM event_ingest_raw eir WHERE eir.source_id = es.id) AS total_raw_records,
  (SELECT COUNT(*) FROM event_ingest_raw eir
   WHERE eir.source_id = es.id AND eir.status = 'new') AS raw_pending,
  (SELECT COUNT(*) FROM event_ingest_raw eir
   WHERE eir.source_id = es.id AND eir.status = 'normalized') AS raw_normalized,
  (SELECT COUNT(*) FROM event_ingest_raw eir
   WHERE eir.source_id = es.id AND eir.status = 'failed') AS raw_failed,
  (SELECT COUNT(*) FROM event_ingest_raw eir
   WHERE eir.source_id = es.id AND eir.status = 'skipped') AS raw_skipped,
  -- Normalization jobs
  (SELECT COUNT(*) FROM event_normalization_jobs enj
   JOIN event_ingest_raw eir ON enj.raw_id = eir.id
   WHERE eir.source_id = es.id AND enj.status = 'queued') AS norm_queued,
  (SELECT COUNT(*) FROM event_normalization_jobs enj
   JOIN event_ingest_raw eir ON enj.raw_id = eir.id
   WHERE eir.source_id = es.id AND enj.status = 'failed') AS norm_failed,
  -- Explore items
  (SELECT COUNT(*) FROM explore_items ei
   WHERE ei.source_id = es.id AND ei.priority >= 0) AS active_items,
  (SELECT COUNT(*) FROM explore_items ei
   WHERE ei.source_id = es.id AND ei.is_duplicate = TRUE) AS duplicate_items,
  -- Recent activity (last 24h)
  (SELECT COUNT(*) FROM event_ingest_raw eir
   WHERE eir.source_id = es.id AND eir.fetched_at > NOW() - INTERVAL '24 hours') AS raw_last_24h,
  (SELECT COUNT(*) FROM explore_items ei
   WHERE ei.source_id = es.id AND ei.created_at > NOW() - INTERVAL '24 hours') AS items_created_24h
FROM event_sources es
ORDER BY es.is_enabled DESC, es.name;

COMMENT ON VIEW v_ingestion_activity IS
'Per-source ingestion activity and queue depths';

-- ============================================================================
-- 4. Web Collector Health Snapshot Function
-- ============================================================================

CREATE OR REPLACE FUNCTION web_collector_health_snapshot()
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_targets JSONB;
  v_cache_stats JSONB;
  v_recent_runs JSONB;
BEGIN
  -- Target summary
  SELECT jsonb_build_object(
    'total', COUNT(*),
    'enabled', COUNT(*) FILTER (WHERE is_enabled),
    'disabled', COUNT(*) FILTER (WHERE NOT is_enabled),
    'circuit_open', COUNT(*) FILTER (WHERE circuit_breaker = 'open'),
    'circuit_half_open', COUNT(*) FILTER (WHERE circuit_breaker = 'half_open'),
    'overdue', COUNT(*) FILTER (
      WHERE is_enabled
      AND last_run_at IS NOT NULL
      AND (NOW() - last_run_at) > (crawl_frequency_minutes * INTERVAL '1 minute')
    ),
    'never_run', COUNT(*) FILTER (WHERE is_enabled AND last_run_at IS NULL),
    'robots_blocked', COUNT(*) FILTER (WHERE robots_txt_allows_crawl = FALSE)
  ) INTO v_targets
  FROM collector_targets;

  -- Page cache stats
  SELECT jsonb_build_object(
    'total_pages', COUNT(*),
    'with_html', COUNT(*) FILTER (WHERE raw_html IS NOT NULL),
    'with_extractions', COUNT(*) FILTER (WHERE extracted_candidates IS NOT NULL),
    'total_candidates', COALESCE(SUM(jsonb_array_length(extracted_candidates)), 0),
    'fetch_errors', COUNT(*) FILTER (WHERE http_status >= 400 OR http_status IS NULL),
    'avg_candidates_per_page', ROUND(
      AVG(jsonb_array_length(extracted_candidates)) FILTER (WHERE extracted_candidates IS NOT NULL), 1
    )
  ) INTO v_cache_stats
  FROM collector_page_cache;

  -- Recent runs from health log
  SELECT COALESCE(jsonb_agg(run_row ORDER BY created_at DESC), '[]'::JSONB) INTO v_recent_runs
  FROM (
    SELECT jsonb_build_object(
      'source_name', source_name,
      'status', status,
      'items_processed', items_processed,
      'items_failed', items_failed,
      'duration_ms', duration_ms,
      'created_at', created_at,
      'details', details_json
    ) AS run_row,
    created_at
    FROM pipeline_health_log
    WHERE stage IN ('ingest', 'web_collect')
      AND (source_name = 'Web Collector' OR details_json ? 'targets_processed')
      AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC
    LIMIT 20
  ) sub;

  -- Build result
  v_result := jsonb_build_object(
    'snapshot_at', NOW(),
    'targets', v_targets,
    'page_cache', v_cache_stats,
    'recent_runs', v_recent_runs
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION web_collector_health_snapshot() IS
'Real-time health snapshot for web collector system';

-- ============================================================================
-- 5. Enhanced pipeline_health_snapshot with web collector
-- ============================================================================

CREATE OR REPLACE FUNCTION pipeline_health_snapshot()
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_sources JSONB;
  v_queues JSONB;
  v_quality JSONB;
  v_recent_errors JSONB;
  v_web_collector JSONB;
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

  -- Web collector specific stats
  SELECT web_collector_health_snapshot() INTO v_web_collector;

  -- Assemble final result
  v_result := jsonb_build_object(
    'snapshot_at', NOW(),
    'sources', v_sources,
    'queues', v_queues,
    'quality', v_quality,
    'recent_errors', v_recent_errors,
    'web_collector', v_web_collector
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 6. Quick Health Check Function (Lightweight)
-- ============================================================================

CREATE OR REPLACE FUNCTION quick_health_check()
RETURNS TABLE (
  check_name TEXT,
  check_status TEXT,
  check_value TEXT,
  check_details TEXT
) AS $$
BEGIN
  -- Normalization queue backlog
  RETURN QUERY
  SELECT
    'norm_queue_backlog'::TEXT,
    CASE WHEN cnt > 100 THEN 'warn' WHEN cnt > 500 THEN 'critical' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Normalization jobs queued'::TEXT
  FROM (SELECT COUNT(*) AS cnt FROM event_normalization_jobs enj WHERE enj.status = 'queued') sub;

  -- Enrichment queue backlog
  RETURN QUERY
  SELECT
    'enrich_queue_backlog'::TEXT,
    CASE WHEN cnt > 200 THEN 'warn' WHEN cnt > 1000 THEN 'critical' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Enrichment jobs queued'::TEXT
  FROM (SELECT COUNT(*) AS cnt FROM enrichment_queue eq WHERE eq.status = 'queued') sub;

  -- Failed normalization jobs
  RETURN QUERY
  SELECT
    'norm_failed_jobs'::TEXT,
    CASE WHEN cnt > 10 THEN 'warn' WHEN cnt > 50 THEN 'critical' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Failed normalization jobs'::TEXT
  FROM (SELECT COUNT(*) AS cnt FROM event_normalization_jobs enj WHERE enj.status = 'failed') sub;

  -- Circuit breakers open
  RETURN QUERY
  SELECT
    'circuit_breakers_open'::TEXT,
    CASE WHEN cnt > 0 THEN 'warn' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Web collector targets with open circuit breakers'::TEXT
  FROM (SELECT COUNT(*) AS cnt FROM collector_targets ct WHERE ct.circuit_breaker = 'open') sub;

  -- Overdue web collector targets
  RETURN QUERY
  SELECT
    'overdue_collectors'::TEXT,
    CASE WHEN cnt > 0 THEN 'warn' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Enabled targets overdue for crawl'::TEXT
  FROM (
    SELECT COUNT(*) AS cnt FROM collector_targets ct
    WHERE ct.is_enabled
      AND ct.last_run_at IS NOT NULL
      AND (NOW() - ct.last_run_at) > (ct.crawl_frequency_minutes * INTERVAL '1 minute' * 1.5)
  ) sub;

  -- Recent errors in health log
  RETURN QUERY
  SELECT
    'recent_errors'::TEXT,
    CASE WHEN cnt > 5 THEN 'warn' WHEN cnt > 20 THEN 'critical' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Errors in last 24 hours'::TEXT
  FROM (
    SELECT COUNT(*) AS cnt FROM pipeline_health_log phl
    WHERE phl.status = 'error' AND phl.created_at > NOW() - INTERVAL '24 hours'
  ) sub;

  -- Data quality: low confidence items
  RETURN QUERY
  SELECT
    'low_confidence_items'::TEXT,
    CASE WHEN pct > 30 THEN 'warn' WHEN pct > 50 THEN 'critical' ELSE 'ok' END::TEXT,
    ROUND(pct, 1)::TEXT || '%',
    'Items with confidence < 40'::TEXT
  FROM (
    SELECT 100.0 * COUNT(*) FILTER (WHERE ei.normalized_confidence < 40) / NULLIF(COUNT(*), 0) AS pct
    FROM explore_items ei WHERE ei.priority >= 0 AND ei.normalized_confidence IS NOT NULL
  ) sub;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION quick_health_check() IS
'Lightweight health check returning key metrics with status indicators';

-- ============================================================================
-- 7. Permissions
-- ============================================================================

-- Grant view access to authenticated users (read-only monitoring)
GRANT SELECT ON v_collector_target_health TO authenticated;
GRANT SELECT ON v_pipeline_stage_health TO authenticated;
GRANT SELECT ON v_ingestion_activity TO authenticated;

-- Grant function access
GRANT EXECUTE ON FUNCTION web_collector_health_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION quick_health_check() TO authenticated;

-- ============================================================================
-- Fix: Health Check CASE Statement Order
-- ============================================================================
-- Issue: CASE statements check lower threshold before higher, so 'critical'
--        status is never reached (e.g., cnt > 100 returns 'warn' before
--        cnt > 500 can return 'critical').
--
-- Fix: Reverse the CASE order to check 'critical' threshold first.
--
-- Rollback:
--   -- Revert to migration 048 version of quick_health_check()
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
  -- FIX: Check critical (500) before warn (100)
  RETURN QUERY
  SELECT
    'norm_queue_backlog'::TEXT,
    CASE WHEN cnt > 500 THEN 'critical' WHEN cnt > 100 THEN 'warn' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Normalization jobs queued'::TEXT
  FROM (SELECT COUNT(*) AS cnt FROM event_normalization_jobs enj WHERE enj.status = 'queued') sub;

  -- Enrichment queue backlog
  -- FIX: Check critical (1000) before warn (200)
  RETURN QUERY
  SELECT
    'enrich_queue_backlog'::TEXT,
    CASE WHEN cnt > 1000 THEN 'critical' WHEN cnt > 200 THEN 'warn' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Enrichment jobs queued'::TEXT
  FROM (SELECT COUNT(*) AS cnt FROM enrichment_queue eq WHERE eq.status = 'queued') sub;

  -- Enrichment jobs stuck in running
  -- FIX: Check critical (100) before warn (10)
  RETURN QUERY
  SELECT
    'enrich_stuck_running'::TEXT,
    CASE WHEN cnt > 100 THEN 'critical' WHEN cnt > 10 THEN 'warn' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Enrichment jobs stuck running >30min'::TEXT
  FROM (
    SELECT COUNT(*) AS cnt FROM enrichment_queue eq
    WHERE eq.status = 'running'
      AND eq.started_at < NOW() - INTERVAL '30 minutes'
  ) sub;

  -- Failed normalization jobs
  -- FIX: Check critical (50) before warn (10)
  RETURN QUERY
  SELECT
    'norm_failed_jobs'::TEXT,
    CASE WHEN cnt > 50 THEN 'critical' WHEN cnt > 10 THEN 'warn' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Failed normalization jobs'::TEXT
  FROM (SELECT COUNT(*) AS cnt FROM event_normalization_jobs enj WHERE enj.status = 'failed') sub;

  -- Circuit breakers open (no change - only has warn threshold)
  RETURN QUERY
  SELECT
    'circuit_breakers_open'::TEXT,
    CASE WHEN cnt > 0 THEN 'warn' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Web collector targets with open circuit breakers'::TEXT
  FROM (SELECT COUNT(*) AS cnt FROM collector_targets ct WHERE ct.circuit_breaker = 'open') sub;

  -- Overdue web collector targets (no change - only has warn threshold)
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
  -- FIX: Check critical (20) before warn (5)
  RETURN QUERY
  SELECT
    'recent_errors'::TEXT,
    CASE WHEN cnt > 20 THEN 'critical' WHEN cnt > 5 THEN 'warn' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Errors in last 24 hours'::TEXT
  FROM (
    SELECT COUNT(*) AS cnt FROM pipeline_health_log phl
    WHERE phl.status = 'error' AND phl.created_at > NOW() - INTERVAL '24 hours'
  ) sub;

  -- Data quality: low confidence items
  -- FIX: Check critical (50%) before warn (30%)
  RETURN QUERY
  SELECT
    'low_confidence_items'::TEXT,
    CASE WHEN pct > 50 THEN 'critical' WHEN pct > 30 THEN 'warn' ELSE 'ok' END::TEXT,
    ROUND(pct, 1)::TEXT || '%',
    'Items with confidence < 40'::TEXT
  FROM (
    SELECT 100.0 * COUNT(*) FILTER (WHERE ei.normalized_confidence < 40) / NULLIF(COUNT(*), 0) AS pct
    FROM explore_items ei WHERE ei.priority >= 0 AND ei.normalized_confidence IS NOT NULL
  ) sub;

  -- Data quality: missing category
  -- FIX: Check critical (40%) before warn (20%)
  RETURN QUERY
  SELECT
    'missing_category'::TEXT,
    CASE WHEN pct > 40 THEN 'critical' WHEN pct > 20 THEN 'warn' ELSE 'ok' END::TEXT,
    ROUND(pct, 1)::TEXT || '%',
    'Items missing category'::TEXT
  FROM (
    SELECT 100.0 * COUNT(*) FILTER (WHERE ei.category IS NULL) / NULLIF(COUNT(*), 0) AS pct
    FROM explore_items ei WHERE ei.priority >= 0 AND NOT ei.is_duplicate
  ) sub;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

-- Verification query (run after applying):
-- SELECT * FROM quick_health_check();
-- With this fix:
--   - cnt=600 normalization jobs now returns 'critical' (not 'warn')
--   - cnt=1500 enrichment jobs now returns 'critical' (not 'warn')

-- ============================================================================
-- Fix: Enrichment Queue Reset + Category Backfill
-- ============================================================================
-- Issues addressed:
-- 1. P0: All enrichment jobs stuck in 'running' state (1028 jobs)
-- 2. P1: 28% of items missing category (278 items)
--
-- Actions:
-- 1. Reset stuck running jobs to queued
-- 2. Add job timeout function for future stuck job recovery
-- 3. Backfill categories from tags for items missing category
-- 4. Add category inference function
--
-- Rollback:
--   -- Jobs will be re-queued, no data loss
--   DROP FUNCTION IF EXISTS reset_stale_enrichment_jobs(INTEGER);
--   DROP FUNCTION IF EXISTS infer_category_from_tags(TEXT[]);
-- ============================================================================

-- ============================================================================
-- 1. Reset stuck enrichment jobs
-- ============================================================================

-- First, let's see what we're fixing
DO $$
DECLARE
  v_running_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_running_count
  FROM enrichment_queue WHERE status = 'running';
  RAISE NOTICE 'Resetting % stuck enrichment jobs from running to queued', v_running_count;
END $$;

-- Reset all running jobs to queued (they'll be re-processed)
UPDATE enrichment_queue
SET
  status = 'queued',
  started_at = NULL,
  attempts = LEAST(attempts, 2),  -- Don't let attempts get too high
  last_error = 'Reset: job was stuck in running state',
  updated_at = NOW()
WHERE status = 'running';

-- ============================================================================
-- 2. Add job timeout function for future stuck jobs
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_stale_enrichment_jobs(
  p_timeout_minutes INTEGER DEFAULT 30
)
RETURNS TABLE(jobs_reset INTEGER) AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Reset jobs that have been running for longer than timeout
  UPDATE enrichment_queue
  SET
    status = 'queued',
    started_at = NULL,
    last_error = format('Reset: exceeded %s minute timeout', p_timeout_minutes),
    updated_at = NOW()
  WHERE status = 'running'
    AND started_at < NOW() - (p_timeout_minutes || ' minutes')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION reset_stale_enrichment_jobs(INTEGER) TO service_role;

COMMENT ON FUNCTION reset_stale_enrichment_jobs IS
'Resets enrichment jobs stuck in running state for longer than timeout (default 30 min)';

-- ============================================================================
-- 3. Category inference function from tags
-- ============================================================================

CREATE OR REPLACE FUNCTION infer_category_from_tags(p_tags TEXT[])
RETURNS TEXT AS $$
BEGIN
  IF p_tags IS NULL OR array_length(p_tags, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  -- Priority-ordered category inference from common tags
  -- Food & Drink
  IF p_tags && ARRAY['food', 'dining', 'coffee', 'bar', 'drinks'] THEN
    RETURN 'food';
  END IF;

  -- Outdoor & Nature
  IF p_tags && ARRAY['outdoors', 'nature', 'parks', 'hiking', 'trail', 'camping', 'scenic'] THEN
    RETURN 'outdoor';
  END IF;

  -- Fitness & Wellness
  IF p_tags && ARRAY['fitness', 'wellness', 'swimming'] THEN
    RETURN 'fitness';
  END IF;

  -- Recreation & Sports
  IF p_tags && ARRAY['sports', 'recreation', 'adventure', 'winter'] THEN
    RETURN 'recreation';
  END IF;

  -- Arts & Culture
  IF p_tags && ARRAY['museum', 'cultural', 'theater', 'educational'] THEN
    RETURN 'arts';
  END IF;

  -- Entertainment
  IF p_tags && ARRAY['live_event', 'family_friendly', 'group_activity'] THEN
    RETURN 'entertainment';
  END IF;

  -- Nightlife
  IF p_tags && ARRAY['nightlife', 'social', 'adults_only'] THEN
    RETURN 'nightlife';
  END IF;

  -- Shopping
  IF p_tags && ARRAY['shopping'] THEN
    RETURN 'community';
  END IF;

  -- Community (fallback for social/local tags)
  IF p_tags && ARRAY['community', 'local_favorite', 'travel'] THEN
    RETURN 'community';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION infer_category_from_tags IS
'Infers category from tags array using priority-ordered matching';

-- ============================================================================
-- 4. Backfill missing categories from tags
-- ============================================================================

-- Update items missing category where we can infer from tags
UPDATE explore_items
SET
  category = infer_category_from_tags(tags),
  updated_at = NOW()
WHERE category IS NULL
  AND tags IS NOT NULL
  AND array_length(tags, 1) > 0
  AND infer_category_from_tags(tags) IS NOT NULL;

-- Log how many were fixed
DO $$
DECLARE
  v_still_missing INTEGER;
  v_total_active INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_still_missing
  FROM explore_items
  WHERE priority >= 0 AND NOT is_duplicate AND category IS NULL;

  SELECT COUNT(*) INTO v_total_active
  FROM explore_items
  WHERE priority >= 0 AND NOT is_duplicate;

  RAISE NOTICE 'After backfill: % items still missing category (out of % active)',
    v_still_missing, v_total_active;
END $$;

-- ============================================================================
-- 5. Add quick_health_check update for enrichment stuck jobs
-- ============================================================================

-- Update quick_health_check to include stale running jobs check
-- (This replaces the existing function to add the new check)

DROP FUNCTION IF EXISTS quick_health_check();

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

  -- Enrichment jobs stuck in running (NEW)
  RETURN QUERY
  SELECT
    'enrich_stuck_running'::TEXT,
    CASE WHEN cnt > 10 THEN 'warn' WHEN cnt > 100 THEN 'critical' ELSE 'ok' END::TEXT,
    cnt::TEXT,
    'Enrichment jobs stuck running >30min'::TEXT
  FROM (
    SELECT COUNT(*) AS cnt FROM enrichment_queue eq
    WHERE eq.status = 'running'
      AND eq.started_at < NOW() - INTERVAL '30 minutes'
  ) sub;

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

  -- Data quality: missing category (NEW)
  RETURN QUERY
  SELECT
    'missing_category'::TEXT,
    CASE WHEN pct > 20 THEN 'warn' WHEN pct > 40 THEN 'critical' ELSE 'ok' END::TEXT,
    ROUND(pct, 1)::TEXT || '%',
    'Items missing category'::TEXT
  FROM (
    SELECT 100.0 * COUNT(*) FILTER (WHERE ei.category IS NULL) / NULLIF(COUNT(*), 0) AS pct
    FROM explore_items ei WHERE ei.priority >= 0 AND NOT ei.is_duplicate
  ) sub;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION quick_health_check() TO authenticated;

COMMENT ON FUNCTION quick_health_check() IS
'Lightweight health check returning key metrics with status indicators';

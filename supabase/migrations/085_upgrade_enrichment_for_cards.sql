-- ============================================================================
-- Migration 085: Upgrade enrichment pipeline for card feed quality
-- ============================================================================
-- 1. Upgrades claim_enrichment_job() to return location_name, town, kind
--    (needed by the improved enrichment prompt)
-- 2. Adds queue_all_for_reenrichment() to force re-enrich all items
-- ============================================================================

-- ============================================================================
-- 1. Upgrade claim_enrichment_job with extra fields
-- ============================================================================

DROP FUNCTION IF EXISTS claim_enrichment_job();

CREATE OR REPLACE FUNCTION claim_enrichment_job()
RETURNS TABLE(
  job_id UUID,
  explore_item_id UUID,
  item_title TEXT,
  item_description TEXT,
  item_hook_line TEXT,
  item_category TEXT,
  item_schedule_text TEXT,
  item_time_text TEXT,
  item_recurrence TEXT,
  item_season TEXT,
  item_tags TEXT[],
  item_availability_json JSONB,
  item_price_bucket price_bucket,
  item_location_name TEXT,
  item_town TEXT,
  item_kind TEXT
) AS $$
DECLARE
  v_job_id UUID;
  v_explore_item_id UUID;
BEGIN
  -- Atomically claim the next queued job (highest priority first)
  UPDATE enrichment_queue
  SET status = 'running',
      started_at = NOW(),
      attempts = attempts + 1,
      updated_at = NOW()
  WHERE id = (
    SELECT id FROM enrichment_queue
    WHERE status = 'queued'
      AND attempts < max_attempts
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, enrichment_queue.explore_item_id INTO v_job_id, v_explore_item_id;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  -- Return job details with explore item data
  RETURN QUERY
  SELECT
    v_job_id,
    e.id,
    e.title,
    e.description,
    e.hook_line,
    e.category,
    e.schedule_text,
    e.time_text,
    e.recurrence,
    e.season,
    e.tags,
    e.availability_json,
    e.price_bucket,
    e.location_name,
    e.town,
    e.kind::TEXT
  FROM explore_items e
  WHERE e.id = v_explore_item_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION claim_enrichment_job() TO service_role;


-- ============================================================================
-- 2. Re-enrichment sweep: queue all items for re-enrichment
-- ============================================================================
-- Resets llm_enriched_at so items are treated as un-enriched.
-- Inserts new enrichment_queue jobs for items not already queued.
-- Returns the count of items queued.
-- ============================================================================

CREATE OR REPLACE FUNCTION queue_all_for_reenrichment(
  p_max_items INTEGER DEFAULT 1000
)
RETURNS TABLE(items_queued INTEGER) AS $$
DECLARE
  v_count INTEGER := 0;
  v_item RECORD;
BEGIN
  -- Find active items (not duplicate, not quarantined) that need re-enrichment
  FOR v_item IN
    SELECT e.id
    FROM explore_items e
    WHERE e.is_duplicate = FALSE
      AND (e.review_status IS NULL OR e.review_status != 'quarantined')
      -- Exclude items already in the queue
      AND NOT EXISTS (
        SELECT 1 FROM enrichment_queue eq
        WHERE eq.explore_item_id = e.id
          AND eq.status IN ('queued', 'running')
      )
    ORDER BY
      -- Prioritize items with fewest tags (they need enrichment most)
      COALESCE(array_length(e.tags, 1), 0) ASC,
      e.priority DESC
    LIMIT p_max_items
  LOOP
    -- Reset the enrichment timestamp so the worker doesn't skip it
    UPDATE explore_items
    SET llm_enriched_at = NULL,
        updated_at = NOW()
    WHERE id = v_item.id;

    -- Insert into enrichment queue
    INSERT INTO enrichment_queue (explore_item_id, priority, status, max_attempts)
    VALUES (v_item.id, 50, 'queued', 3)
    ON CONFLICT (explore_item_id) DO UPDATE
    SET status = 'queued',
        attempts = 0,
        priority = 50,
        started_at = NULL,
        completed_at = NULL,
        last_error = NULL,
        updated_at = NOW();

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION queue_all_for_reenrichment(INTEGER) TO service_role;

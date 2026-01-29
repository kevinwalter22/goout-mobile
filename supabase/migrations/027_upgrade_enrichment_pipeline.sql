-- ============================================================================
-- Upgrade Enrichment Pipeline
-- ============================================================================
-- Adds price_bucket inference to the enrichment system and updates
-- claim_enrichment_job to return availability/price data for skip-checking.
-- Re-queues all items for full re-enrichment with the upgraded prompt.
-- ============================================================================

-- ============================================================================
-- 1. Update apply_enrichment to accept price_bucket
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_enrichment(
  p_explore_item_id UUID,
  p_hook_line TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_recurrence TEXT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL,
  p_availability_json JSONB DEFAULT NULL,
  p_price_bucket price_bucket DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE explore_items
  SET
    hook_line = COALESCE(p_hook_line, hook_line),
    tags = COALESCE(p_tags, tags),
    recurrence = COALESCE(p_recurrence, recurrence),
    starts_at = COALESCE(p_starts_at, starts_at),
    ends_at = COALESCE(p_ends_at, ends_at),
    availability_json = COALESCE(p_availability_json, availability_json),
    price_bucket = COALESCE(p_price_bucket, price_bucket),
    llm_enriched_at = NOW(),
    updated_at = NOW()
  WHERE id = p_explore_item_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. Update claim_enrichment_job to return availability_json and price_bucket
--    Must DROP first because the return type (OUT parameters) is changing
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
  item_price_bucket price_bucket
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
    e.price_bucket
  FROM explore_items e
  WHERE e.id = v_explore_item_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. Re-queue all items for full re-enrichment
-- ============================================================================

-- Reset enrichment timestamp so all items get re-processed
UPDATE explore_items SET llm_enriched_at = NULL;

-- Reset existing queue entries
UPDATE enrichment_queue
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    started_at = NULL,
    completed_at = NULL,
    updated_at = NOW();

-- Add any items not yet in the queue
INSERT INTO enrichment_queue (explore_item_id, priority)
SELECT id, 10
FROM explore_items
WHERE id NOT IN (SELECT explore_item_id FROM enrichment_queue)
ON CONFLICT (explore_item_id) DO NOTHING;

-- ============================================================================
-- 4. Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, price_bucket) TO service_role;
GRANT EXECUTE ON FUNCTION claim_enrichment_job() TO service_role;

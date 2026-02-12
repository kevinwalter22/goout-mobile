-- ============================================================================
-- Enhanced Enrichment + Fuzzy Dedup (Wave 3, Phase 5)
-- ============================================================================
-- 1. Upgrades apply_enrichment() to also write description and time_text
-- 2. Upgrades claim_enrichment_job() to return time_text for skip-checking
-- 3. Enables pg_trgm and adds fuzzy dedup function
-- 4. Upgrades mark_duplicates() to include fuzzy matching
-- 5. Re-queues items needing enrichment (missing description or verbose schedule)
--
-- Rollback:
--   -- Restore apply_enrichment from migration 027
--   -- Restore claim_enrichment_job from migration 027
--   -- Restore mark_duplicates from migration 032
--   -- DROP FUNCTION IF EXISTS mark_fuzzy_duplicates();
-- ============================================================================

-- ============================================================================
-- 1. Upgrade apply_enrichment to accept description and time_text
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_enrichment(
  p_explore_item_id UUID,
  p_hook_line TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_recurrence TEXT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL,
  p_availability_json JSONB DEFAULT NULL,
  p_price_bucket price_bucket DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_time_text TEXT DEFAULT NULL
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
    -- Only set description if currently NULL (preserve existing descriptions)
    description = CASE
      WHEN description IS NULL THEN COALESCE(p_description, description)
      ELSE description
    END,
    time_text = COALESCE(p_time_text, time_text),
    llm_enriched_at = NOW(),
    updated_at = NOW()
  WHERE id = p_explore_item_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, price_bucket, TEXT, TEXT) TO service_role;

-- ============================================================================
-- 2. Upgrade claim_enrichment_job to also return time_text
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

GRANT EXECUTE ON FUNCTION claim_enrichment_job() TO service_role;

-- ============================================================================
-- 3. Enable pg_trgm extension for fuzzy text matching
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 4. Fuzzy dedup function
-- ============================================================================
-- Finds items within ~500m that have similar titles (similarity > 0.4).
-- For each fuzzy group, picks the canonical item and marks the rest.
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_fuzzy_duplicates()
RETURNS TABLE(pairs_found INTEGER, items_marked INTEGER) AS $$
DECLARE
  v_pairs INTEGER := 0;
  v_marked INTEGER := 0;
  v_pair RECORD;
  v_canonical_id UUID;
  v_duplicate_id UUID;
BEGIN
  -- Find fuzzy duplicate pairs: similar titles + close geo
  FOR v_pair IN
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      a.title AS title_a,
      b.title AS title_b,
      similarity(
        REGEXP_REPLACE(LOWER(a.title), '[^a-z0-9 ]', '', 'g'),
        REGEXP_REPLACE(LOWER(b.title), '[^a-z0-9 ]', '', 'g')
      ) AS title_sim,
      -- Pick canonical: highest confidence → priority → earliest
      CASE
        WHEN COALESCE(a.normalized_confidence, 0) > COALESCE(b.normalized_confidence, 0) THEN a.id
        WHEN COALESCE(a.normalized_confidence, 0) < COALESCE(b.normalized_confidence, 0) THEN b.id
        WHEN a.priority > b.priority THEN a.id
        WHEN a.priority < b.priority THEN b.id
        WHEN a.created_at <= b.created_at THEN a.id
        ELSE b.id
      END AS canonical_id
    FROM explore_items a
    JOIN explore_items b
      ON a.id < b.id  -- avoid duplicating pairs
      AND a.lat IS NOT NULL AND b.lat IS NOT NULL
      AND a.lng IS NOT NULL AND b.lng IS NOT NULL
      -- Geo proximity: ~500m (0.005 degrees ≈ 550m)
      AND ABS(a.lat - b.lat) < 0.005
      AND ABS(a.lng - b.lng) < 0.005
    WHERE
      a.priority >= 0
      AND b.priority >= 0
      AND NOT a.is_duplicate
      AND NOT b.is_duplicate
      -- Different dedupe_keys (exact dedup already handled these)
      AND (a.dedupe_key IS NULL OR b.dedupe_key IS NULL OR a.dedupe_key != b.dedupe_key)
      -- Only fuzzy-match when at least one item has no date (activity/place).
      -- Dated events at the same venue are distinct and handled by exact dedup.
      AND (a.starts_at IS NULL OR b.starts_at IS NULL)
      -- Title similarity threshold
      AND similarity(
        REGEXP_REPLACE(LOWER(a.title), '[^a-z0-9 ]', '', 'g'),
        REGEXP_REPLACE(LOWER(b.title), '[^a-z0-9 ]', '', 'g')
      ) > 0.4
  LOOP
    v_pairs := v_pairs + 1;

    -- Determine which is the duplicate
    IF v_pair.canonical_id = v_pair.id_a THEN
      v_duplicate_id := v_pair.id_b;
      v_canonical_id := v_pair.id_a;
    ELSE
      v_duplicate_id := v_pair.id_a;
      v_canonical_id := v_pair.id_b;
    END IF;

    -- Only mark if not already marked
    UPDATE explore_items
    SET is_duplicate = TRUE,
        canonical_item_id = v_canonical_id
    WHERE id = v_duplicate_id
      AND NOT is_duplicate;

    IF FOUND THEN
      v_marked := v_marked + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_pairs, v_marked;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION mark_fuzzy_duplicates() TO authenticated;

-- ============================================================================
-- 5. Upgrade mark_duplicates to also run fuzzy dedup
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_duplicates()
RETURNS TABLE(groups_found INTEGER, items_marked INTEGER) AS $$
DECLARE
  v_groups INTEGER := 0;
  v_marked INTEGER := 0;
  v_group RECORD;
  v_canonical_id UUID;
  v_fuzzy_result RECORD;
BEGIN
  -- Reset all duplicate flags first
  UPDATE explore_items SET is_duplicate = FALSE, canonical_item_id = NULL
  WHERE is_duplicate = TRUE;

  -- ── Phase 1: Exact dedup (by dedupe_key) ──
  FOR v_group IN
    SELECT dedupe_key, COUNT(*) AS cnt
    FROM explore_items
    WHERE dedupe_key IS NOT NULL
      AND dedupe_key != ''
      AND priority >= 0
    GROUP BY dedupe_key
    HAVING COUNT(*) > 1
  LOOP
    v_groups := v_groups + 1;

    SELECT id INTO v_canonical_id
    FROM explore_items
    WHERE dedupe_key = v_group.dedupe_key
      AND priority >= 0
    ORDER BY
      COALESCE(normalized_confidence, 0) DESC,
      priority DESC,
      created_at ASC
    LIMIT 1;

    UPDATE explore_items
    SET is_duplicate = TRUE, canonical_item_id = v_canonical_id
    WHERE dedupe_key = v_group.dedupe_key
      AND id != v_canonical_id
      AND priority >= 0;

    v_marked := v_marked + (v_group.cnt - 1);
  END LOOP;

  -- ── Phase 2: Fuzzy dedup (pg_trgm similarity + geo proximity) ──
  SELECT * INTO v_fuzzy_result FROM mark_fuzzy_duplicates();
  v_groups := v_groups + v_fuzzy_result.pairs_found;
  v_marked := v_marked + v_fuzzy_result.items_marked;

  RETURN QUERY SELECT v_groups, v_marked;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. Run dedup immediately
-- ============================================================================

SELECT * FROM mark_duplicates();

-- ============================================================================
-- 7. Re-queue items for enrichment (missing description or verbose schedule)
-- ============================================================================

-- Reset enrichment for items that need description or condensed schedule
UPDATE explore_items
SET llm_enriched_at = NULL
WHERE
  description IS NULL
  OR (schedule_text IS NOT NULL AND LENGTH(schedule_text) > 50 AND time_text IS NULL);

-- Reset existing queue entries for these items
UPDATE enrichment_queue
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    started_at = NULL,
    completed_at = NULL,
    updated_at = NOW()
WHERE explore_item_id IN (
  SELECT id FROM explore_items WHERE llm_enriched_at IS NULL
)
AND status != 'queued';

-- Add any items not yet in the queue
INSERT INTO enrichment_queue (explore_item_id, priority)
SELECT id, 10
FROM explore_items
WHERE llm_enriched_at IS NULL
  AND id NOT IN (SELECT explore_item_id FROM enrichment_queue)
ON CONFLICT (explore_item_id) DO NOTHING;

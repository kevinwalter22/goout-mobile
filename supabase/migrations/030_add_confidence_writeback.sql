-- ============================================================================
-- Confidence Score Write-back + Quality Gate
-- ============================================================================
-- 1. compute_item_confidence(id) — scores data completeness 0-100
-- 2. apply_enrichment() now also writes normalized_confidence
-- 3. filter_explore_items() gains p_min_confidence (default 40)
-- 4. Backfill confidence for all existing items
--
-- Formula:
--   100
--   - (no canonical category → 30)
--   - (price_bucket = 'unknown' → 20)
--   - (tags is empty → 20)
--   - (no availability_json → 15)
--   - (no lat/lng → 15)
--
-- Thresholds (enforced in RPC):
--   >= 70  → serve everywhere
--   40-69  → serve in main list
--   < 40   → hidden, queue for re-enrichment
--
-- Rollback:
--   UPDATE explore_items SET normalized_confidence = NULL;
--   -- then restore prior apply_enrichment() from migration 027
--   -- then restore prior filter RPCs from migration 029
-- ============================================================================

-- ============================================================================
-- 1. Confidence scoring function
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_item_confidence(p_item_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 100;
  v_item explore_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM explore_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- No canonical category
  IF v_item.category IS NULL OR v_item.category = '' THEN
    v_score := v_score - 30;
  END IF;

  -- Unknown price
  IF v_item.price_bucket IS NULL OR v_item.price_bucket::TEXT = 'unknown' THEN
    v_score := v_score - 20;
  END IF;

  -- No tags
  IF v_item.tags IS NULL OR array_length(v_item.tags, 1) IS NULL THEN
    v_score := v_score - 20;
  END IF;

  -- No availability_json
  IF v_item.availability_json IS NULL THEN
    v_score := v_score - 15;
  END IF;

  -- No lat/lng
  IF v_item.lat IS NULL OR v_item.lng IS NULL THEN
    v_score := v_score - 15;
  END IF;

  RETURN GREATEST(v_score, 0);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION compute_item_confidence(UUID) TO authenticated;

-- ============================================================================
-- 2. Update apply_enrichment() to also write confidence
-- ============================================================================

-- Must drop old signature first (same param types but changing body)
DROP FUNCTION IF EXISTS apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, price_bucket);

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

  -- Compute and write confidence score after enrichment update
  UPDATE explore_items
  SET normalized_confidence = compute_item_confidence(p_explore_item_id)
  WHERE id = p_explore_item_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, price_bucket) TO authenticated;

-- ============================================================================
-- 3. Backfill confidence for all existing items
-- ============================================================================

UPDATE explore_items
SET normalized_confidence = compute_item_confidence(id)
WHERE normalized_confidence IS NULL;

-- ============================================================================
-- 4. Recreate filter RPCs with quality gate
-- ============================================================================
-- Adds p_min_confidence INTEGER DEFAULT 40.
-- Items with NULL confidence pass through (backwards compatible).
-- ============================================================================

DROP FUNCTION IF EXISTS filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER, INTEGER);
DROP FUNCTION IF EXISTS count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION filter_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_min_confidence INTEGER DEFAULT 40,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS SETOF explore_items AS $$
BEGIN
  RETURN QUERY
  SELECT e.*
  FROM explore_items e
  WHERE
    -- Exclude demoted/stale items
    e.priority >= 0
    -- Quality gate: items with NULL confidence pass through (not yet scored)
    AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
    -- Date range filter (if provided)
    AND (p_range_start IS NULL OR p_range_end IS NULL OR
      is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
    -- Category filter (if provided)
    AND (p_categories IS NULL OR e.category = ANY(p_categories))
    -- Price bucket filter (if provided)
    AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
    -- Time of day filter (if provided)
    AND (p_time_of_day IS NULL OR
      is_available_at_time(e.availability_json, p_time_of_day))
    -- Tag filter: item must have at least one of the requested tags
    AND (p_tags IS NULL OR e.tags && p_tags)
  ORDER BY
    CASE WHEN e.starts_at IS NOT NULL THEN 0 ELSE 1 END,
    e.starts_at ASC NULLS LAST,
    e.priority DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION count_filtered_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_min_confidence INTEGER DEFAULT 40
)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM explore_items e
    WHERE
      e.priority >= 0
      AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
      AND (p_range_start IS NULL OR p_range_end IS NULL OR
        is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
      AND (p_categories IS NULL OR e.category = ANY(p_categories))
      AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
      AND (p_time_of_day IS NULL OR
        is_available_at_time(e.availability_json, p_time_of_day))
      AND (p_tags IS NULL OR e.tags && p_tags)
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Note: new signature has 9 params (filter) and 7 params (count) due to p_min_confidence
GRANT EXECUTE ON FUNCTION filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER) TO authenticated;

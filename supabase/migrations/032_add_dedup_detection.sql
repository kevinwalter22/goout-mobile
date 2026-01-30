-- ============================================================================
-- Cross-Source Dedup Detection
-- ============================================================================
-- Adds dedupe_key, is_duplicate, canonical_item_id columns and a function
-- to detect and mark duplicate explore_items across sources.
--
-- dedupe_key is deterministic: lower(title) stripped of punctuation +
-- date bucket (start date) + geo bucket (rounded lat/lng to 2 decimals).
--
-- mark_duplicates() groups by dedupe_key, picks the canonical item
-- (highest confidence, then highest priority, then earliest created_at),
-- and marks the rest as is_duplicate=true with canonical_item_id set.
--
-- filter_explore_items() updated to exclude is_duplicate=true.
--
-- Rollback:
--   ALTER TABLE explore_items DROP COLUMN IF EXISTS dedupe_key;
--   ALTER TABLE explore_items DROP COLUMN IF EXISTS is_duplicate;
--   ALTER TABLE explore_items DROP COLUMN IF EXISTS canonical_item_id;
--   -- then restore filter RPCs from migration 030
-- ============================================================================

-- ============================================================================
-- 1. Add columns
-- ============================================================================

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS canonical_item_id UUID REFERENCES explore_items(id);

CREATE INDEX IF NOT EXISTS idx_explore_items_dedupe_key
  ON explore_items (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_explore_items_is_duplicate
  ON explore_items (is_duplicate) WHERE is_duplicate = TRUE;

-- ============================================================================
-- 2. Compute dedupe_key for a single item
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_dedupe_key(
  p_title TEXT,
  p_starts_at TIMESTAMPTZ,
  p_lat FLOAT8,
  p_lng FLOAT8,
  p_location_name TEXT DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  v_norm_title TEXT;
  v_date_bucket TEXT;
  v_geo_bucket TEXT;
  v_venue TEXT;
BEGIN
  -- Normalize title: lowercase, strip punctuation, collapse whitespace
  v_norm_title := LOWER(COALESCE(p_title, ''));
  v_norm_title := REGEXP_REPLACE(v_norm_title, '[^a-z0-9 ]', '', 'g');
  v_norm_title := REGEXP_REPLACE(v_norm_title, '\s+', ' ', 'g');
  v_norm_title := TRIM(v_norm_title);

  -- Date bucket: just the date part (NULL if no date)
  IF p_starts_at IS NOT NULL THEN
    v_date_bucket := TO_CHAR(p_starts_at, 'YYYY-MM-DD');
  ELSE
    v_date_bucket := 'nodate';
  END IF;

  -- Geo bucket: round lat/lng to 2 decimal places (~1.1km precision)
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    v_geo_bucket := ROUND(p_lat::NUMERIC, 2)::TEXT || ',' || ROUND(p_lng::NUMERIC, 2)::TEXT;
  ELSE
    v_geo_bucket := 'nogeo';
  END IF;

  -- Optional venue component (first 20 chars, normalized)
  IF p_location_name IS NOT NULL AND LENGTH(p_location_name) > 0 THEN
    v_venue := LOWER(LEFT(p_location_name, 20));
    v_venue := REGEXP_REPLACE(v_venue, '[^a-z0-9]', '', 'g');
  ELSE
    v_venue := '';
  END IF;

  RETURN v_norm_title || '|' || v_date_bucket || '|' || v_geo_bucket
    || CASE WHEN v_venue != '' THEN '|' || v_venue ELSE '' END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 3. Backfill dedupe_key for existing items
-- ============================================================================

UPDATE explore_items
SET dedupe_key = compute_dedupe_key(title, starts_at, lat, lng, location_name)
WHERE dedupe_key IS NULL;

-- ============================================================================
-- 4. Mark duplicates function
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_duplicates()
RETURNS TABLE(groups_found INTEGER, items_marked INTEGER) AS $$
DECLARE
  v_groups INTEGER := 0;
  v_marked INTEGER := 0;
  v_group RECORD;
  v_canonical_id UUID;
BEGIN
  -- Reset all duplicate flags first
  UPDATE explore_items SET is_duplicate = FALSE, canonical_item_id = NULL
  WHERE is_duplicate = TRUE;

  -- Find groups with more than one item sharing the same dedupe_key
  FOR v_group IN
    SELECT dedupe_key, COUNT(*) AS cnt
    FROM explore_items
    WHERE dedupe_key IS NOT NULL
      AND dedupe_key != ''
      AND priority >= 0  -- skip stale items
    GROUP BY dedupe_key
    HAVING COUNT(*) > 1
  LOOP
    v_groups := v_groups + 1;

    -- Pick canonical: highest confidence → highest priority → earliest created
    SELECT id INTO v_canonical_id
    FROM explore_items
    WHERE dedupe_key = v_group.dedupe_key
      AND priority >= 0
    ORDER BY
      COALESCE(normalized_confidence, 0) DESC,
      priority DESC,
      created_at ASC
    LIMIT 1;

    -- Mark non-canonical items as duplicates
    UPDATE explore_items
    SET is_duplicate = TRUE, canonical_item_id = v_canonical_id
    WHERE dedupe_key = v_group.dedupe_key
      AND id != v_canonical_id
      AND priority >= 0;

    v_marked := v_marked + (v_group.cnt - 1);
  END LOOP;

  RETURN QUERY SELECT v_groups, v_marked;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION compute_dedupe_key(TEXT, TIMESTAMPTZ, FLOAT8, FLOAT8, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_duplicates() TO authenticated;

-- Run once immediately
SELECT * FROM mark_duplicates();

-- ============================================================================
-- 5. Update filter RPCs to exclude duplicates
-- ============================================================================
-- Adds AND NOT e.is_duplicate to both filter and count functions.
-- Preserves all existing parameters from migration 030 (including
-- p_min_confidence and priority >= 0).
-- ============================================================================

DROP FUNCTION IF EXISTS filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER);

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
    -- Exclude duplicates
    AND NOT e.is_duplicate
    -- Quality gate
    AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
    -- Date range filter
    AND (p_range_start IS NULL OR p_range_end IS NULL OR
      is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
    -- Category filter
    AND (p_categories IS NULL OR e.category = ANY(p_categories))
    -- Price bucket filter
    AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
    -- Time of day filter
    AND (p_time_of_day IS NULL OR
      is_available_at_time(e.availability_json, p_time_of_day))
    -- Tag filter
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
      AND NOT e.is_duplicate
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

GRANT EXECUTE ON FUNCTION filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER) TO authenticated;

-- ============================================================================
-- 6. Schedule daily dedup (optional pg_cron)
-- ============================================================================

DO $$
BEGIN
  PERFORM cron.schedule(
    'mark-duplicates',
    '30 4 * * *',
    'SELECT * FROM mark_duplicates()'
  );
  RAISE NOTICE 'pg_cron job scheduled: mark-duplicates (daily 04:30 UTC)';
EXCEPTION
  WHEN undefined_function OR invalid_schema_name THEN
    RAISE NOTICE 'pg_cron not available — run mark_duplicates() manually or via Edge Function';
END;
$$;

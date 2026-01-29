-- ============================================================================
-- Add Tag Filtering to Explore RPC
-- ============================================================================
-- Adds p_tags TEXT[] parameter to filter_explore_items() and
-- count_filtered_explore_items() using array overlap operator (&&).
-- GIN index on explore_items.tags already exists (migration 018).
-- ============================================================================

-- Must DROP old signature first because adding a parameter changes the signature
DROP FUNCTION IF EXISTS filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT);

-- Recreate filter function with p_tags parameter
CREATE OR REPLACE FUNCTION filter_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS SETOF explore_items AS $$
BEGIN
  RETURN QUERY
  SELECT e.*
  FROM explore_items e
  WHERE
    -- Date range filter (if provided)
    (p_range_start IS NULL OR p_range_end IS NULL OR
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

-- Recreate count function with p_tags parameter
CREATE OR REPLACE FUNCTION count_filtered_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL
)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM explore_items e
    WHERE
      (p_range_start IS NULL OR p_range_end IS NULL OR
        is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
      AND (p_categories IS NULL OR e.category = ANY(p_categories))
      AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
      AND (p_time_of_day IS NULL OR
        is_available_at_time(e.availability_json, p_time_of_day))
      AND (p_tags IS NULL OR e.tags && p_tags)
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions (new signatures)
GRANT EXECUTE ON FUNCTION filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[]) TO authenticated;

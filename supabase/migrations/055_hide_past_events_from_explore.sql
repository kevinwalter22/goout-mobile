-- ============================================================================
-- Hide past events from Explore queries
-- ============================================================================
-- Events that have ended are hidden from Explore but remain in the database
-- and are accessible via direct links (e.g., from posts).
--
-- Logic:
--   - Activities (starts_at IS NULL): always shown
--   - Events with ends_at: hidden when ends_at < NOW()
--   - Events without ends_at: hidden when starts_at < NOW() - 3 hours
--     (assumes 3-hour default duration, matching check-in grace window)
--
-- Rollback: restore filter RPCs from migration 034.
-- ============================================================================

CREATE OR REPLACE FUNCTION filter_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_min_confidence INTEGER DEFAULT 40,
  p_season TEXT DEFAULT NULL,
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
    -- Hide past events (3-hour grace window)
    AND (
      e.starts_at IS NULL                -- activities always shown
      OR e.ends_at >= NOW()              -- event with end time still going
      OR (e.ends_at IS NULL AND e.starts_at >= NOW() - INTERVAL '3 hours')
    )
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
    -- Season filter
    AND (p_season IS NULL OR
      is_available_in_season(e.availability_json, p_season))
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
  p_min_confidence INTEGER DEFAULT 40,
  p_season TEXT DEFAULT NULL
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
      -- Hide past events (3-hour grace window)
      AND (
        e.starts_at IS NULL
        OR e.ends_at >= NOW()
        OR (e.ends_at IS NULL AND e.starts_at >= NOW() - INTERVAL '3 hours')
      )
      AND (p_range_start IS NULL OR p_range_end IS NULL OR
        is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
      AND (p_categories IS NULL OR e.category = ANY(p_categories))
      AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
      AND (p_time_of_day IS NULL OR
        is_available_at_time(e.availability_json, p_time_of_day))
      AND (p_tags IS NULL OR e.tags && p_tags)
      AND (p_season IS NULL OR
        is_available_in_season(e.availability_json, p_season))
  );
END;
$$ LANGUAGE plpgsql STABLE;

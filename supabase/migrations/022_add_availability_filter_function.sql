-- ============================================================================
-- Availability Filter Function
-- ============================================================================
-- Creates an RPC function to filter explore_items based on availability.
-- Handles both events (with specific dates) and activities (with patterns).
-- ============================================================================

-- Function to check if an item is available within a date range
CREATE OR REPLACE FUNCTION is_item_available_in_range(
  p_availability JSONB,
  p_starts_at TIMESTAMPTZ,
  p_range_start DATE,
  p_range_end DATE
)
RETURNS BOOLEAN AS $$
DECLARE
  v_type TEXT;
  v_next_occurrence TIMESTAMPTZ;
  v_day TEXT;
  v_check_date DATE;
BEGIN
  -- If no availability data, fall back to starts_at check
  IF p_availability IS NULL THEN
    -- If no starts_at either, include the item (it's an activity without date info)
    IF p_starts_at IS NULL THEN
      RETURN TRUE;
    END IF;
    -- Check if starts_at falls within range
    RETURN p_starts_at::DATE BETWEEN p_range_start AND p_range_end;
  END IF;

  v_type := p_availability->>'type';

  -- For events, check next_occurrence
  IF v_type = 'event' THEN
    IF p_availability->>'next_occurrence' IS NOT NULL THEN
      v_next_occurrence := (p_availability->>'next_occurrence')::TIMESTAMPTZ;
      RETURN v_next_occurrence::DATE BETWEEN p_range_start AND p_range_end;
    END IF;
    -- Event without next_occurrence - fall back to starts_at
    IF p_starts_at IS NOT NULL THEN
      RETURN p_starts_at::DATE BETWEEN p_range_start AND p_range_end;
    END IF;
    RETURN FALSE;
  END IF;

  -- For activities, check if any day in the range matches available_days
  IF v_type = 'activity' THEN
    -- If no available_days specified, assume always available
    IF p_availability->'available_days' IS NULL THEN
      RETURN TRUE;
    END IF;

    -- If "daily" is in available_days, always available
    IF p_availability->'available_days' ? 'daily' THEN
      RETURN TRUE;
    END IF;

    -- Check each day in the range
    v_check_date := p_range_start;
    WHILE v_check_date <= p_range_end LOOP
      v_day := LOWER(TO_CHAR(v_check_date, 'Dy'));
      IF p_availability->'available_days' ? v_day THEN
        RETURN TRUE;
      END IF;
      v_check_date := v_check_date + INTERVAL '1 day';
    END LOOP;

    RETURN FALSE;
  END IF;

  -- Unknown type, include by default
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Main filter function that returns filtered explore_items
CREATE OR REPLACE FUNCTION filter_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
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
    AND (p_price_bucket IS NULL OR e.price_bucket = p_price_bucket)
    -- Time of day filter (if provided)
    AND (p_time_of_day IS NULL OR
      is_available_at_time(e.availability_json, p_time_of_day))
  ORDER BY
    -- Events with dates first, sorted by date
    CASE WHEN e.starts_at IS NOT NULL THEN 0 ELSE 1 END,
    e.starts_at ASC NULLS LAST,
    e.priority DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- Count function for pagination
CREATE OR REPLACE FUNCTION count_filtered_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL
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
      AND (p_price_bucket IS NULL OR e.price_bucket = p_price_bucket)
      AND (p_time_of_day IS NULL OR
        is_available_at_time(e.availability_json, p_time_of_day))
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION is_item_available_in_range(JSONB, TIMESTAMPTZ, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT) TO authenticated;

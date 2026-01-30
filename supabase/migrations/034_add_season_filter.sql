-- ============================================================================
-- Season Filtering + Availability Enforcement
-- ============================================================================
-- Adds p_season parameter to filter_explore_items and count RPCs.
-- When p_season is provided, items whose availability_json declares a
-- season restriction that doesn't include p_season are excluded.
--
-- Also adds validate_availability_json() for schema enforcement
-- during enrichment.
--
-- Rollback:
--   Restore filter RPCs from migration 032 (drop p_season param).
--   DROP FUNCTION IF EXISTS validate_availability_json(JSONB);
-- ============================================================================

-- ============================================================================
-- 1. Availability JSON schema validation
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_availability_json(p_avail JSONB)
RETURNS JSONB AS $$
DECLARE
  v_type TEXT;
  v_days JSONB;
  v_seasons JSONB;
  v_times JSONB;
  v_valid_days TEXT[] := ARRAY['mon','tue','wed','thu','fri','sat','sun','daily'];
  v_valid_seasons TEXT[] := ARRAY['spring','summer','fall','winter','year_round'];
  v_valid_times TEXT[] := ARRAY['morning','afternoon','evening','anytime'];
  v_valid_types TEXT[] := ARRAY['event','activity'];
  v_day TEXT;
  v_season TEXT;
BEGIN
  IF p_avail IS NULL THEN
    RETURN NULL;
  END IF;

  -- Validate type
  v_type := p_avail->>'type';
  IF v_type IS NOT NULL AND NOT (v_type = ANY(v_valid_types)) THEN
    RAISE WARNING 'Invalid availability type: %. Must be event or activity.', v_type;
    -- Fix: default to activity
    p_avail := jsonb_set(p_avail, '{type}', '"activity"');
  END IF;

  -- Validate available_days
  v_days := p_avail->'available_days';
  IF v_days IS NOT NULL AND jsonb_typeof(v_days) = 'array' THEN
    FOR v_day IN SELECT jsonb_array_elements_text(v_days)
    LOOP
      IF NOT (LOWER(v_day) = ANY(v_valid_days)) THEN
        RAISE WARNING 'Invalid day in available_days: %', v_day;
      END IF;
    END LOOP;
  END IF;

  -- Validate available_seasons
  v_seasons := p_avail->'available_seasons';
  IF v_seasons IS NOT NULL AND jsonb_typeof(v_seasons) = 'array' THEN
    FOR v_season IN SELECT jsonb_array_elements_text(v_seasons)
    LOOP
      IF NOT (LOWER(v_season) = ANY(v_valid_seasons)) THEN
        RAISE WARNING 'Invalid season in available_seasons: %', v_season;
      END IF;
    END LOOP;
  END IF;

  -- Validate best_time_of_day
  IF p_avail->>'best_time_of_day' IS NOT NULL THEN
    IF NOT (LOWER(p_avail->>'best_time_of_day') = ANY(v_valid_times)) THEN
      RAISE WARNING 'Invalid best_time_of_day: %', p_avail->>'best_time_of_day';
    END IF;
  END IF;

  -- Validate confidence (0-100)
  IF (p_avail->>'confidence') IS NOT NULL THEN
    IF (p_avail->>'confidence')::INTEGER < 0 OR (p_avail->>'confidence')::INTEGER > 100 THEN
      RAISE WARNING 'Invalid confidence in availability_json: %', p_avail->>'confidence';
      p_avail := jsonb_set(p_avail, '{confidence}', '50');
    END IF;
  END IF;

  RETURN p_avail;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

GRANT EXECUTE ON FUNCTION validate_availability_json(JSONB) TO authenticated;

-- ============================================================================
-- 2. Upgrade filter RPCs to include p_season
-- ============================================================================
-- Must drop old signatures first (different param count).

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
    -- Season filter: exclude items whose availability declares seasons
    -- that don't include the requested season.
    -- Items with no availability or no season restriction are always included.
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

GRANT EXECUTE ON FUNCTION filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER, TEXT) TO authenticated;

-- ============================================================================
-- 3. Update apply_enrichment to validate availability_json
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_enrichment(
  p_explore_item_id UUID,
  p_hook_line TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_recurrence TEXT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL,
  p_availability_json JSONB DEFAULT NULL
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
    availability_json = COALESCE(validate_availability_json(p_availability_json), availability_json),
    llm_enriched_at = NOW(),
    updated_at = NOW()
  WHERE id = p_explore_item_id;
END;
$$ LANGUAGE plpgsql;

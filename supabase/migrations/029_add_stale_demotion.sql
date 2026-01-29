-- ============================================================================
-- Stale Event Demotion
-- ============================================================================
-- Creates demote_stale_items() that sets priority = -1 for events whose
-- starts_at is more than 1 day in the past.  Activities are unaffected.
--
-- Intended to run daily via pg_cron (see bottom).  If pg_cron is not
-- enabled on the project, the function can be called manually or from
-- an Edge Function on a schedule.
--
-- Rollback:
--   UPDATE explore_items SET priority = 0 WHERE priority = -1;
--   DROP FUNCTION IF EXISTS demote_stale_items();
--   SELECT cron.unschedule('demote-stale-items');   -- if pg_cron was used
-- ============================================================================

CREATE OR REPLACE FUNCTION demote_stale_items()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE explore_items
  SET
    priority = -1,
    updated_at = NOW()
  WHERE
    kind = 'event'
    AND starts_at < NOW() - INTERVAL '1 day'
    AND priority >= 0;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'demote_stale_items: demoted % events', affected;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

-- Grant execute to authenticated (for manual trigger from client/Edge Function)
GRANT EXECUTE ON FUNCTION demote_stale_items() TO authenticated;

-- Run once immediately to clean up any existing stale events
SELECT demote_stale_items();

-- ============================================================================
-- Exclude demoted items from explore queries
-- ============================================================================
-- Recreate filter_explore_items and count_filtered_explore_items with
-- an additional WHERE clause: e.priority >= 0.  This ensures stale events
-- (priority = -1) never appear in explore results.
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
  p_tags TEXT[] DEFAULT NULL
)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM explore_items e
    WHERE
      e.priority >= 0
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

GRANT EXECUTE ON FUNCTION filter_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[], INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION count_filtered_explore_items(DATE, DATE, TEXT[], TEXT, TEXT, TEXT[]) TO authenticated;

-- ============================================================================
-- pg_cron schedule (daily at 04:00 UTC)
-- ============================================================================
-- pg_cron is available on Supabase Pro plans.  If not enabled, this will
-- raise a notice and skip.  The function can still be invoked from an
-- Edge Function cron or manually.
-- ============================================================================
DO $$
BEGIN
  PERFORM cron.schedule(
    'demote-stale-items',
    '0 4 * * *',
    'SELECT demote_stale_items()'
  );
  RAISE NOTICE 'pg_cron job scheduled: demote-stale-items (daily 04:00 UTC)';
EXCEPTION
  WHEN undefined_function OR invalid_schema_name THEN
    RAISE NOTICE 'pg_cron not available — schedule demote_stale_items() via Edge Function cron or manually';
END;
$$;

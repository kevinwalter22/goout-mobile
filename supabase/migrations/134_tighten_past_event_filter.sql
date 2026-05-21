-- ============================================================================
-- Tighten past-event filter (134)
-- ============================================================================
-- Trigger: "Looking for the perfect prom fit?" (Potsdam Chamber, starts_at =
-- 2026-04-20, ends_at = 2026-06-02) leaked into the Warwick feed despite the
-- existing past-event filter in filter_explore_items.
--
-- Root cause: the prior filter trusted ends_at to indicate "event still going."
-- The Potsdam Chamber's JSON-LD emits a 43-day endDate that is the listing
-- expiry, not the actual event end. This is not unique to that source — JSON-LD
-- across community calendars commonly conflates "listing valid until" with
-- "event ends." Trusting ends_at is structurally unsafe.
--
-- New rule:
--   starts_at IS NULL           → show (activity, evergreen)
--   starts_at >= NOW() - 3h     → show (future event, or just-started w/ grace)
--   otherwise                   → hide
--
-- Tradeoff: multi-day festivals vanish from the upcoming feed after day-1's
-- 3-hour grace window. Acceptable — those are <1% of the catalog and the
-- correctness benefit (no past events leak) outweighs the regression. If
-- multi-day festivals become a real pain point, add a duration-bounded
-- `ends_at` check (e.g., ends_at - starts_at <= INTERVAL '7 days').
--
-- Rollback: re-create the prior CASE from migration 096.
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
    e.deleted_at IS NULL
    AND NOT e.is_admin_suppressed
    AND e.priority >= 0
    AND NOT e.is_duplicate
    AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
    AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved') OR e.created_by_user_id = auth.uid())
    -- Past-event filter — trust starts_at only; ignore ends_at because some
    -- sources emit listing-expiry dates that masquerade as event-end dates.
    AND (
      e.starts_at IS NULL
      OR e.starts_at >= NOW() - INTERVAL '3 hours'
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
      e.deleted_at IS NULL
      AND NOT e.is_admin_suppressed
      AND e.priority >= 0
      AND NOT e.is_duplicate
      AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
      AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved') OR e.created_by_user_id = auth.uid())
      AND (
        e.starts_at IS NULL
        OR e.starts_at >= NOW() - INTERVAL '3 hours'
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

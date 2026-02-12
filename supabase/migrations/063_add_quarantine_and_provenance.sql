-- ============================================================================
-- Quarantine + Provenance + Quality Gates (Wave 5 Phase B)
-- ============================================================================
-- Adds review_status enum to explore_items so low-confidence web-collected
-- items are quarantined for admin review instead of going live immediately.
-- Also adds provenance JSONB for full extraction audit trail.
--
-- Rollback:
--   ALTER TABLE explore_items DROP COLUMN IF EXISTS review_status,
--     DROP COLUMN IF EXISTS provenance,
--     DROP COLUMN IF EXISTS reviewed_by,
--     DROP COLUMN IF EXISTS reviewed_at;
--   DROP TYPE IF EXISTS review_status;
-- ============================================================================

-- ============================================================================
-- 1. Review status enum
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE review_status AS ENUM (
    'auto_approved',   -- Passed all quality gates automatically
    'quarantined',     -- Low confidence or missing required fields
    'approved',        -- Manually approved by admin
    'rejected'         -- Manually rejected by admin
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. New columns on explore_items
-- ============================================================================

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS review_status review_status DEFAULT 'auto_approved',
  ADD COLUMN IF NOT EXISTS provenance JSONB,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Partial index for admin review queue (quarantined items only)
CREATE INDEX IF NOT EXISTS idx_explore_items_quarantine_queue
  ON explore_items (review_status, created_at DESC)
  WHERE review_status = 'quarantined';

-- ============================================================================
-- 3. Update filter_explore_items to exclude quarantined/rejected items
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
    -- Review status gate (exclude quarantined/rejected)
    AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved'))
    -- Hide past events (3-hour grace window)
    AND (
      e.starts_at IS NULL
      OR e.ends_at >= NOW()
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
      AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved'))
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

-- ============================================================================
-- 4. Feature flag for AI description cleaning
-- ============================================================================

INSERT INTO feature_flags (id, flag_name, is_enabled, config_json)
VALUES (
  gen_random_uuid(),
  'ai_description_cleaning',
  false,
  '{"max_tokens_per_item": 200, "daily_budget_tokens": 50000}'::JSONB
)
ON CONFLICT (flag_name) DO NOTHING;

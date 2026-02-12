-- ============================================================================
-- Availability JSON for Smart Filtering
-- ============================================================================
-- Adds structured availability data extracted by AI enrichment.
-- Enables intelligent filtering for both events (specific dates) and
-- activities (availability patterns like "Daily, Year-round").
-- ============================================================================

-- Add availability_json column to explore_items
ALTER TABLE explore_items ADD COLUMN IF NOT EXISTS availability_json JSONB;

-- Add index for availability queries (GIN for JSONB containment queries)
CREATE INDEX IF NOT EXISTS idx_explore_items_availability
ON explore_items USING GIN(availability_json);

-- Add index for availability type queries
CREATE INDEX IF NOT EXISTS idx_explore_items_availability_type
ON explore_items((availability_json->>'type'));

-- ============================================================================
-- Availability Schema (stored in availability_json)
-- ============================================================================
-- {
--   "type": "event" | "activity",
--
--   // For activities - when is it available?
--   "available_days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] | ["daily"],
--   "available_times": {
--     "start": "09:00",   // 24hr format
--     "end": "17:00"
--   } | "anytime" | "daylight",
--   "available_seasons": ["spring", "summer", "fall", "winter"] | ["year_round"],
--
--   // For events - when does it happen?
--   "next_occurrence": "2026-02-15T19:00:00Z",  // ISO 8601
--   "recurrence": "none" | "daily" | "weekly" | "monthly" | "annual",
--
--   // Common fields
--   "typical_duration": "2-3 hours" | "full day" | "multi-day",
--   "best_time_of_day": "morning" | "afternoon" | "evening" | "anytime",
--
--   // Quality
--   "confidence": 85,  // 0-100
--   "source": "ai_enrichment" | "manual" | "api"
-- }
-- ============================================================================

-- ============================================================================
-- Helper Functions for Availability Queries
-- ============================================================================

-- Check if an activity is available on a specific day of week
CREATE OR REPLACE FUNCTION is_available_on_day(
  p_availability JSONB,
  p_day TEXT  -- 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'
)
RETURNS BOOLEAN AS $$
BEGIN
  -- If no availability data, assume available
  IF p_availability IS NULL THEN
    RETURN TRUE;
  END IF;

  -- If it's an event, check next_occurrence
  IF p_availability->>'type' = 'event' THEN
    IF p_availability->>'next_occurrence' IS NOT NULL THEN
      RETURN LOWER(TO_CHAR((p_availability->>'next_occurrence')::TIMESTAMPTZ, 'Dy')) = p_day;
    END IF;
    RETURN FALSE;
  END IF;

  -- For activities, check available_days
  IF p_availability->'available_days' IS NULL THEN
    RETURN TRUE;  -- No restrictions = available
  END IF;

  -- Check if daily or specific day
  RETURN p_availability->'available_days' ? 'daily'
      OR p_availability->'available_days' ? p_day;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Check if an activity is available in a specific season
CREATE OR REPLACE FUNCTION is_available_in_season(
  p_availability JSONB,
  p_season TEXT  -- 'spring', 'summer', 'fall', 'winter'
)
RETURNS BOOLEAN AS $$
BEGIN
  -- If no availability data, assume available
  IF p_availability IS NULL THEN
    RETURN TRUE;
  END IF;

  -- If no season restriction, available year-round
  IF p_availability->'available_seasons' IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Check if year_round or specific season
  RETURN p_availability->'available_seasons' ? 'year_round'
      OR p_availability->'available_seasons' ? p_season;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Check if an activity is available at a specific time of day
CREATE OR REPLACE FUNCTION is_available_at_time(
  p_availability JSONB,
  p_time_of_day TEXT  -- 'morning', 'afternoon', 'evening'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_times JSONB;
  v_start_hour INTEGER;
  v_end_hour INTEGER;
BEGIN
  -- If no availability data, assume available
  IF p_availability IS NULL THEN
    RETURN TRUE;
  END IF;

  v_times := p_availability->'available_times';

  -- If no time restriction or "anytime", available
  IF v_times IS NULL OR v_times = '"anytime"' THEN
    RETURN TRUE;
  END IF;

  -- Daylight means morning + afternoon
  IF v_times = '"daylight"' THEN
    RETURN p_time_of_day IN ('morning', 'afternoon');
  END IF;

  -- Parse structured time
  IF v_times->>'start' IS NOT NULL THEN
    v_start_hour := SUBSTRING(v_times->>'start' FROM 1 FOR 2)::INTEGER;
    v_end_hour := SUBSTRING(v_times->>'end' FROM 1 FOR 2)::INTEGER;

    -- Morning: 5-12, Afternoon: 12-17, Evening: 17-24
    IF p_time_of_day = 'morning' THEN
      RETURN v_start_hour < 12;
    ELSIF p_time_of_day = 'afternoon' THEN
      RETURN v_start_hour < 17 AND v_end_hour > 12;
    ELSIF p_time_of_day = 'evening' THEN
      RETURN v_end_hour > 17;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Get current season based on month
CREATE OR REPLACE FUNCTION get_current_season()
RETURNS TEXT AS $$
DECLARE
  v_month INTEGER;
BEGIN
  v_month := EXTRACT(MONTH FROM NOW());

  IF v_month IN (3, 4, 5) THEN
    RETURN 'spring';
  ELSIF v_month IN (6, 7, 8) THEN
    RETURN 'summer';
  ELSIF v_month IN (9, 10, 11) THEN
    RETURN 'fall';
  ELSE
    RETURN 'winter';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get day of week abbreviation
CREATE OR REPLACE FUNCTION get_day_abbrev(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT AS $$
BEGIN
  RETURN LOWER(TO_CHAR(p_date, 'Dy'));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- Update apply_enrichment to include availability_json
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
    availability_json = COALESCE(p_availability_json, availability_json),
    llm_enriched_at = NOW(),
    updated_at = NOW()
  WHERE id = p_explore_item_id;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION is_available_on_day(JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_available_in_season(JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_available_at_time(JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_season() TO authenticated;
GRANT EXECUTE ON FUNCTION get_day_abbrev(DATE) TO authenticated;

-- ============================================================================
-- Mark all items for re-enrichment with new schema
-- ============================================================================

-- Reset enrichment status so items get re-processed with new availability schema
UPDATE explore_items
SET llm_enriched_at = NULL
WHERE availability_json IS NULL;

-- Re-queue items for enrichment
INSERT INTO enrichment_queue (explore_item_id, priority)
SELECT id, 10  -- High priority for re-enrichment
FROM explore_items
WHERE availability_json IS NULL
ON CONFLICT (explore_item_id) DO UPDATE
SET
  priority = GREATEST(enrichment_queue.priority, 10),
  status = CASE
    WHEN enrichment_queue.status IN ('done', 'failed') THEN 'queued'::job_status
    ELSE enrichment_queue.status
  END,
  updated_at = NOW();

-- ============================================================================
-- Fix: Date filter must prioritize starts_at over availability_json
-- ============================================================================
-- Problem: LLM enrichment can set availability_json with type "activity" and
-- daily availability on events that have concrete starts_at dates (e.g.,
-- Clarkson hockey games). This causes those events to match ALL date filters
-- (Today, Tonight, etc.) regardless of their actual date.
--
-- Fix: When starts_at is not null, ALWAYS use it for date filtering.
-- Only fall back to availability_json day-of-week logic for items that
-- genuinely have no starts_at (true activities).
-- ============================================================================

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
  -- PRIORITY RULE: If starts_at exists, always use it for date matching.
  -- This prevents enrichment errors from showing events on wrong dates.
  IF p_starts_at IS NOT NULL THEN
    RETURN p_starts_at::DATE BETWEEN p_range_start AND p_range_end;
  END IF;

  -- No starts_at — use availability_json if available
  IF p_availability IS NULL THEN
    -- No date info at all — include the item (undated activity)
    RETURN TRUE;
  END IF;

  v_type := p_availability->>'type';

  -- For enriched events with next_occurrence but no starts_at
  IF v_type = 'event' THEN
    IF p_availability->>'next_occurrence' IS NOT NULL THEN
      v_next_occurrence := (p_availability->>'next_occurrence')::TIMESTAMPTZ;
      RETURN v_next_occurrence::DATE BETWEEN p_range_start AND p_range_end;
    END IF;
    -- Event without any date info
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

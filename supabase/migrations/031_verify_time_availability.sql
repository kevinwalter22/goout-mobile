-- ============================================================================
-- Verify is_available_at_time() helper
-- ============================================================================
-- Ensures the function from migration 021 exists and works correctly.
-- Uses CREATE OR REPLACE so this is safe to re-run even if function exists.
--
-- The filter RPC calls is_available_at_time() when p_time_of_day is non-null.
-- Currently dormant (client always passes NULL), but this ensures it will
-- work correctly when time-of-day filtering is activated.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS is_available_at_time(JSONB, TEXT);
-- ============================================================================

-- Re-declare the function (idempotent — CREATE OR REPLACE)
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

    -- Morning: before noon start, Afternoon: starts before 5pm + ends after noon,
    -- Evening: ends after 5pm
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

GRANT EXECUTE ON FUNCTION is_available_at_time(JSONB, TEXT) TO authenticated;

-- ============================================================================
-- Verification tests (DO block — runs at migration time)
-- ============================================================================

DO $$
DECLARE
  v_result BOOLEAN;
  v_tests_passed INTEGER := 0;
  v_tests_total INTEGER := 0;
BEGIN
  -- Test 1: NULL availability → TRUE
  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time(NULL, 'morning') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 1: NULL availability should return TRUE'; END IF;

  -- Test 2: "anytime" → TRUE for any time
  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": "anytime"}'::jsonb, 'morning') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 2: anytime should return TRUE for morning'; END IF;

  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": "anytime"}'::jsonb, 'evening') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 3: anytime should return TRUE for evening'; END IF;

  -- Test 4: "daylight" → TRUE for morning, FALSE for evening
  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": "daylight"}'::jsonb, 'morning') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 4: daylight should return TRUE for morning'; END IF;

  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": "daylight"}'::jsonb, 'afternoon') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 5: daylight should return TRUE for afternoon'; END IF;

  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": "daylight"}'::jsonb, 'evening') INTO v_result;
  IF v_result = FALSE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 6: daylight should return FALSE for evening'; END IF;

  -- Test 7: Structured times 09:00-17:00 → morning TRUE, afternoon TRUE, evening FALSE
  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": {"start": "09:00", "end": "17:00"}}'::jsonb, 'morning') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 7: 09:00-17:00 should return TRUE for morning'; END IF;

  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": {"start": "09:00", "end": "17:00"}}'::jsonb, 'afternoon') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 8: 09:00-17:00 should return TRUE for afternoon'; END IF;

  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": {"start": "09:00", "end": "17:00"}}'::jsonb, 'evening') INTO v_result;
  IF v_result = FALSE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 9: 09:00-17:00 should return FALSE for evening'; END IF;

  -- Test 10: Evening hours 19:00-23:00 → morning FALSE, evening TRUE
  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": {"start": "19:00", "end": "23:00"}}'::jsonb, 'morning') INTO v_result;
  IF v_result = FALSE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 10: 19:00-23:00 should return FALSE for morning'; END IF;

  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"available_times": {"start": "19:00", "end": "23:00"}}'::jsonb, 'evening') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 11: 19:00-23:00 should return TRUE for evening'; END IF;

  -- Test 12: No available_times key in JSONB → TRUE (no restriction)
  v_tests_total := v_tests_total + 1;
  SELECT is_available_at_time('{"type": "activity"}'::jsonb, 'evening') INTO v_result;
  IF v_result = TRUE THEN v_tests_passed := v_tests_passed + 1;
  ELSE RAISE WARNING 'FAIL test 12: missing available_times should return TRUE'; END IF;

  RAISE NOTICE 'is_available_at_time verification: %/% tests passed', v_tests_passed, v_tests_total;

  IF v_tests_passed < v_tests_total THEN
    RAISE EXCEPTION 'is_available_at_time verification FAILED: %/% tests passed', v_tests_passed, v_tests_total;
  END IF;
END;
$$;

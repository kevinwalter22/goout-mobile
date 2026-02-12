-- Fix streak calculation to use user's local date instead of server timezone
-- The issue: p_post_date::DATE uses the server timezone, causing streak miscalculations
-- when posts span midnight in the user's timezone but not in UTC

DROP FUNCTION IF EXISTS public.update_user_progression(UUID, INTEGER, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.update_user_progression(
  p_user_id UUID,
  p_xp_amount INTEGER,
  p_post_date TIMESTAMPTZ
)
RETURNS TABLE(new_xp INTEGER, new_streak INTEGER) AS $$
DECLARE
  v_current_xp INTEGER;
  v_current_streak INTEGER;
  v_last_post_date DATE;
  v_post_date DATE;
  v_new_xp INTEGER;
  v_new_streak INTEGER;
  v_days_diff INTEGER;
BEGIN
  -- Convert timestamp to date in America/New_York timezone (EST/EDT)
  -- This ensures streak tracking aligns with user's local day boundaries
  v_post_date := (p_post_date AT TIME ZONE 'America/New_York')::DATE;

  -- Get current profile data
  SELECT xp, streak, last_post_date
  INTO v_current_xp, v_current_streak, v_last_post_date
  FROM profiles
  WHERE id = p_user_id;

  -- Calculate new XP (always add)
  v_new_xp := v_current_xp + p_xp_amount;

  -- Calculate new streak
  IF v_last_post_date IS NULL THEN
    -- First post ever
    v_new_streak := 1;
  ELSE
    -- Calculate days difference
    v_days_diff := v_post_date - v_last_post_date;

    IF v_days_diff = 0 THEN
      -- Same day - no streak change
      v_new_streak := v_current_streak;
    ELSIF v_days_diff = 1 THEN
      -- Consecutive day - increment streak
      v_new_streak := v_current_streak + 1;
    ELSE
      -- Missed one or more days - reset streak to 1
      v_new_streak := 1;
    END IF;
  END IF;

  -- Update profile with new values
  UPDATE profiles
  SET
    xp = v_new_xp,
    streak = v_new_streak,
    last_post_date = v_post_date
  WHERE id = p_user_id;

  -- Return new values
  RETURN QUERY SELECT v_new_xp, v_new_streak;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.update_user_progression(UUID, INTEGER, TIMESTAMPTZ) TO authenticated;

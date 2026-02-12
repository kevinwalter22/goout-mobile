-- Add last_post_date to profiles to track daily posting
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_post_date DATE;

-- Create RPC function to update XP and streak after posting
-- This ensures server-side consistency and avoids client-side race conditions
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
  -- Convert timestamp to date (timezone-aware)
  v_post_date := p_post_date::DATE;

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

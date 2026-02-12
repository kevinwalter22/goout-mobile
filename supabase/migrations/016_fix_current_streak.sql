-- One-time fix to correct streak for users who posted on consecutive days
-- but had their streak stuck at 1 due to timezone bug

-- This will identify users who:
-- 1. Have streak = 1
-- 2. Have posts on consecutive calendar days (in America/New_York timezone)
-- And update their streak to the correct value

DO $$
DECLARE
  v_user_id UUID;
  v_correct_streak INTEGER;
  v_last_post_date DATE;
BEGIN
  -- For each user with posts
  FOR v_user_id IN
    SELECT DISTINCT user_id FROM posts
  LOOP
    -- Count consecutive days from most recent post backward
    WITH post_dates AS (
      SELECT DISTINCT (created_at AT TIME ZONE 'America/New_York')::DATE as post_date
      FROM posts
      WHERE user_id = v_user_id
      ORDER BY post_date DESC
    ),
    streak_calc AS (
      SELECT
        post_date,
        post_date - LAG(post_date) OVER (ORDER BY post_date DESC) as days_diff,
        ROW_NUMBER() OVER (ORDER BY post_date DESC) as rn
      FROM post_dates
    ),
    consecutive_days AS (
      SELECT COUNT(*) as streak_count
      FROM streak_calc
      WHERE rn = 1 OR days_diff = -1 OR days_diff IS NULL
    )
    SELECT streak_count, (SELECT post_date FROM post_dates LIMIT 1)
    INTO v_correct_streak, v_last_post_date
    FROM consecutive_days;

    -- Update the user's profile with correct streak
    UPDATE profiles
    SET
      streak = v_correct_streak,
      last_post_date = v_last_post_date
    WHERE id = v_user_id;

  END LOOP;
END $$;

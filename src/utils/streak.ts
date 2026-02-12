/**
 * Calculate the effective streak for display.
 *
 * A streak is consecutive calendar days with at least one qualifying post.
 * If the user has not posted today or yesterday, their streak is broken and should show 0.
 *
 * This matches the server-side logic in migration 015_fix_streak_timezone.sql
 * which uses America/New_York timezone.
 */

/**
 * Get today's date in America/New_York timezone as YYYY-MM-DD
 */
function getTodayInTimezone(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/**
 * Get yesterday's date in America/New_York timezone as YYYY-MM-DD
 */
function getYesterdayInTimezone(): string {
  const now = new Date();
  // Subtract 24 hours
  now.setTime(now.getTime() - 24 * 60 * 60 * 1000);
  return now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/**
 * Calculate the effective streak for display.
 *
 * @param lastPostDate - The user's last_post_date from the database (YYYY-MM-DD or null)
 * @param storedStreak - The user's streak value from the database
 * @returns The effective streak to display (0 if streak is broken)
 */
export function getEffectiveStreak(
  lastPostDate: string | null,
  storedStreak: number,
): number {
  // No posts ever = no streak
  if (!lastPostDate) {
    return 0;
  }

  const today = getTodayInTimezone();
  const yesterday = getYesterdayInTimezone();

  // If last post was today or yesterday, streak is still active
  if (lastPostDate === today || lastPostDate === yesterday) {
    return storedStreak;
  }

  // Last post was before yesterday = streak is broken
  return 0;
}

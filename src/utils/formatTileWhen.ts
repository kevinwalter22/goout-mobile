/**
 * formatTileWhen — short time label for an event tile, scaled by distance:
 * the further out an event, the more ABSOLUTE its label.
 *   - now/today/tomorrow → relative words ("Happening now", "Tonight", "Tomorrow", "In 90m")
 *   - this week/weekend   → day + time ("Thu 7pm")
 *   - beyond a week ("Later") → absolute date ("Aug 27, 7pm") so a bare weekday
 *     can't be ambiguous ("which Thursday?").
 * Activities (and events with no starts_at) get no label.
 */

const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_ABBREV = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type TileWhenItem = {
  kind: "event" | "activity";
  starts_at: string | null;
  ends_at: string | null;
};

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatClockTime(d: Date): string {
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const period = hours >= 12 ? "pm" : "am";
  const h12 = hours % 12 || 12;
  return minutes === 0 ? `${h12}${period}` : `${h12}:${String(minutes).padStart(2, "0")}${period}`;
}

export function formatTileWhen(item: TileWhenItem, now: Date = new Date()): string | null {
  if (item.kind !== "event") return null;
  if (!item.starts_at) return null;

  const startsAt = new Date(item.starts_at);
  if (isNaN(startsAt.getTime())) return null;

  // Date-only events — the source gave a date but no time, so the parser defaulted to
  // local midnight. Treat as ALL-DAY: show the day/date, never a misleading "12am", and
  // don't let it vanish a few hours after midnight.
  const dateOnly = startsAt.getHours() === 0 && startsAt.getMinutes() === 0;

  const endsAt = item.ends_at
    ? new Date(item.ends_at)
    : dateOnly
      ? new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate(), 23, 59, 59)
      : new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);

  if (dateOnly) {
    if (now > endsAt) return null; // day already over
    if (isSameCalendarDay(startsAt, now)) return "Today";
    const tomorrowDay = new Date(now);
    tomorrowDay.setDate(tomorrowDay.getDate() + 1);
    if (isSameCalendarDay(startsAt, tomorrowDay)) return "Tomorrow";
    const weekOutDay = new Date(now);
    weekOutDay.setDate(weekOutDay.getDate() + 7);
    if (startsAt > weekOutDay) return `${MONTH_ABBREV[startsAt.getMonth()]} ${startsAt.getDate()}`;
    return DAY_ABBREV[startsAt.getDay()];
  }

  if (now >= startsAt && now <= endsAt) return "Happening now";
  if (now > endsAt) return null; // already over

  const diffMin = (startsAt.getTime() - now.getTime()) / 60000;

  // Starting imminently — precise minute count is more useful than "Tonight"
  if (diffMin <= 180) {
    return `In ${Math.max(1, Math.round(diffMin))}m`;
  }

  if (isSameCalendarDay(startsAt, now)) {
    return startsAt.getHours() >= 17 ? "Tonight" : `Today ${formatClockTime(startsAt)}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameCalendarDay(startsAt, tomorrow)) return "Tomorrow";

  // Beyond a week out (the "Later" window) a bare weekday is ambiguous — give the
  // absolute date. Boundary matches the windowing's This Week ≤ 7 days.
  const weekOut = new Date(now);
  weekOut.setDate(weekOut.getDate() + 7);
  if (startsAt > weekOut) {
    return `${MONTH_ABBREV[startsAt.getMonth()]} ${startsAt.getDate()}, ${formatClockTime(startsAt)}`;
  }

  return `${DAY_ABBREV[startsAt.getDay()]} ${formatClockTime(startsAt)}`;
}

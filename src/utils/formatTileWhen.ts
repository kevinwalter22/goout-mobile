/**
 * formatTileWhen — short relative time label for an event tile
 * (e.g. "Happening now", "Tonight", "Tomorrow", "Sat 7pm", "In 90m").
 * Activities (and events with no starts_at) get no label.
 */

const DAY_ABBREV = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  const endsAt = item.ends_at
    ? new Date(item.ends_at)
    : new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);

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

  return `${DAY_ABBREV[startsAt.getDay()]} ${formatClockTime(startsAt)}`;
}

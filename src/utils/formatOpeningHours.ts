/**
 * Compact opening hours formatting for map preview cards and list views.
 *
 * Input: `schedule_text` — semicolon-joined weekday descriptions from Google
 * Places, e.g. "Monday: 7:00 AM – 7:00 PM; Tuesday: 7:00 AM – 7:00 PM; ..."
 *
 * Output:
 *   summaryLine — "Open now · Closes at 7:00 PM" / "Closed · Opens at 7:00 AM"
 *   fullSchedule — parsed day-by-day array for detail views
 */

export interface DaySchedule {
  day: string; // "Monday", "Tuesday", etc.
  hours: string; // "7:00 AM – 7:00 PM" or "Closed"
}

export interface OpeningHoursResult {
  summaryLine: string | null;
  fullSchedule: DaySchedule[];
}

const DAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Parse a schedule_text string into structured day schedules.
 *
 * Handles formats like:
 *   "Monday: 7:00 AM – 7:00 PM; Tuesday: 7:00 AM – 7:00 PM"
 *   "Monday: Closed; Tuesday: 9:00 AM – 5:00 PM"
 *   "Monday: Open 24 hours"
 */
export function parseScheduleText(scheduleText: string): DaySchedule[] {
  if (!scheduleText) return [];

  return scheduleText
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(":");
      if (colonIdx === -1) return null;
      const day = entry.slice(0, colonIdx).trim();
      const hours = entry.slice(colonIdx + 1).trim();
      return { day, hours };
    })
    .filter((d): d is DaySchedule => d !== null);
}

/**
 * Parse a time string like "7:00 PM" into total minutes since midnight.
 */
export function parseTime(timeStr: string): number | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === "AM" && hours === 12) hours = 0;
  if (period === "PM" && hours !== 12) hours += 12;

  return hours * 60 + minutes;
}

/**
 * Parse an hours range like "7:00 AM – 7:00 PM" into open/close minutes.
 * Returns null for "Closed" or unparseable formats.
 * Returns { open: 0, close: 1440 } for "Open 24 hours".
 */
function parseHoursRange(
  hours: string,
): { open: number; close: number } | null {
  if (/closed/i.test(hours)) return null;
  if (/open\s*24\s*hours/i.test(hours)) return { open: 0, close: 1440 };

  // Handle "7:00 AM – 7:00 PM" (en dash, em dash, or hyphen)
  const parts = hours.split(/\s*[–—-]\s*/);
  if (parts.length !== 2) return null;

  const open = parseTime(parts[0]);
  const close = parseTime(parts[1]);
  if (open === null || close === null) return null;

  return { open, close };
}

/**
 * Format minutes since midnight back to a time string like "7:00 PM".
 */
function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${period}`;
}

/**
 * Get the day name for a JS Date object.
 */
function getDayName(date: Date): string {
  return DAY_ORDER[date.getDay()];
}

/**
 * Format opening hours into a compact summary + full schedule.
 *
 * @param scheduleText — semicolon-joined schedule from explore_items.schedule_text
 * @param now — current date/time (injectable for testing)
 */
export function formatOpeningHours(
  scheduleText: string | null | undefined,
  now: Date = new Date(),
): OpeningHoursResult {
  if (!scheduleText) {
    return { summaryLine: null, fullSchedule: [] };
  }

  const fullSchedule = parseScheduleText(scheduleText);
  if (fullSchedule.length === 0) {
    return { summaryLine: null, fullSchedule: [] };
  }

  const todayName = getDayName(now);
  const todayEntry = fullSchedule.find(
    (d) => d.day.toLowerCase() === todayName.toLowerCase(),
  );

  if (!todayEntry) {
    return { summaryLine: null, fullSchedule };
  }

  // Handle "Closed" today
  if (/closed/i.test(todayEntry.hours)) {
    const nextOpenDay = findNextOpenDay(fullSchedule, now);
    if (nextOpenDay) {
      return {
        summaryLine: `Closed · Opens ${nextOpenDay}`,
        fullSchedule,
      };
    }
    return { summaryLine: "Closed today", fullSchedule };
  }

  // Handle "Open 24 hours"
  if (/open\s*24\s*hours/i.test(todayEntry.hours)) {
    return { summaryLine: "Open 24 hours", fullSchedule };
  }

  // Parse time range
  const range = parseHoursRange(todayEntry.hours);
  if (!range) {
    return { summaryLine: null, fullSchedule };
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (currentMinutes >= range.open && currentMinutes < range.close) {
    return {
      summaryLine: `Open · Closes at ${formatMinutes(range.close)}`,
      fullSchedule,
    };
  }

  if (currentMinutes < range.open) {
    return {
      summaryLine: `Closed · Opens at ${formatMinutes(range.open)}`,
      fullSchedule,
    };
  }

  // After close — find next open time
  const nextOpenDay = findNextOpenDay(fullSchedule, now);
  if (nextOpenDay) {
    return {
      summaryLine: `Closed · Opens ${nextOpenDay}`,
      fullSchedule,
    };
  }

  return { summaryLine: "Closed", fullSchedule };
}

/**
 * Find the next opening time after today.
 * Returns a string like "at 7:00 AM" (tomorrow) or "Mon at 9:00 AM".
 */
function findNextOpenDay(
  schedule: DaySchedule[],
  now: Date,
): string | null {
  const todayIdx = now.getDay(); // 0=Sun, 1=Mon, ...

  for (let offset = 1; offset <= 7; offset++) {
    const checkIdx = (todayIdx + offset) % 7;
    const dayName = DAY_ORDER[checkIdx];
    const entry = schedule.find(
      (d) => d.day.toLowerCase() === dayName.toLowerCase(),
    );
    if (!entry || /closed/i.test(entry.hours)) continue;

    const range = parseHoursRange(entry.hours);
    if (!range) continue;

    const timeStr = formatMinutes(range.open);
    if (offset === 1) {
      return `tomorrow at ${timeStr}`;
    }
    const shortDay = dayName.slice(0, 3);
    return `${shortDay} at ${timeStr}`;
  }

  return null;
}

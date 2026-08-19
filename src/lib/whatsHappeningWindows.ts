/**
 * whatsHappeningWindows — split the "What's Happening" event feed into ordered
 * time windows (docs/intent_taxonomy.md §2: "'Tonight' in the evening, 'this
 * weekend' Thu–Fri, 'happening now' for live events. Rolling window, never stale").
 *
 * Windows, in display order: Tonight · This Weekend · This Week · Later.
 * - Soonest-first WITHIN each window (input is already sorted soonest-first).
 * - Series-collapsed across the whole feed: a recurring series appears once, at its
 *   soonest occurrence's window (dedup by series_id, falling back to id).
 * - Empty windows are hidden by the caller (windowWhatsHappening omits them).
 * - Day-aware: "This Weekend" is this calendar week's Sat/Sun; because the cascade
 *   claims "today" as Tonight first, the weekend window naturally collapses on a
 *   Sunday (nothing future left in it) and is meaningful mid-week.
 *
 * All comparisons use the device's local time (same convention as formatTileWhen
 * and the other groupTaxonomy predicates), so a user sees windows in their own tz.
 */

export type WhatsHappeningWindow = "tonight" | "this_weekend" | "this_week" | "later";

/**
 * In-progress events longer than this are treated as always-on programs (a
 * month-long exhibit, an all-summer camp, a season of daysails) that merely span
 * "now" rather than a genuine happening — they are left out of the time-windowed
 * feed instead of dominating "Happening Now". Tunable.
 */
export const HAPPENING_NOW_MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/** Display order + default labels for the windows. */
export const WHATS_HAPPENING_WINDOW_ORDER: { key: WhatsHappeningWindow; title: string }[] = [
  { key: "tonight", title: "Tonight" },
  { key: "this_weekend", title: "This Weekend" },
  { key: "this_week", title: "This Week" },
  { key: "later", title: "Later" },
];

/** Minimal shape the windowing needs — kept loose so ScoredItem satisfies it. */
export interface WindowableEvent {
  id: string;
  starts_at: string | null;
  ends_at: string | null;
  series_id?: string | null;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function endsAtOf(startsAt: Date, ends_at: string | null): Date {
  return ends_at ? new Date(ends_at) : new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
}

export function isInProgressNow(item: WindowableEvent, now: Date): boolean {
  if (!item.starts_at) return false;
  const s = new Date(item.starts_at);
  if (isNaN(s.getTime())) return false;
  return now >= s && now <= endsAtOf(s, item.ends_at);
}

/** This calendar week's Saturday/Sunday range (mirrors groupTaxonomy.isThisWeekend). */
function isThisWeekendDay(s: Date, now: Date): boolean {
  const day = now.getDay(); // 0=Sun … 6=Sat
  const satDate = new Date(now);
  if (day === 0) {
    satDate.setDate(satDate.getDate() - 1); // Sunday: this week's Saturday was yesterday
  } else if (day !== 6) {
    satDate.setDate(satDate.getDate() + (6 - day));
  }
  satDate.setHours(0, 0, 0, 0);
  const sunEnd = new Date(satDate);
  sunEnd.setDate(sunEnd.getDate() + 1);
  sunEnd.setHours(23, 59, 59, 999);
  return s >= satDate && s <= sunEnd;
}

/**
 * Assign one event to its window via a precedence cascade (first match wins):
 * in-progress/today → Tonight; this week's Sat/Sun → This Weekend; within 7 days →
 * This Week; else Later. Undated or already-ended events return null (not shown).
 */
export function assignWhatsHappeningWindow(
  item: WindowableEvent,
  now: Date
): WhatsHappeningWindow | null {
  if (!item.starts_at) return null;
  const s = new Date(item.starts_at);
  if (isNaN(s.getTime())) return null;

  const e = endsAtOf(s, item.ends_at);
  if (e < now) return null; // already over (defensive — exploreQuery already excludes)

  if (now >= s && now <= e) {
    // In progress. Only a genuine (short) event is "Happening Now"; an always-on
    // program (multi-day exhibit, season pass) merely spans now and is left out.
    if (item.ends_at && e.getTime() - s.getTime() > HAPPENING_NOW_MAX_DURATION_MS) {
      return null;
    }
    return "tonight"; // happening now
  }
  if (sameLocalDay(s, now)) return "tonight"; // later today
  if (isThisWeekendDay(s, now)) return "this_weekend";

  const in7 = new Date(now);
  in7.setDate(in7.getDate() + 7);
  if (s <= in7) return "this_week";

  return "later";
}

/**
 * Split a soonest-sorted event list into ordered, series-collapsed, non-empty
 * windows. The "tonight" window is titled "Happening Now" when it contains a
 * live event, else "Tonight".
 */
export function windowWhatsHappening<T extends WindowableEvent>(
  items: T[],
  now: Date
): { key: WhatsHappeningWindow; title: string; items: T[] }[] {
  const buckets = new Map<WhatsHappeningWindow, T[]>();
  const seenSeries = new Set<string>();

  for (const item of items) {
    const w = assignWhatsHappeningWindow(item, now);
    if (!w) continue;
    const seriesKey = item.series_id ?? item.id; // collapse a recurring series to its soonest
    if (seenSeries.has(seriesKey)) continue;
    seenSeries.add(seriesKey);
    const list = buckets.get(w);
    if (list) list.push(item);
    else buckets.set(w, [item]);
  }

  const out: { key: WhatsHappeningWindow; title: string; items: T[] }[] = [];
  for (const { key, title } of WHATS_HAPPENING_WINDOW_ORDER) {
    const list = buckets.get(key);
    if (!list || list.length === 0) continue;
    const resolvedTitle =
      key === "tonight" && list.some((i) => isInProgressNow(i, now)) ? "Happening Now" : title;
    out.push({ key, title: resolvedTitle, items: list });
  }
  return out;
}

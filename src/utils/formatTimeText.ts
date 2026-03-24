/**
 * Sanitizes stale relative time strings stored in the `time_text` database field.
 *
 * Content ingestion pipelines sometimes store relative timestamps like
 * "starts in 1600 hours" at scrape time. These become misleading as time passes.
 * This function detects that pattern and reformats it into human-readable units.
 * All other time_text values (e.g. "Open daily 9am–5pm") pass through unchanged.
 */
export function sanitizeTimeText(raw: string): string {
  const match = raw.match(/\bin\s+(\d+)\s+hours?\b/i);
  if (!match) return raw;

  const totalHours = parseInt(match[1], 10);
  if (totalHours < 1) return "Starting soon";
  if (totalHours < 24) return `in ${totalHours} hour${totalHours === 1 ? "" : "s"}`;

  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;

  // Only show hours when the remainder is meaningful (≥ 2 hours)
  if (remHours < 2) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `in ${days} day${days === 1 ? "" : "s"} ${remHours} hours`;
}

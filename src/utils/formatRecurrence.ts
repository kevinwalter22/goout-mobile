/**
 * Map an explore_items `recurrence` value to its display label.
 *
 * Returns null for "none"/"unknown"/empty/unrecognized values, which the
 * caller uses to hide the recurrence badge entirely.
 */
export function formatRecurrence(
  recurrence: string | null | undefined,
): string | null {
  switch (recurrence) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "annual":
      return "Annually";
    default:
      return null;
  }
}

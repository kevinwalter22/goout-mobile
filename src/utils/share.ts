/**
 * Share Utilities
 *
 * Native share sheet integration and deep link generation.
 */

import { Share } from "react-native";

const DOMAIN = "links.euda.live";
const SCHEME = "euda";

/**
 * Build a deep link URL for an explore item.
 *
 * In dev builds, returns a custom-scheme link (euda://event/...) so links
 * work without the server-side .well-known files. In production, returns
 * a universal link (https://links.euda.live/event/...) that opens the app
 * via iOS Universal Links.
 */
export function buildDeepLink(itemId: string): string {
  if (__DEV__) {
    return `${SCHEME}://event/${itemId}`;
  }
  return `https://${DOMAIN}/event/${itemId}`;
}

interface ShareItemOptions {
  title: string;
  locationName?: string | null;
  town?: string | null;
  startsAt?: string | null;
  scheduleText?: string | null;
  itemId: string;
}

/**
 * Share an explore item using the native share sheet.
 *
 * Message format:
 *   Title
 *   📅 Date/time (or 🕐 Schedule)
 *   📍 Location
 *
 *   https://links.euda.live/event/{id}
 */
export async function shareItem(options: ShareItemOptions): Promise<boolean> {
  const { title, locationName, town, startsAt, scheduleText, itemId } = options;

  const lines: string[] = [];

  lines.push(title);

  // Date/time
  if (startsAt) {
    lines.push(`📅 ${formatShareDate(startsAt)}`);
  } else if (scheduleText) {
    const shortSchedule =
      scheduleText.length > 50
        ? scheduleText.substring(0, 47) + "..."
        : scheduleText;
    lines.push(`🕐 ${shortSchedule}`);
  }

  // Location
  const location = [locationName, town].filter(Boolean).join(", ");
  if (location) {
    lines.push(`📍 ${location}`);
  }

  // Deep link
  lines.push("");
  lines.push(buildDeepLink(itemId));

  const message = lines.join("\n");

  try {
    const result = await Share.share({ message, title });

    return result.action === Share.sharedAction;
  } catch (error) {
    console.error("[Share] Error sharing:", error);
    return false;
  }
}

/**
 * Format an ISO date string for the share message.
 */
function formatShareDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return isoDate;
  }
}

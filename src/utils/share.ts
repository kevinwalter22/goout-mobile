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
export function buildDeepLink(itemId: string, creatorId?: string): string {
  const base = __DEV__
    ? `${SCHEME}://event/${itemId}`
    : `https://${DOMAIN}/event/${itemId}`;
  return creatorId ? `${base}?creatorId=${creatorId}` : base;
}

interface ShareItemOptions {
  title: string;
  locationName?: string | null;
  town?: string | null;
  startsAt?: string | null;
  scheduleText?: string | null;
  itemId: string;
  /** UUID of the user who created this event. Encoded in the link so
   *  non-friends who open it see a "private event" screen with an add-friend CTA. */
  creatorId?: string | null;
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
  const { title, locationName, town, startsAt, scheduleText, itemId, creatorId } = options;

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

  // Deep link — include creatorId for user-created events so non-friends
  // see a contextual "private event" screen instead of a generic error.
  lines.push("");
  lines.push(buildDeepLink(itemId, creatorId ?? undefined));

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
 * The download/invite URL for the app.
 * Update to the App Store URL after launch.
 */
export const APP_INVITE_URL = `https://${DOMAIN}/download`;

/**
 * Share the Euda app with a friend via the native share sheet.
 * Used for inviting people who aren't on the app yet.
 */
export async function shareApp(): Promise<boolean> {
  try {
    const result = await Share.share({
      message: `Hey! Join me on Euda — the best way to discover what's happening around you.\n\nDownload it: ${APP_INVITE_URL}`,
    });
    return result.action === Share.sharedAction;
  } catch (error) {
    console.error("[Share] Error sharing app:", error);
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

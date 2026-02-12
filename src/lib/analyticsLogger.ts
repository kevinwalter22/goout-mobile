/**
 * Analytics Logger
 *
 * Fire-and-forget logging of app-level KPI events to the analytics_events table.
 * Never blocks UI, never throws. All errors are silently logged in __DEV__.
 *
 * For explore-item interactions (open_detail, rsvp, check_in_post, share),
 * use interactionLogger.ts instead — those go to user_item_events.
 */

import { supabase } from "./supabase";
import { addActionBreadcrumb } from "./sentry";

export type AnalyticsEventName =
  | "signup_complete"
  | "explore_open"
  | "post_started"
  | "contacts_sync_started"
  | "contacts_sync_completed";

/**
 * Log an app-level analytics event.
 * Fire-and-forget: returns void immediately, never throws.
 */
export function logAnalyticsEvent(
  userId: string,
  eventName: AnalyticsEventName,
  metadata: Record<string, unknown> = {},
): void {
  if (!userId || !eventName) {
    if (__DEV__) {
      console.log("[Analytics] Skipped: missing userId or eventName");
    }
    return;
  }

  // Sentry breadcrumb for crash context
  addActionBreadcrumb(`analytics:${eventName}`, metadata);

  supabase
    .from("analytics_events")
    .insert({ user_id: userId, event_name: eventName, metadata })
    .then(({ error }) => {
      if (error && __DEV__) {
        console.log(`[Analytics] ${eventName} failed:`, error.message);
      }
    })
    .catch((err) => {
      if (__DEV__) {
        console.log(`[Analytics] ${eventName} error:`, err);
      }
    });
}

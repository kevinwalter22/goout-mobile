/**
 * Interaction Logger
 *
 * Fire-and-forget logging of user interactions with explore items.
 * Never blocks UI, never throws. All errors are silently logged in __DEV__.
 *
 * Calls a single server-side RPC that atomically:
 * 1. Appends to user_item_events
 * 2. Updates user_type_affinity (event vs activity preference)
 * 3. Updates user_tag_affinity (tag-based preference)
 */

import { supabase } from "./supabase";
import { addActionBreadcrumb } from "./sentry";

export type InteractionEventType =
  | "open_detail"
  | "rsvp"
  | "check_in_post"
  | "share";

interface LogInteractionParams {
  userId: string;
  exploreItemId: string;
  eventType: InteractionEventType;
  itemKind: "event" | "activity";
  metadata?: Record<string, unknown>;
}

/**
 * Log a user interaction event and update affinities.
 * Fire-and-forget: returns void immediately, never throws.
 */
export function logInteraction(params: LogInteractionParams): void {
  const { userId, exploreItemId, eventType, itemKind, metadata = {} } = params;

  if (!userId || !exploreItemId || !eventType || !itemKind) {
    if (__DEV__) {
      console.log("[InteractionLogger] Skipped: missing required fields");
    }
    return;
  }

  // Sentry breadcrumb for crash context
  addActionBreadcrumb(eventType, { itemKind, exploreItemId });

  supabase
    .rpc("log_interaction_and_update_affinity", {
      p_user_id: userId,
      p_explore_item_id: exploreItemId,
      p_event_type: eventType,
      p_item_kind: itemKind,
      p_metadata: metadata,
    })
    .then(({ error }) => {
      if (error && __DEV__) {
        console.log(`[InteractionLogger] ${eventType} failed:`, error.message);
      }
    })
    .catch((err) => {
      if (__DEV__) {
        console.log(`[InteractionLogger] ${eventType} error:`, err);
      }
    });
}

/**
 * Auth funnel logger.
 *
 * Fire-and-forget writes to `auth_event_log` for diagnosing signup/signin
 * drop-offs. Unlike securityEvents (which bans PII), this logger
 * deliberately stores email so admins can answer "where did this specific
 * user get stuck?"
 *
 * Never blocks the UI, never throws. If logging fails, the auth flow
 * proceeds unaffected.
 */

import { Platform } from "react-native";
import { supabase } from "./supabase";

export type AuthEventType =
  | "signup_attempt"
  | "signup_succeeded"
  | "signup_failed"
  | "signin_attempt"
  | "signin_succeeded"
  | "signin_failed"
  | "confirmation_arrived"
  | "confirmation_failed";

type LogPayload = {
  email?: string | null;
  userId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, any>;
};

export function logAuthEvent(eventType: AuthEventType, payload: LogPayload = {}): void {
  const metadata = {
    platform: Platform.OS,
    ...(payload.metadata ?? {}),
  };

  Promise.resolve(
    supabase.rpc("log_auth_event" as any, {
      p_event_type: eventType,
      p_email: payload.email ?? null,
      p_user_id: payload.userId ?? null,
      p_error_code: payload.errorCode ?? null,
      p_error_message: payload.errorMessage ?? null,
      p_metadata: metadata as any,
    })
  )
    .then(({ error }: any) => {
      if (error && __DEV__) {
        console.warn("[authLog] Failed to log:", eventType, error.message);
      }
    })
    .catch(() => {
      // Silently swallow — logging must never break the auth flow
    });
}

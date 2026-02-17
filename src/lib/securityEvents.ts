/**
 * Lightweight security event logger.
 *
 * Logs notable security-related events to the `security_events` table
 * for admin review. Fire-and-forget — never blocks the UI or leaks PII.
 *
 * Usage:
 *   logSecurityEvent("auth.password_change", "medium");
 *   logSecurityEvent("content.report", "low", { target_type: "post" });
 */

import { supabase } from "./supabase";

type Severity = "low" | "medium" | "high" | "critical";

/**
 * Log a security event. Safe metadata only — never pass emails, tokens,
 * phone numbers, or other PII.
 */
export function logSecurityEvent(
  eventType: string,
  severity: Severity,
  metadata?: Record<string, string | number | boolean>,
): void {
  // Fire-and-forget: don't await, don't throw
  Promise.resolve(
    supabase
      .rpc("log_security_event", {
        p_event_type: eventType,
        p_severity: severity,
        p_metadata: (metadata ?? {}) as any,
      })
  )
    .then(({ error }) => {
      if (error && __DEV__) {
        console.warn("[securityEvents] Failed to log:", eventType, error.message);
      }
    })
    .catch(() => {
      // Silently ignore — security logging must never break the app
    });
}

/** Standard event type constants for consistency. */
export const SEC = {
  AUTH_FAILED_LOGIN: "auth.failed_login",
  AUTH_PASSWORD_CHANGE: "auth.password_change",
  AUTH_ACCOUNT_DELETE: "auth.account_delete",
  CONTENT_REPORT: "content.report",
  USER_BLOCK: "user.block",
  RATE_LIMIT_HIT: "rate_limit.hit",
} as const;

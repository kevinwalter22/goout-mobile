/**
 * Production-safe logger.
 *
 * - In __DEV__: passes through to console (full objects OK).
 * - In production: console.* calls are stripped by babel plugin.
 *   Use logger.error() to send unexpected errors to Sentry.
 *   Use logger.warn() for recoverable issues worth tracking.
 *
 * NEVER pass raw user objects, tokens, or phone numbers to any logger method.
 */

import * as Sentry from "@sentry/react-native";

/**
 * Report an unexpected error to Sentry (production) or console (dev).
 * Only call this for errors that indicate bugs or infra failures —
 * not for expected user-facing errors (wrong password, validation, etc.).
 */
export function captureError(
  error: unknown,
  context?: Record<string, string | number | boolean>,
): void {
  if (__DEV__) {
    console.error("[logger.captureError]", error, context);
    return;
  }

  const err =
    error instanceof Error ? error : new Error(String(error));

  if (context) {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}

/**
 * Report a recoverable warning to Sentry as a message (not an exception).
 */
export function captureWarning(
  message: string,
  data?: Record<string, string | number | boolean>,
): void {
  if (__DEV__) {
    console.warn("[logger.captureWarning]", message, data);
    return;
  }

  Sentry.withScope((scope) => {
    scope.setLevel("warning");
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureMessage(message);
  });
}

/**
 * Sentry crash reporting integration.
 *
 * - Disabled when EXPO_PUBLIC_SENTRY_DSN is empty or in __DEV__ mode.
 * - Strips PII: no raw contacts, phone numbers, or auth tokens.
 * - Provides breadcrumb helpers for key user actions.
 * - Includes Session Replay, Feedback Widget, and Logs (from Sentry wizard).
 */

import * as Sentry from "@sentry/react-native";
import { Env } from "../config/env";
import { getSessionId } from "./sessionId";

const ENABLED = !__DEV__ && !!Env.SENTRY_DSN;

/** Call once at app startup (before RootLayout renders). */
export function initSentry(): void {
  if (!ENABLED) {
    if (__DEV__) {
      console.log("[Sentry] Disabled in dev mode or no DSN configured");
    }
    return;
  }

  Sentry.init({
    dsn: Env.SENTRY_DSN,
    environment: Env.APP_ENV,
    release: `euda@${require("../../app.json").expo.version}`,

    // Do NOT send default PII (IP, cookies, etc.) — privacy safe
    sendDefaultPii: false,

    // --- DISABLED BY DEFAULT (Chief Engineer Phase 2, 06/15/2026) ---------
    // Replay, performance tracing, the feedback widget, and Sentry Logs were
    // turned on by the Sentry setup wizard. They cost money and add noise, so
    // we ship plain crash/error reporting only. Re-enable DELIBERATELY when we
    // have a measured reason — uncomment the lines below AND re-add the
    // integrations array:
    //   tracesSampleRate: 0.2,             // performance tracing
    //   replaysSessionSampleRate: 0.1,     // session replay (sampled)
    //   replaysOnErrorSampleRate: 1,       // session replay (on error)
    //   enableLogs: true,                  // Sentry Logs product
    //   integrations: [
    //     Sentry.mobileReplayIntegration({ maskAllText: true }),
    //     Sentry.feedbackIntegration(),
    //   ],
    // ---------------------------------------------------------------------

    // Strip PII from events before sending
    beforeSend(event) {
      // Remove user IP address
      if (event.user) {
        delete event.user.ip_address;
      }

      // Scrub breadcrumb data for sensitive patterns
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.data) {
            scrubData(crumb.data);
          }
        }
      }

      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      // Drop HTTP breadcrumbs that contain auth headers
      if (breadcrumb.category === "xhr" || breadcrumb.category === "fetch") {
        if (breadcrumb.data) {
          delete breadcrumb.data.request_headers;
          delete breadcrumb.data.response_headers;
        }
      }
      return breadcrumb;
    },
  });

  // Tag events with the engagement session_id for cross-correlation.
  attachSentrySession();
}

/** Scrub sensitive keys from an arbitrary data object. */
function scrubData(data: Record<string, unknown>): void {
  const sensitiveKeys = [
    "token",
    "password",
    "secret",
    "authorization",
    "phone",
    "phone_number",
    "contacts",
    "email",
  ];
  for (const key of Object.keys(data)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      data[key] = "[Filtered]";
    }
  }
}

/**
 * Set the current user context (call after login).
 * Only sends the user ID — no email, no phone, no username.
 */
export function setSentryUser(userId: string | null): void {
  if (!ENABLED) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/**
 * Attach the current engagement session_id (src/lib/sessionId) as a Sentry tag
 * so crashes correlate with the engagement-log session. Fire-and-forget and
 * safe to call repeatedly (e.g. on auth changes).
 */
export function attachSentrySession(): void {
  if (!ENABLED) return;
  getSessionId()
    .then((id) => Sentry.setTag("session_id", id))
    .catch(() => {
      /* session id is best-effort context; telemetry must never throw */
    });
}

/** Add a navigation breadcrumb. */
export function addNavigationBreadcrumb(
  screen: string,
  params?: Record<string, string>,
): void {
  if (!ENABLED) return;
  Sentry.addBreadcrumb({
    category: "navigation",
    message: screen,
    data: params,
    level: "info",
  });
}

/** Add a user action breadcrumb. */
export function addActionBreadcrumb(
  action: string,
  data?: Record<string, unknown>,
): void {
  if (!ENABLED) return;
  Sentry.addBreadcrumb({
    category: "user.action",
    message: action,
    data,
    level: "info",
  });
}

/**
 * Force a test exception to verify Sentry is working.
 * Only works in non-dev builds (staging/prod).
 */
export function sendTestException(): void {
  if (__DEV__) {
    console.log("[Sentry] Test exceptions are only sent in staging/prod builds");
    return;
  }
  if (!ENABLED) {
    console.warn("[Sentry] Cannot send test exception — no DSN configured");
    return;
  }
  Sentry.captureException(new Error("Euda test exception — safe to ignore"));
}

/** Wrap the root component with Sentry's error boundary. */
export const SentryWrap = ENABLED ? Sentry.wrap : (component: any) => component;

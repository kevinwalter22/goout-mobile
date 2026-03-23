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

    // Performance tracing: 20% of transactions
    tracesSampleRate: 0.2,

    // Session Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,

    // Logs
    enableLogs: true,

    // Integrations: replay + feedback widget
    integrations: [
      Sentry.mobileReplayIntegration({ maskAllText: true }),
      Sentry.feedbackIntegration(),
    ],

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

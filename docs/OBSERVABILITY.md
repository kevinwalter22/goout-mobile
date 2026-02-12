# Observability — Crash Reporting & Performance Tracing

Sentry integration for the Euda mobile app.

---

## Overview

| What | How |
|------|-----|
| SDK | `@sentry/react-native` |
| Disabled in | `__DEV__` mode or when `EXPO_PUBLIC_SENTRY_DSN` is empty |
| Enabled in | Staging and production builds with a DSN configured |
| PII scrubbing | Auth tokens, phone numbers, contacts, emails stripped before send |
| User context | Only user ID sent (no email, no username) |

---

## Setup

1. Create a Sentry project at [sentry.io](https://sentry.io) (select React Native).
2. Copy the DSN from Settings > Projects > your-project > Client Keys (DSN).
3. Add it to your `.env`:

```env
EXPO_PUBLIC_SENTRY_DSN=https://abc123@o456.ingest.sentry.io/789
```

4. Build a staging or production build — crash reporting is automatically enabled.

---

## What Gets Captured

### Automatic
- Unhandled JS exceptions with full stack traces
- Native crashes (iOS/Android) via Sentry's native layer
- HTTP request breadcrumbs (headers stripped for privacy)

### Custom Breadcrumbs
These are attached to crash reports for context:

| Action | Source | Breadcrumb |
|--------|--------|------------|
| Explore tab opened | `app/(tabs)/explore.tsx` | `navigation: Explore` |
| Event/activity detail viewed | `interactionLogger.ts` | `user.action: open_detail` |
| RSVP toggled | `interactionLogger.ts` | `user.action: rsvp` |
| Post/check-in started | `interactionLogger.ts` | `user.action: check_in_post` |
| Item shared | `interactionLogger.ts` | `user.action: share` |

### User Context
- Set on login, cleared on logout (via `AuthContext`)
- Only the Supabase user ID is sent — no email, phone, or username

---

## Testing Crash Reporting

### 1. Quick test from a staging build

Import and call the test function from any screen (e.g., a hidden button in Settings):

```typescript
import { sendTestException } from "../src/lib/sentry";

// In a button handler:
sendTestException();
```

This sends a safe test exception: `"Euda test exception — safe to ignore"`.

### 2. Verify in Sentry dashboard

1. Open [sentry.io](https://sentry.io) > your project > Issues.
2. You should see the test exception within ~30 seconds.
3. Click it — confirm it includes:
   - Stack trace
   - Device info (OS, model)
   - Environment tag (`staging` or `prod`)
   - Release version
   - Any breadcrumbs from actions before the crash

### 3. Confirm dev mode is silent

Run the app in dev (`npx expo start`). Check the console — you should see:

```
[Sentry] Disabled in dev mode or no DSN configured
```

No events should appear in Sentry from dev builds.

### 4. Verify PII scrubbing

1. Trigger a crash after logging in.
2. In Sentry, check the event details:
   - User section should only show `id` (no email, phone, IP)
   - Breadcrumbs should not contain auth tokens or phone numbers
   - HTTP breadcrumbs should have no request/response headers

---

## Architecture

```
app/_layout.tsx
  └─ initSentry()         # Called before render, no-ops in dev
  └─ SentryWrap(Layout)   # Wraps root component with error boundary

src/lib/sentry.ts         # All Sentry logic in one file
  ├─ initSentry()         # SDK init with PII scrubbing
  ├─ setSentryUser()      # ID-only user context
  ├─ addNavigationBreadcrumb()
  ├─ addActionBreadcrumb()
  ├─ sendTestException()  # For verification
  └─ SentryWrap           # Error boundary HOC

src/lib/interactionLogger.ts
  └─ addActionBreadcrumb() on every interaction

src/contexts/AuthContext.tsx
  └─ setSentryUser() on auth state change
```

---

## Configuration

All Sentry config lives in `src/lib/sentry.ts`:

| Setting | Value | Notes |
|---------|-------|-------|
| `tracesSampleRate` | `0.2` | 20% of transactions get performance traces |
| `environment` | Auto-detected | `dev`, `staging`, or `prod` via `Env.APP_ENV` |
| `release` | `euda@{version}` | From `app.json` version field |

To change sample rates or add integrations, edit `src/lib/sentry.ts`.

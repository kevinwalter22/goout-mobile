# Sentry Production Setup

Steps to enable Sentry crash reporting for EAS builds.

---

## 1. Set the DSN as an EAS environment variable

```bash
eas env:create --name EXPO_PUBLIC_SENTRY_DSN --value "<your-dsn>" --environment production
```

To also enable in preview/staging builds:

```bash
eas env:create --name EXPO_PUBLIC_SENTRY_DSN --value "<your-dsn>" --environment preview
```

The DSN comes from Sentry > Settings > Projects > euda-mobile > Client Keys (DSN).

> Do **not** commit the DSN to source control. The `.env.example` file has a
> placeholder; local dev uses `.env.local` (git-ignored).

---

## 2. Create a new native build

EAS secrets are baked into the native binary at build time. After setting the
secret, you must run a new build:

```bash
eas build --platform ios --profile production
```

Changing the secret alone does **not** update already-installed builds.

---

## 3. Verify

1. Install the new build on a device.
2. Open Settings > Developer panel (dev builds only) and tap **Send Sentry Test Error**.
3. Check Sentry dashboard — the test exception should appear within ~30 seconds.

For full observability docs (PII scrubbing, breadcrumbs, architecture), see
[OBSERVABILITY.md](./OBSERVABILITY.md).

---

## Behaviour when DSN is absent

| Scenario | Result |
|----------|--------|
| Dev mode (`npx expo start`) | Sentry disabled — console log only |
| Production build, no DSN | Sentry disabled — app runs normally, no crashes |
| Production build, DSN set | Sentry enabled — crashes and breadcrumbs reported |

The guard in `src/lib/sentry.ts`:

```typescript
const ENABLED = !__DEV__ && !!Env.SENTRY_DSN;
```

All exported functions (`setSentryUser`, `addNavigationBreadcrumb`, etc.) are
no-ops when `ENABLED` is false. The app is fully functional without Sentry.

---

## PII Scrubbing

Sentry is configured to **never** capture personal data:

| Layer | What's scrubbed | How |
|-------|----------------|-----|
| `sendDefaultPii: false` | IP addresses, cookies, form data | Sentry SDK flag |
| `beforeSend` hook | `event.user.ip_address` removed; breadcrumb data scrubbed for keys containing: `token`, `password`, `secret`, `authorization`, `phone`, `phone_number`, `contacts`, `email` | `src/lib/sentry.ts` |
| `beforeBreadcrumb` hook | HTTP request/response headers stripped from `xhr`/`fetch` breadcrumbs | `src/lib/sentry.ts` |
| `setSentryUser()` | Only sends `{ id: userId }` — no email, name, or phone | `src/lib/sentry.ts` |
| Babel plugin | `console.log`/`warn`/`info` stripped in production builds (only `console.error` kept for Sentry breadcrumbs) | `babel.config.js` |

**What IS captured:** stack traces, device model, OS version, anonymous user ID, navigation breadcrumbs, custom action breadcrumbs, error messages (scrubbed).

**Session Replay sampling:** 10% of normal sessions, 100% of sessions with errors.

---

## Monitoring & Incident Response

### Security events table

The `security_events` table (migration 076) logs security-relevant actions:

| Event type | Severity | Trigger |
|-----------|----------|---------|
| `auth.failed_login` | medium | Failed sign-in attempt |
| `auth.password_change` | medium | Successful password change |
| `auth.account_delete` | high | Account deletion |
| `content.report` | low | Content report submitted |
| `user.block` | low | User blocked |

Events are logged via `logSecurityEvent()` from `src/lib/securityEvents.ts` (fire-and-forget, never blocks UI).

### What to check, where

| What | Where | How |
|------|-------|-----|
| Crashes and errors | Sentry dashboard | Check daily; alerts auto-fire on new issues |
| Security events (last 24h) | `npx tsx security-tests/monitoring-check.ts` | Run with admin creds; exits non-zero if critical/high events |
| Security event summary | Supabase SQL: `SELECT * FROM get_security_event_summary(7)` | Admin-only RPC, summarizes by day/type/severity |
| Rate limit hits | Supabase table: `user_rate_limits` | Check for users hitting limits frequently |
| Content reports | Supabase table: `content_reports` | Admin review via Settings > Admin Review in-app |
| Edge function auth | `npm run security:test` | Automated test suite — run before deploys |

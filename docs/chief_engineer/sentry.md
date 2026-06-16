# Sentry Integration (Chief Engineer Phase 2)

**Status:** Code complete. Two manual dashboard steps remain for Kevin (below).
**Date:** 2026-06-15

---

## Architecture

Two Sentry projects under org **`euda-2e`**, separated by surface:

| Surface | Project | DSN env var | How it sends |
|---|---|---|---|
| Mobile app | `euda-mobile` (existing) | `EXPO_PUBLIC_SENTRY_DSN` | `@sentry/react-native` SDK (`src/lib/sentry.ts`) |
| Edge functions | `euda-edge` (**new**) | `SENTRY_DSN_EDGE` | Hand-rolled fetch client (`supabase/functions/_shared/sentry.ts`) |

Staging vs production is distinguished by the **environment tag**, not separate
projects: mobile sends `Env.APP_ENV` ("staging"/"prod"); edge sends `SENTRY_ENV`.

**Both are no-ops when their DSN is unset**, so local dev and unconfigured
deploys never error.

### What's enabled
Plain crash/error reporting only. **Replay, performance tracing, the feedback
widget, and Sentry Logs are DISABLED by default** (commented out in
`src/lib/sentry.ts` with a re-enable note) — they cost money and add noise.
Re-enable deliberately if we ever have a measured reason.

### Mobile specifics (already wired)
- Gated to staging + production only (`!__DEV__ && !!DSN`).
- User context: `setSentryUser(user.id)` on auth change (id only, no PII).
- `session_id` tag from `src/lib/sessionId.ts` (`attachSentrySession`).
- Release tagged `euda@<app version>`.
- PII scrubbing in `beforeSend`/`beforeBreadcrumb`.
- Source maps upload via the `@sentry/react-native/expo` plugin (`app.json`)
  during EAS builds — needs `SENTRY_AUTH_TOKEN` in the build env.

### Edge specifics (already wired)
Wrapped functions (chosen because silent failure has bitten us before):
`ingest-web-collector`, `normalize-raw-events`, `log-engagement`,
`cache-place-photos`, `run-enrichment-queue`, `discover-venues-to-crawl`,
`ingest-venue-website`.

---

## Usage pattern (for future functions)

**New edge functions should capture errors via the `_shared/sentry.ts` wrapper
unless there's a specific reason not to.** Two ways:

```ts
// Preferred for new functions — wrap the whole handler:
import { withSentry } from "../_shared/sentry.ts";
Deno.serve(withSentry("my-function", async (req) => { ... }));

// Or capture inside an existing try/catch (what the Phase 2 functions use):
import { captureEdgeException } from "../_shared/sentry.ts";
} catch (error) {
  console.error("...", error);
  await captureEdgeException(error, { function: "my-function" });
  return new Response(/* 500 */);
}
```

Always set `function`. Pass `session_id` when the request carries one.
`await` the capture before returning so the isolate doesn't tear down first.

---

## ⏳ Manual steps for Kevin (~5–10 min in the Sentry dashboard)

### C) Create the edge Sentry project (doesn't exist yet)
1. Go to **sentry.io → Projects → Create Project**.
2. Platform: **Deno** (or "Other" if Deno isn't listed). Name it **`euda-edge`**,
   team your existing one, org `euda-2e`.
3. After creation: **Settings → Client Keys (DSN)** → copy the **DSN**.
4. Paste it as `SENTRY_DSN_EDGE`:
   - **Supabase (prod)** → project `lkmntknpaiaiqvupzjbz` → Edge Functions →
     **Secrets** → add `SENTRY_DSN_EDGE` = `<dsn>` and `SENTRY_ENV` = `production`.
   - **Supabase (staging)** → project `baulipaydofqtkihkghj` → add
     `SENTRY_DSN_EDGE` = `<same dsn>` and `SENTRY_ENV` = `staging`.
   - **`.env.local`** (for local `supabase functions serve`): add `SENTRY_DSN_EDGE`.

### B) Confirm the source-map auth token (mobile)
1. **Settings → Auth Tokens** (or Account → Auth Tokens). Ensure the existing
   `SENTRY_AUTH_TOKEN` has scopes **`project:releases`** and **`org:read`**
   (needed for source-map upload). Regenerate if unsure.
2. Add it where EAS can read it: **`eas env:create`** (or EAS dashboard →
   Environment variables) → name `SENTRY_AUTH_TOKEN`, visibility **Secret**,
   for the build profiles. Also keep it in `.env.local` for local builds.

### A) Already exists, no action
- Mobile project `euda-mobile` + `EXPO_PUBLIC_SENTRY_DSN` — leave as-is.

---

## Slack alerting rules to configure (Sentry UI — Kevin)

Set these up under **Alerts → Create Alert** once the Slack integration is
connected (**Settings → Integrations → Slack** → install → authorize the
`#euda-dev` workspace). Recommended issue-alert rules:

| Rule name | Condition | Action |
|---|---|---|
| **Edge: new issue** | A new issue is created in `euda-edge` | Notify Slack `#euda-dev` |
| **Edge: high frequency** | An issue in `euda-edge` is seen > 10 times in 1h | Notify Slack `#euda-dev` |
| **Mobile: new issue (prod)** | New issue in `euda-mobile`, `environment:prod` | Notify Slack `#euda-dev` |
| **Mobile: regression** | A resolved issue reopens (`euda-mobile`) | Notify Slack `#euda-dev` |

Keep **staging** mobile/edge issues OUT of Slack (filter `environment` to
prod/production) to avoid noise — review those in the dashboard.

Webhook formatting: Sentry's native Slack integration handles message
formatting; no custom webhook payload needed. If we later want a custom webhook
(e.g. to a different channel), Sentry posts a JSON payload with
`{ action, data.issue.title, data.issue.web_url, ... }`.

---

## Tests

`supabase/functions/_shared/sentry_smoke_test.ts` — a Deno test stub
(`ignore: true`, outside the jest match pattern). **Activated in Phase 4**: it
throws a known error through `captureEdgeException` and asserts the event
arrives in a throwaway Sentry test project.

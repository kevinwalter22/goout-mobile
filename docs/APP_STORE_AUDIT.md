# App Store Readiness Audit

Audit date: February 2026

---

## Blockers (must-fix before submission)

### B1. Sentry DSN must be set in EAS build secrets
- **Status**: Code is correct (`src/config/env.ts:8` reads `EXPO_PUBLIC_SENTRY_DSN`), but the actual DSN value must exist in EAS build secrets for production builds.
- **Fix**: Run `eas secret:create --name EXPO_PUBLIC_SENTRY_DSN --value <dsn>` or set it in the EAS dashboard.
- **Risk**: Without this, crash reports are silently disabled in production.

### B2. App Store Connect privacy policy URL
- **Status**: Privacy policy is live at `https://links.euda.live/privacy`.
- **Fix**: Enter this exact URL in App Store Connect > App Information > Privacy Policy URL.

### B3. Test account for App Review
- **Status**: Apple requires a pre-created test account with populated data for review.
- **Fix**: Create a test user with some posts, friends, and RSVPs. Provide credentials in the App Review notes (see `docs/APP_STORE_CHECKLIST.md`).

### B4. Screenshots required
- **Status**: No screenshots have been generated yet.
- **Fix**: Capture 6.7" (iPhone 15 Pro Max) and 6.1" (iPhone 15 Pro) screenshots for the five required screens. See `docs/APP_STORE_COPY.md` for description copy.

---

## Important (fix soon, could cause rejection or bad UX)

### I1. ~~Old "GoOut" branding in camera permission screen~~ FIXED
- **File**: `app/checkin/camera.tsx:317,334`
- **Was**: "GoOut needs camera access" / "Settings → GoOut → Camera"
- **Now**: "Euda needs camera access" / "Settings → Euda → Camera"

### I2. ~~Non-functional notification toggles~~ FIXED
- **File**: `app/settings/notifications.tsx`
- **Was**: 6 toggles (push, friend requests, comments, reactions, event reminders, friend activity) backed by local `useState` only — toggling appeared to save but did nothing.
- **Now**: Replaced with "Open Device Settings" button that links to OS notification settings. Honest and functional.

### I3. ~~Non-functional privacy toggles~~ FIXED
- **File**: `app/settings/privacy.tsx`
- **Was**: Profile visibility selector, show activity status toggle, allow tagging toggle — all local state, never persisted.
- **Now**: Removed fake toggles. Screen now shows only functional sections (permissions, blocked users) plus a link to the privacy policy.

### I4. ~~TODO comments in source~~ FIXED
- `app/settings/notifications.tsx` — removed (screen rewritten)
- `app/settings/privacy.tsx` — removed (screen rewritten)
- `src/lib/exploreQuery.ts:296` — removed TODO comment, kept null param

### I5. Location denial gives no "go to Settings" guidance
- **File**: `src/utils/location.ts:50`
- **Impact**: When location permission is denied during check-in, the user sees a generic error but no instructions on how to re-enable. Camera screen handles this well (shows "Settings → Euda → Camera"), but location does not.
- **Recommended fix**: Add a "Go to Settings" button in the Alert when location permission is denied. Low risk, but deferred to avoid scope creep in this PR.

---

## Nice-to-have (won't cause rejection)

### N1. `assetlinks.json` has placeholder SHA-256 fingerprint
- **File**: `web/.well-known/assetlinks.json:8`
- **Impact**: Android-only; irrelevant for iOS-first launch.
- **Fix later**: Run `eas credentials -p android` and update the fingerprint before Android launch.

### N2. `you@example.com` placeholder in auth forms
- **Files**: `app/(auth)/signin.tsx:64`, `app/(auth)/signup.tsx:113`
- **Impact**: This is standard placeholder text for email input fields. Apple does not reject for this. No action needed.

### N3. `APP_STORE_CHECKLIST.md` referenced old domain
- **File**: `docs/APP_STORE_CHECKLIST.md:19,54`
- **Status**: FIXED in this PR — updated to `links.euda.live`.

---

## Verified: No Issues Found

| Area | Status | Details |
|------|--------|---------|
| **app.json critical fields** | OK | name=Euda, slug=euda, bundleId=com.kevwalt22.mobile, version=1.0.0, buildNumber=1 |
| **iOS infoPlist usage strings** | OK | Camera + Location descriptions present, `ITSAppUsesNonExemptEncryption=false` |
| **associatedDomains** | OK | `applinks:links.euda.live` + `applinks:euda.app` |
| **Deep link scheme** | OK | `euda` (custom scheme for dev) |
| **Deep link routes** | OK | `app/event/[id].tsx`, `app/(tabs)/post/[id].tsx`, `app/(tabs)/user/[id].tsx` all exist |
| **+not-found.tsx** | OK | Catch-all screen with "Go Home" button |
| **UGC: Report** | OK | ContentActionMenu + ReportSheet on feed, post detail, user profile |
| **UGC: Block** | OK | Block option in ContentActionMenu; blocked-users management screen |
| **Account deletion** | OK | Settings > Delete Account with double confirmation |
| **Privacy/Terms links** | OK | About screen links to `links.euda.live/privacy`, `/terms`, `/support` |
| **Support email** | OK | `support@euda.live` |
| **Camera permission denial** | OK | Full-screen message with re-enable instructions |
| **Contacts permission denial** | OK | Clear message + "Try Again" button |
| **Kill switches** | OK | Admin-only feature flags for contacts sync, recommender, interaction logging |
| **Sentry integration** | OK | Disabled in dev, enabled in prod when DSN is set; PII scrubbing active |
| **No hardcoded secrets** | OK | All secrets via env vars / EAS secrets |
| **No old branding** | OK | All user-visible "GoOut" references replaced with "Euda" |

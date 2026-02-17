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

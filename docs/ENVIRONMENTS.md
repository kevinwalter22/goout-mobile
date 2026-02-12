# Environment Configuration

How to set up and manage dev, staging, and production environments for the Euda mobile app.

---

## Required Variables

| Variable | Purpose | Where to find it |
|----------|---------|------------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key | Supabase Dashboard → Settings → API → anon public key |

All client-side env vars must use the `EXPO_PUBLIC_` prefix — this is an Expo requirement for vars that are bundled into the app.

---

## Local Dev Setup

1. Copy the template:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and replace the placeholder values with your Supabase project credentials.
3. Start the app:
   ```bash
   npx expo start
   ```

If any required variable is missing, the app will show a red error screen in dev mode listing which vars are absent.

---

## Staging (Optional)

To run against a staging environment, create a separate Supabase project and point your `.env` at it:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-staging-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-staging-anon-key
```

The app auto-detects environment based on the Supabase URL:

| URL pattern | Detected `APP_ENV` |
|-------------|--------------------|
| Contains `localhost` or `127.0.0.1` | `dev` |
| Contains `staging` | `staging` |
| Everything else | `prod` |

You can access this via `Env.APP_ENV` from `src/config/env.ts`.

---

## Edge Functions

Edge functions run in the Supabase Deno runtime and have their own separate env configuration:

- **Deployed**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase.
- **Local dev** (`supabase functions serve`): Place secrets in `supabase/functions/.env`.

The edge function env is independent from the Expo client env. They use different variable names (`SUPABASE_URL` vs `EXPO_PUBLIC_SUPABASE_URL`) and different keys (service role vs anon).

---

## Secrets & Git

- `.env` is in `.gitignore` — never committed.
- `.env*.local` is in `.gitignore` — never committed.
- `.env.example` **is** committed — it contains only placeholder values.
- `supabase/functions/.env` is in `.gitignore` — never committed.

---

## What Happens When Config Is Missing

| Mode | Behavior |
|------|----------|
| Dev (`__DEV__`) | Red error screen listing missing vars with instructions |
| Prod | `console.error` warning, then the app attempts to proceed (will likely crash on first Supabase call) |

The validation runs once at app startup in `app/_layout.tsx` via `validateEnv()` from `src/config/env.ts`.

# Security Runbook

Incident response procedures and key rotation steps for Euda.

---

## Key Inventory

| Secret | Where stored | Used by |
|--------|-------------|---------|
| `SUPABASE_URL` | EAS env, `.env.local` | App, edge functions, scripts |
| `SUPABASE_ANON_KEY` | EAS env, `.env.local` | App (client-side, safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | EAS env (server only), `.env.local` | Edge functions, admin scripts |
| `EXPO_PUBLIC_SENTRY_DSN` | EAS env | App (client-side, safe to expose) |
| `SENTRY_AUTH_TOKEN` | EAS env | Build-time source map upload |
| `ANTHROPIC_API_KEY` | Supabase edge function secrets | `rerank-explore-items` function |
| `TICKETMASTER_API_KEY` | Supabase edge function secrets | `ingest-ticketmaster` function |
| `GOOGLE_PLACES_API_KEY` | Supabase edge function secrets | Place detail / image functions |
| `EXPO_PUBLIC_PHONE_HASH_SALT` | EAS env, `app_secrets` table | Phone number hashing |

---

## Key Rotation Procedures

### Supabase API Keys (anon + service_role)

1. Go to **Supabase Dashboard > Settings > API**.
2. Click **Generate new keys** (both anon and service_role rotate together).
3. Update immediately:
   - EAS environment variables: `eas env:update`
   - `.env.local` for local dev
   - GitHub Secrets (for CI security tests)
   - Any cron jobs or external scripts that call edge functions
4. **Rebuild the app**: `eas build --platform ios --profile production`
   (the old keys stop working once rotated).
5. Verify: `npm run security:test`

### Supabase JWT Secret

1. **Supabase Dashboard > Settings > API > JWT Settings**.
2. Rotate the JWT secret. **This invalidates ALL existing user sessions.**
3. All users will be signed out and must re-authenticate.
4. No app rebuild needed (JWT validation is server-side).

### Anthropic API Key

1. Go to **console.anthropic.com > API Keys**.
2. Create a new key, delete the old one.
3. Update: `npx supabase secrets set ANTHROPIC_API_KEY=<new-key>`
4. Redeploy: `npx supabase functions deploy rerank-explore-items`

### Ticketmaster API Key

1. Go to **developer.ticketmaster.com > My Apps**.
2. Regenerate the consumer key.
3. Update: `npx supabase secrets set TICKETMASTER_API_KEY=<new-key>`
4. Redeploy: `npx supabase functions deploy ingest-ticketmaster`

### Google Places API Key

1. Go to **Google Cloud Console > APIs & Services > Credentials**.
2. Create a new key, restrict it to Places API, delete the old one.
3. Update: `npx supabase secrets set GOOGLE_PLACES_API_KEY=<new-key>`
4. Redeploy affected functions:
   ```bash
   npx supabase functions deploy fetch-place-details
   npx supabase functions deploy cache-place-photos
   npx supabase functions deploy lookup-venue-images
   npx supabase functions deploy ingest-google-places
   ```

### Sentry DSN / Auth Token

1. **Sentry > Settings > Projects > Client Keys** — rotate the DSN.
2. Update: `eas env:update --name EXPO_PUBLIC_SENTRY_DSN --value "<new-dsn>"`
3. **Rebuild the app** (DSN is baked into the binary).
4. For `SENTRY_AUTH_TOKEN`: **Sentry > Settings > Auth Tokens** — create new, update EAS.

### Phone Hash Salt

1. Update the `app_secrets` table: `UPDATE app_secrets SET value = '<new-salt>' WHERE key = 'phone_hash_salt';`
2. Update EAS env: `eas env:update --name EXPO_PUBLIC_PHONE_HASH_SALT --value "<new-salt>"`
3. **Rebuild the app.**
4. **Breaking change**: existing phone hashes in `profiles.phone_hash` will no longer match. Run a migration to re-hash all stored phone numbers with the new salt (or clear them and ask users to re-add).

---

## Kill Switch: Emergency Response

### 1. Disable new signups

```sql
-- Supabase Dashboard > Authentication > Settings > disable sign-ups
-- Or via API:
UPDATE auth.config SET enable_signup = false;
```

### 2. Revoke all refresh tokens (force re-auth)

Rotate the JWT secret (see above). This invalidates every active session.

### 3. Disable a specific feature

Use the feature flags table:

```sql
SELECT * FROM toggle_feature_flag('llm_reranker', false);
SELECT * FROM toggle_feature_flag('contact_sync', false);
```

Or from the admin review screen in-app.

### 4. Block a specific user

```sql
-- Disable their auth account
UPDATE auth.users SET banned_until = '2099-01-01' WHERE id = '<user-id>';
```

### 5. Take edge functions offline

```bash
# Redeploy with a maintenance response, or:
npx supabase functions delete <function-name>
```

### 6. Quarantine compromised content

```sql
UPDATE explore_items SET review_status = 'quarantined'
WHERE created_by_user_id = '<user-id>';
```

---

## CI Security Checks

The `security.yml` GitHub Actions workflow runs on every PR and push to main:

| Job | What it checks | Fails on |
|-----|---------------|----------|
| `audit` | `npm audit --audit-level=high` | High or critical vulnerabilities in dependencies |
| `secrets-scan` | Gitleaks scans commit history | Any detected secrets (API keys, tokens, passwords) |
| `security-tests` | `npm run security:test` (51 assertions) | Any RLS, auth, storage, or rate-limit regression |

### Required GitHub Secrets (for security-tests job)

```
SUPABASE_URL
SUPABASE_ANON_KEY
USER_A_EMAIL
USER_A_PASSWORD
USER_B_EMAIL
USER_B_PASSWORD
```

Set these in **GitHub > Settings > Secrets and variables > Actions**.

---

## Reporting a Vulnerability

If you discover a security issue, email **support@euda.live**. Do not open a public issue.

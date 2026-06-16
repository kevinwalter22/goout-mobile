# Staging Environment Design

**Version:** 1.0  
**Date:** 2026-06-14  
**Phase:** Chief Engineer Phase 1 (Infrastructure Design)  
**Status:** Implemented (scaffolding landed). See `staging_setup.md` for the
executable, corrected steps — it supersedes any command snippets below.

> **Corrections applied during implementation** (this doc was drafted before
> the code existed): (1) environment detection uses an explicit
> `EXPO_PUBLIC_APP_ENV` var, not URL string-matching — real Supabase refs are
> random and never contain "staging"; (2) the project ref is the
> auto-generated `<ref>`, not the literal `staging-staging` placeholder used
> below; (3) the mobile build profile is a dedicated `staging` profile;
> (4) seed data is loaded via `scripts/seed_staging_data.ts`, not raw SQL.

---

## Executive Summary

This document designs a production-mirror staging environment for Euda. The goal: give autonomous agents and human engineers a safe place to test schema changes, data migrations, and edge function deployments before they hit production.

**Key design principle:** Staging is a complete, independent Supabase project that mirrors production's schema but is isolated from production data. The mobile app has a build variant (staging flavor) that can be deployed to TestFlight/internal testers pointing at staging Supabase. GitHub Actions pipelines handle promotion from staging→prod, gated by manual approval.

**Architecture in one diagram:**
```
┌─ Git Branches ─────────────────────────────────────────────┐
│                                                             │
│  feature/* ──→ staging ──→ main                            │
│                   ↓           ↓                             │
│  develop → test    prod     prod                            │
│  (PR)    (auto)  (manual)  (manual)                         │
│                                                             │
└─ Supabase Projects ────────────────────────────────────────┘
   dev (local)
   staging-staging (staging project)
   lkmntknpaiaiqvupzjbz (production)

┌─ Mobile Builds ────────────────────────────────────────────┐
│                                                             │
│  eas build --platform=ios --profile staging                │
│  → references staging Supabase URL in env                  │
│                                                             │
│  eas build --platform=ios --profile production             │
│  → references prod Supabase URL in env                     │
│                                                             │
└────────────────────────────────────────────────────────────┘

┌─ Edge Functions ────────────────────────────────────────────┐
│                                                             │
│  Staging environment:  supabase/functions → deploy to      │
│  staging project with staging secrets                       │
│                                                             │
│  Production environment: supabase/functions → deploy to    │
│  prod project with prod secrets                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Git Branching Strategy

### Recommendation: **Feature → Staging → Main** (Modified Git Flow)

**Branch structure:**
```
main
  ↑
  └── staging (release candidate, auto-deploys to staging)
        ↑
        └── feature/* (feature branches, merge to staging)
```

**Rationale:**
- **Simplicity:** Three environments (dev/local, staging, prod) map to three clear branch points.
- **Workflow:** Developers work on feature branches. When ready for testing, merge to `staging` (auto-deploys to staging Supabase). When staging is validated and approved, merge `staging` → `main` (manual promotion to prod).
- **Safety:** Production never receives untested code. The `staging` branch acts as a release validation gate.
- **Automation readiness:** This pattern scales naturally to the autonomous infrastructure Kevin is building—agents will have clear "this goes to staging first" guardrails.

**Branch rules (recommended):**
- `main`: Protected. Requires PR approval. Merges only from `staging` or via tagged release commits.
- `staging`: Protected. Requires PR approval. Merges from `feature/*` and cherry-picks from `main` (for hotfixes).
- `feature/*`: Unprotected. Developers create and delete freely.

**Deploy triggers:**
- Merge to `staging`: Automatically trigger `.github/workflows/deploy-staging.yml` (Phase 5 work)
- Merge to `main`: Manual trigger (via GitHub UI or CLI) to promote to production

### Alternative considered: Trunk-based with environment flags
**Why we didn't choose it:** Trunk-based (single `main` branch, feature flags for routing) adds complexity upfront. We don't have a feature-flagging system yet, and it would require building one before we can safely deploy anything. The three-branch model is simpler for Phase 1 and can evolve into trunk-based later if desired.

---

## 2. Environment Variables: Scoping per Environment

### Client (Mobile App)

**Pattern:** `EXPO_PUBLIC_` prefix required by Expo. Environment detection is automatic based on Supabase URL.

**Variables:**
```env
# .env (dev — local, uncommitted)
EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
EXPO_PUBLIC_PHONE_HASH_SALT=euda_phone_salt_2024
EXPO_PUBLIC_SENTRY_DSN=https://...

# .env.staging (staging build variant, uncommitted)
EXPO_PUBLIC_SUPABASE_URL=https://staging-staging.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
EXPO_PUBLIC_PHONE_HASH_SALT=euda_phone_salt_2024
EXPO_PUBLIC_SENTRY_DSN=https://...

# .env.production (prod build variant, uncommitted)
EXPO_PUBLIC_SUPABASE_URL=https://lkmntknpaiaiqvupzjbz.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mxVuiA0yXUaF88e_h0EWqw_pXUN-LL5
EXPO_PUBLIC_PHONE_HASH_SALT=euda_phone_salt_2024
EXPO_PUBLIC_SENTRY_DSN=https://...
```

**How the mobile app detects environment:**
Implemented in `src/config/env.ts`. The primary signal is the explicit
`EXPO_PUBLIC_APP_ENV` build var; the URL is only a dev/prod fallback:
```typescript
function detectEnv(override: string, url: string): AppEnv {
  if (override === "dev" || override === "staging" || override === "prod") {
    return override;
  }
  if (!url || url.includes("localhost") || url.includes("127.0.0.1")) return "dev";
  return "prod"; // never guesses "staging" — fails safe to prod
}
```

The `APP_ENV` constant is available throughout the app via `Env.APP_ENV`. Implement any environment-specific UI (banners, debug info, etc.) using this flag.

**Build profile mapping (eas.json):**
```json
{
  "build": {
    "preview": {
      "env": "EXPO_PUBLIC_SUPABASE_URL=https://staging-staging.supabase.co",
      ...
    },
    "production": {
      "env": "EXPO_PUBLIC_SUPABASE_URL=https://lkmntknpaiaiqvupzjbz.supabase.co",
      ...
    }
  }
}
```

When running `eas build --profile staging`, EAS injects the staging Supabase URL into the build process. Developers also keep `.env.staging` and `.env.production` locally (in `.gitignore`) for local testing.

### Edge Functions

**Pattern:** Service-role keys and API credentials live in `supabase/functions/.env` (per project).

**Deployment model:**
Each environment gets its own deployment:

```bash
# Deploy to staging
npx supabase functions deploy --project-ref staging-staging

# Deploy to production
npx supabase functions deploy --project-ref lkmntknpaiaiqvupzjbz
```

The `--project-ref` flag tells the Supabase CLI which project to target. The `.env` file is read by the `supabase` CLI during `supabase functions serve` (local dev); when deployed, Supabase auto-injects the project's secrets (service-role key, custom env vars you've set in the dashboard).

**GitHub Actions integration (Phase 5 work):**
GitHub Actions workflow will pass `SUPABASE_PROJECT_REF=staging-staging` or `SUPABASE_PROJECT_REF=lkmntknpaiaiqvupzjbz` to the deployment step, determined by the branch (`staging` → staging-staging, `main` → prod).

---

## 3. Edge Functions: Environment Awareness

### Current State
Edge functions are deployed once to production. They talk to production Supabase via auto-injected `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### Design for Multi-Environment

**Option A (Recommended): Separate deployments**
- Deploy the entire `supabase/functions/` directory to staging-staging when code lands on the `staging` branch.
- Deploy to production-prod when code lands on the `main` branch.
- Each environment has its own copy of all functions, all talking to their own Supabase project.

**Why:** Simplicity, isolation, and ease of rollback. If a function breaks in staging, prod is unaffected. Testing the function against real database state in staging is straightforward.

**Option B (Alternative): Single deployment, environment-aware routing**
- Deploy once to production.
- Functions read `req.headers['cf-connecting-ip']` or a custom header to determine which Supabase project to talk to.
- Use separate `SUPABASE_URL_STAGING` and `SUPABASE_URL_PROD` env vars, switching between them in code.

**Why not:** Adds complexity (routing logic in every function), harder to test (prod functions must never fail on staging requests), and doesn't give Kevin the ability to test a new function in staging before deploying to prod.

**Recommendation: Use Option A (separate deployments).**

### Implementation Details

**Step 1: Store staging Supabase credentials as GitHub Secrets**
Add these to your repository's GitHub Secrets:
```
SUPABASE_STAGING_PROJECT_REF=staging-staging
SUPABASE_STAGING_ACCESS_TOKEN=... (personal access token)
SUPABASE_PROD_PROJECT_REF=lkmntknpaiaiqvupzjbz
SUPABASE_PROD_ACCESS_TOKEN=... (same personal access token, or separate)
```

**Step 2: GitHub Actions will deploy conditionally**
```yaml
# .github/workflows/deploy-staging.yml (pseudo-code, flesh out in Phase 5)
on:
  push:
    branches: [staging]

jobs:
  deploy-edge-functions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: npx supabase functions deploy --project-ref ${{ secrets.SUPABASE_STAGING_PROJECT_REF }}
```

**Step 3: Local development**
When running `supabase functions serve` locally, the `supabase` CLI reads your local `.env` file. To test against production:

```bash
# Test against staging (swap .env files temporarily)
cp supabase/functions/.env supabase/functions/.env.prod
cp supabase/functions/.env.staging supabase/functions/.env
supabase functions serve
```

Or use separate clones / alternate directories.

---

## 4. Mobile App: Build Flavors & Environment Switching

### Current State
The mobile app uses Expo / React Native. All builds currently point to production Supabase.

### Recommended Approach: EAS Build Profiles + Environment Env Files

**Why not Android/iOS build flavors?**
- Expo / React Native doesn't have a built-in "flavors" system like Android or iOS native projects.
- EAS (Expo Application Services) build profiles are the idiomatic way to manage build variants in the Expo ecosystem.

**Setup:**

1. **Update `eas.json`** to include staging and production profiles:
   ```json
   {
     "build": {
       "staging": {
         "android": {
           "buildType": "apk",
           "releaseChannel": "staging"
         },
         "ios": {
           "buildType": "simulator",
           "releaseChannel": "staging"
         },
         "env": {
           "EXPO_PUBLIC_SUPABASE_URL": "https://staging-staging.supabase.co",
           "EXPO_PUBLIC_SUPABASE_ANON_KEY": "sb_publishable_...",
           "EXPO_PUBLIC_PHONE_HASH_SALT": "euda_phone_salt_2024",
           "EXPO_PUBLIC_SENTRY_DSN": "https://..."
         }
       },
       "production": {
         "android": {
           "buildType": "apk",
           "releaseChannel": "production"
         },
         "ios": {
           "buildType": "archive"
         },
         "env": {
           "EXPO_PUBLIC_SUPABASE_URL": "https://lkmntknpaiaiqvupzjbz.supabase.co",
           "EXPO_PUBLIC_SUPABASE_ANON_KEY": "sb_publishable_mxVuiA0yXUaF88e_h0EWqw_pXUN-LL5",
           "EXPO_PUBLIC_PHONE_HASH_SALT": "euda_phone_salt_2024",
           "EXPO_PUBLIC_SENTRY_DSN": "https://..."
         }
       }
     }
   }
   ```

2. **Local .env files for development:**
   Keep `.env`, `.env.staging`, and `.env.production` in `.gitignore`. Developers can swap which one `expo start` reads:
   ```bash
   # Start against local dev Supabase
   cp .env.local .env && npx expo start

   # Start against staging
   cp .env.staging .env && npx expo start

   # Start against production
   cp .env.production .env && npx expo start
   ```

3. **Visual indicator in the app:**
   In the settings page or app header, show `Env.APP_ENV` (already available from `src/config/env.ts`) so testers know which environment they're connected to:
   ```typescript
   import { Env } from '@/src/config/env';
   
   export function SettingsHeader() {
     return (
       <ThemedView>
         <ThemedText type="title">Settings</ThemedText>
         {Env.APP_ENV !== 'prod' && (
           <ThemedText style={{ color: 'orange' }}>
             Connected to: {Env.APP_ENV.toUpperCase()}
           </ThemedText>
         )}
       </ThemedView>
     );
   }
   ```

4. **TestFlight deployment (Phase 5 work):**
   In GitHub Actions, build staging variant via `eas build --profile staging` and upload to internal testing group. Production builds go to prod TestFlight group.

---

## 5. Schema Sync Strategy: Migrations Flow Staging → Prod

### Principle
**Migrations are the source of truth.** Schema changes live in `supabase/migrations/` as SQL files. Both staging and production apply the same migration sequence, in order.

### Workflow

1. **Developer creates a migration** (locally or in the Supabase dashboard):
   ```bash
   supabase migration new add_featured_column
   # Creates supabase/migrations/20260614_000000_add_featured_column.sql
   ```

2. **Test locally:**
   ```bash
   supabase db push  # Applies all pending migrations to local database
   supabase db reset  # (Optional) resets and reapplies all migrations
   ```

3. **Commit to feature branch:**
   ```bash
   git add supabase/migrations/
   git commit -m "Add featured column to events"
   git push origin feature/featured-events
   ```

4. **PR to staging, merge:**
   ```bash
   # CI validates migration syntax (Phase 5 work)
   # Merge to staging
   ```

5. **GitHub Actions auto-applies to staging Supabase** (Phase 5 work):
   ```bash
   supabase db push --project-ref staging-staging
   ```

6. **Test in staging environment:**
   - Mobile app points at staging Supabase.
   - Test the new schema and functionality end-to-end.
   - If needed, make corrections: new migration (don't edit existing ones) or manual SQL.

7. **Promote to production (manual approval):**
   ```bash
   # Merge staging → main (via PR or direct, depending on your policy)
   # GitHub Actions runs: supabase db push --project-ref lkmntknpaiaiqvupzjbz
   ```

### Rollback Strategy

**If a migration breaks staging:**
1. Create a new "rollback" migration (don't revert the old one; that breaks version history).
   ```sql
   -- supabase/migrations/20260614_000001_rollback_featured_column.sql
   ALTER TABLE events DROP COLUMN featured;
   ```
2. Apply it: `supabase db push --project-ref staging-staging`
3. Fix the original migration file, or create a new corrected one.
4. Test again in staging.

**Why not `supabase db reset`?**
It's fine for local dev and staging early testing, but don't use it in production. Production migrations must be additive and version-controlled.

### Important: Seed Data

The schema sync uses migrations (DDL only). **Seed data is separate:**

- **Seed files** live in `supabase/seed.sql` or `supabase/seed/` (if you choose to organize that way).
- **Local dev:** `supabase db reset` applies schema + seed to reset your local database during development.
- **Staging:** Seeded with a curated subset of production data (see Section 6 for data isolation strategy). Applied manually or via a separate GitHub Action.
- **Production:** Real user data. No seed applied (would overwrite real data).

---

## 6. Data Isolation Strategy

### Principle
**Staging never touches production data. Staging has curated test data that reflects realistic scenarios.**

### How to seed staging with realistic test data

**Option A (current — synthetic fixtures via script):**

Run `scripts/seed_staging_data.ts`. It upserts a few valid `[STAGING]`-tagged
`explore_items` (Warwick / Bethel / Sugar Loaf) with real coordinates, is
idempotent (fixed UUIDs), and has a hard guard that refuses to run against the
production project ref. No PII is involved because the data is synthetic.

```bash
npx tsx scripts/seed_staging_data.ts   # reads creds from .env.staging
```

> Note: Postgres has no MySQL-style `INTO OUTFILE`. If we later need real prod
> rows, export with `\copy (SELECT ...) TO 'file.csv' CSV HEADER` from `psql`
> (or `pg_dump --data-only -t explore_items`), redact PII, then `\copy ... FROM`.

**Option B (Phase 2+): Automated backup + redaction**

1. Set up a nightly or weekly scheduled job (e.g., GitHub Actions):
   ```yaml
   # .github/workflows/sync-staging-data.yml
   on:
     schedule:
       - cron: '0 2 * * 0'  # Weekly, Sunday 2 AM UTC
   
   jobs:
     sync-staging:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: ./scripts/seed_staging_data.ts --from-production
   ```

2. The script exports a subset from prod, redacts PII, and loads into staging.

**Data isolation guardrails:**

1. **Supabase RLS (Row-Level Security) policies:** Ensure staging users can only see test data, and staging can never write to production tables (this is enforced by separate Supabase projects, so less critical, but good practice).

2. **Read-only credentials for production:** In GitHub Actions, use a production API key with minimal permissions (read-only to explore_items, for data export). Never give write access.

3. **Different database users:** Staging and production have different Supabase projects with different credentials. CI/CD uses different secrets for each.

---

## 7. Promotion: Staging → Production

### Gating Mechanism

**Process for promoting staging code to production:**

1. **Code is merged to `main` branch.**
   - This typically happens via a PR from `staging` → `main`, approved by Kevin.

2. **GitHub Actions detects merge to `main`.**
   - Triggers `.github/workflows/deploy-production.yml` (stubbed in Phase 1, wired in Phase 5).

3. **Manual approval step (recommended):**
   ```yaml
   # deploy-production.yml
   on:
     push:
       branches: [main]
   
   jobs:
     request-approval:
       runs-on: ubuntu-latest
       steps:
         - name: Request deployment approval
           run: echo "Waiting for manual approval to deploy to production..."
   
     deploy-edge-functions:
       needs: [request-approval]
       if: github.event.inputs.approved == 'true'
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: npx supabase functions deploy --project-ref ${{ secrets.SUPABASE_PROD_PROJECT_REF }}
   ```

4. **Kevin clicks "Approve" in GitHub UI** (or uses the CLI to trigger the workflow).

5. **Deployment proceeds:** Edge functions deploy to production, mobile app goes out via TestFlight → App Store.

### Alternative: Auto-deployment on main (not recommended for Phase 1)

If code reaches `main`, it's tested and assumed safe to auto-deploy. Phase 2 or 3, when confidence is high, we can flip to auto-deployment on `main`.

---

## 8. Decision Log: Key Tradeoffs

| Decision | Rationale | Alternative Considered |
|----------|-----------|------------------------|
| **Three-branch model** (feature → staging → main) | Clear separation of concerns; easy to explain. Scales to autonomous work. | Trunk-based + feature flags (more complex upfront) |
| **Separate Supabase deployments per environment** | Isolation, independent testing, easy rollback. | Single deployment + routing logic (harder to test in isolation) |
| **EAS build profiles for mobile** | Idiomatic in Expo ecosystem; integrates with `eas.json`. | Manual build scripts (lower-level, error-prone) |
| **Manual approval gate for prod promotion** | Ops discipline; prevents accidental deploys. | Auto-deploy on `main` (faster, riskier) |
| **Curated seed data in staging** | Realistic test scenarios without exposing PII. | Prod db dump (privacy risk) or synthetic data (poor fidelity) |

---

## 9. Summary: What Kevin Will Do

After this design is approved:

1. **Create staging Supabase project:**
   - Via Supabase dashboard, create new project named `staging-staging`.
   - Note the staging project URL and anon key.

2. **Sync schema:** Run the current production migrations against staging:
   ```bash
   supabase db push --project-ref staging-staging
   ```

3. **Set GitHub Secrets:**
   - `SUPABASE_STAGING_PROJECT_REF` = `staging-staging`
   - `SUPABASE_STAGING_ACCESS_TOKEN` = (personal access token)
   - `SUPABASE_PROD_PROJECT_REF` = `lkmntknpaiaiqvupzjbz`
   - `SUPABASE_PROD_ACCESS_TOKEN` = (same or different token)

4. **Seed staging with test data:**
   - Run `scripts/seed_staging_data.ts` (will be provided in setup guide).

5. **Test end-to-end:**
   - Build mobile app with staging profile: `eas build --profile staging`.
   - Point local dev at staging Supabase (swap `.env` files).
   - Verify: App connects to staging, shows staging data.

---

## Appendix: Future Evolution

- **Phase 2:** Automated schema validation in CI (sqlc, pgplint).
- **Phase 3:** Full blue-green deployments for edge functions (canary → 100% rollout).
- **Phase 4:** Autonomous agents can test changes in staging, promote to prod with high confidence.
- **Phase 5+:** Feature flags, advanced traffic mirroring, multi-region staging.


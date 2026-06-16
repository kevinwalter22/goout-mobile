# Staging Environment: Setup Guide (Kevin's checklist)

**Status:** Code + config scaffolding is DONE (see "Already done" below). This
guide is now only the steps that require your dashboard/account access.
**Owner:** Kevin
**Estimated time:** ~30 min of dashboard clicking + one build.

---

## Already done in code (no action needed)

These landed in the repo as part of this session — you don't have to touch them:

- `src/config/env.ts` — environment detection now keys off an explicit
  `EXPO_PUBLIC_APP_ENV` var (`dev` | `staging` | `prod`). **Why this matters:**
  the old code guessed staging via `url.includes("staging")`, but real Supabase
  project refs are random strings, so a real staging build would have been
  mislabeled as prod. Each EAS profile now sets `EXPO_PUBLIC_APP_ENV`.
- `app/_layout.tsx` — a persistent `STAGING` / `DEV` banner renders on every
  non-prod build so a tester can never confuse staging with the App Store app.
- `eas.json` — `staging` and `production` build profiles with env blocks. The
  production values are filled in; **the staging values are `FILL_IN_...`
  placeholders waiting on Step 1 below.**
- `.gitignore` — now ignores `.env.staging` / `.env.production` (they weren't
  before — secrets would have been committable).
- `.env.staging.example` / `.env.production.example` — copy-and-fill templates.
- `.github/workflows/deploy-staging.yml` / `deploy-production.yml` — real,
  functional deploy workflows. They stay inert (skip with a warning) until the
  GitHub secrets in Step 3 exist.
- `scripts/seed_staging_data.ts` — runnable, idempotent staging seeder with a
  hard guard that refuses to run against the production project.

---

> **State as of 06/14/2026:** Steps 1–4 are **DONE** (Claude executed them).
> Staging creds wired into `eas.json` + `.env.staging`; schema applied
> (baseline + 137 migrations); GitHub secrets set; 3 test items seeded and
> verified visible to authenticated users. **Only Steps 5 (EAS build +
> TestFlight) and 6 (`staging` branch) remain — both need Kevin's
> account/device.** A `000_legacy_baseline.sql` was added and `020` fixed so the
> migrations now replay from zero (prod unaffected).

## Step 1 — Capture the staging project's real credentials  ✅ DONE

You created the staging project. Now grab its actual values (the design docs
used a `staging-staging` placeholder; the real ref is an auto-generated random
string like the prod one, `lkmntknpaiaiqvupzjbz`).

In the **staging** project dashboard → **Settings → API**, copy:

| Value | Where it's used |
|-------|-----------------|
| **Project URL** (`https://<ref>.supabase.co`) | eas.json, .env.staging |
| **Project ref** (the `<ref>` part) | GitHub secret, CLI |
| **publishable / anon key** (`sb_publishable_...`) | eas.json, .env.staging |
| **service_role key** (`sb_secret_...`) | seed script only — keep secret |
| **DB password** (from project creation) | GitHub secret, CLI |

Then fill them in:

1. **`eas.json`** — replace the two `FILL_IN_STAGING_*` values in the `staging`
   profile with the staging URL and publishable key.
2. **`.env.staging`** — `cp .env.staging.example .env.staging` and fill it in.
   (Stays out of git.)

> ⚠️ I could not do this step: `.env.local` in the repo only contains the
> **production** URL/key, not staging. If you intended to drop staging creds
> there, they didn't land. Paste them and I'll wire the rest.

---

## Step 2 — Apply the schema to staging  ⛔ BLOCKED (wrong DB password)

> The password `CrosbyMalkin8771!` in `.env.local` fails Postgres SASL auth
> (tried direct host, pooler, and `-p` raw). The service-role key works over
> REST, so only the **DB password** is wrong. Fix it in the staging dashboard →
> Settings → Database (reset password), then either re-run the command below or
> hand the new password to Claude to run.

This copies the production **schema** to staging. No user data is copied.

```bash
# one-time auth
npx supabase login

# point the CLI at staging, then push all migrations
npx supabase link --project-ref <STAGING_REF>
npx supabase db push
# (you'll be prompted for the staging DB password)
```

**Expected:** the CLI applies `supabase/migrations/001_*.sql` …
`137_enforce_post_verification.sql` in order (137 migrations total as of this writing).

**Verify** in the staging SQL Editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

You should see `explore_items`, `event_sources`, `posts`, etc. A short/empty
list means migrations didn't apply — check the CLI output.

---

## Step 3 — Add GitHub secrets (enables the deploy workflows)

The workflows are already written; they need these repo secrets
(**Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Value |
|--------|-------|
| `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token (see below) |
| `SUPABASE_STAGING_PROJECT_REF` | the staging `<ref>` |
| `SUPABASE_STAGING_DB_PASSWORD` | staging DB password |
| `SUPABASE_PROD_PROJECT_REF` | `lkmntknpaiaiqvupzjbz` |
| `SUPABASE_PROD_DB_PASSWORD` | production DB password |

**Personal access token:** dashboard →
[account/tokens](https://supabase.com/dashboard/account/tokens) →
"Generate new token", name it `euda-ci-cd`, copy it once.

**Production approval gate:** Settings → Environments → New environment named
`production` → enable **Required reviewers** and add yourself. The production
workflow runs in this environment, so prod deploys will pause for your approval.

---

## Step 4 — Seed staging with test data

```bash
# after Step 1 filled .env.staging with STAGING_SUPABASE_URL + STAGING_SERVICE_ROLE_KEY
npx tsx scripts/seed_staging_data.ts
```

Add these two lines to `.env.staging` for the script (service role, not anon):

```env
STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co
STAGING_SERVICE_ROLE_KEY=sb_secret_...
```

It upserts 3 tagged `[STAGING]` test items (Warwick / Bethel / Sugar Loaf) and
refuses to run if the URL is the production ref.

---

## Step 5 — Build and verify the staging app

```bash
# local check against staging
cp .env.staging .env && npx expo start
# the app should show a STAGING banner at the top and load the seeded items

# internal build
eas build --platform ios --profile staging
```

Install via TestFlight internal testing, confirm the **STAGING** banner shows
and the seeded test items load. Then restore your local env (`cp .env .env.bak`
beforehand if you want your old `.env` back).

---

## Step 6 — Create the `staging` branch

The staging workflow triggers on pushes to a `staging` branch, which doesn't
exist yet:

```bash
git checkout main && git pull
git checkout -b staging && git push -u origin staging
```

Optionally protect `main` and `staging` in repo settings (require PR review).

---

## Validation checklist

- [ ] Step 1: staging URL + publishable key filled into `eas.json` and `.env.staging`
- [ ] Step 2: migrations applied to staging; tables visible in SQL editor
- [ ] Step 3: 5 GitHub secrets set + `production` environment with required reviewer
- [ ] Step 4: seed script run; 3 `[STAGING]` items present
- [ ] Step 5: staging build shows the STAGING banner and loads seeded data
- [ ] Step 6: `staging` branch pushed; deploy-staging workflow runs green

---

## Troubleshooting

**`supabase db push` auth error** → `npx supabase logout && npx supabase login`.

**App shows DEV/PROD instead of STAGING** → the build's `EXPO_PUBLIC_APP_ENV`
isn't `staging`. Check the `staging` profile in `eas.json` (build) or
`.env.staging` (local). Detection no longer depends on the URL string.

**Workflow says "deploy skipped"** → the guard didn't find the secrets. Re-check
Step 3 secret names exactly.

**"Cannot connect to Supabase"** → wrong URL or you used the service_role key
where the publishable (anon) key was expected.

---

## What's deferred to later phases

- Automated prod→staging data sync with PII redaction (`--from-production`).
  Current seeder uses synthetic fixtures, which is enough for now.
- Edge-function secret parity (each project needs its own API keys set in its
  dashboard before functions that call external APIs will work in staging).
- CI migration-syntax validation before deploy.

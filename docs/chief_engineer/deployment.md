# Deployment — flow, gates, and rollback

_Chief Engineer Setup, Phase 5. The single source of truth for how code reaches
staging and production._

## Branch model

```
feature branch ──PR──▶ staging ──promotion PR──▶ main
     │                    │                         │
   test.yml            deploy-staging.yml      deploy-production.yml
  (PR gate)          (auto on push)        (push + manual approval)
```

- **No direct pushes to `main`** (and ideally `staging`) — everything goes through a PR.
- A PR runs `test.yml`. It must pass to merge (branch protection, below).
- Merging to `staging` auto-deploys to the **staging** Supabase project + an EAS staging build.
- Promoting `staging → main` deploys to **production** — behind a manual approval gate.

## The three workflows

| Workflow | Trigger | Does |
| --- | --- | --- |
| `test.yml` | every PR; called by both deploy workflows (`workflow_call`) | `checks` job: lint → typecheck → unit tests → pre-submission scan. `integration` job (after checks): integration tests against **staging** Supabase. |
| `deploy-staging.yml` | push to `staging`, or manual | runs `test.yml`; on green → `supabase db push` + `supabase functions deploy` + EAS staging build (`--no-wait`) → Slack summary. Failure → Slack alert. |
| `deploy-production.yml` | push to `main`, or manual | runs `test.yml`; on green → **approval gate** → migrations + functions + EAS production build → push a release tag (`vX.Y.Z-prod.<run>`) → Slack summary. Failure → Slack alert. |

`ci.yml` was removed — its lint/typecheck were folded into `test.yml`. `security.yml`
(npm audit, gitleaks, RLS regression) still runs independently on PRs.

Graceful degradation: EAS and Slack steps no-op until `EXPO_TOKEN` /
`SLACK_WEBHOOK_URL` are set, so the DB+functions deploy works before every secret
is in place. The integration job, however, **requires** the staging secrets and
fails loudly without them (tests must really run).

## Required GitHub Secrets

**Set & working:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_PROJECT_REF`,
`SUPABASE_PROD_DB_PASSWORD`, `SUPABASE_PROD_SERVICE_ROLE_KEY`,
`SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_DB_PASSWORD`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `USER_A/B_EMAIL/PASSWORD`.

**Add these** (Settings → Secrets and variables → Actions):

| Secret | Used by | Source |
| --- | --- | --- |
| `SUPABASE_STAGING_SERVICE_ROLE_KEY` | integration tests | staging project → Settings → API → `service_role` |
| `SUPABASE_STAGING_ANON_KEY` | integration tests | staging project → Settings → API → `anon` (also in `eas.json`) |
| `SENTRY_DSN_EDGE` | sentry smoke integration test | `.env.staging` |
| `EXPO_TOKEN` | EAS builds | expo.dev → Account → Access Tokens |
| `SLACK_WEBHOOK_URL` | deploy summaries | #euda-monitoring incoming webhook |
| `SLACK_ALERT_MENTION` *(optional)* | @-mention on failure | e.g. `<@U0B5E1V7NE4>` |

The staging **URL** is derived from `SUPABASE_STAGING_PROJECT_REF` — no URL secret needed.

## Branch protection (GitHub UI — one-time)

Settings → Branches → Add branch ruleset (or "Add rule") for **`main`**:
1. **Require a pull request before merging** → Require approvals: 1.
2. **Require status checks to pass before merging** → search and select:
   - `Lint, typecheck & unit tests`
   - `Integration tests (staging)`
   (These are the job names from `test.yml`. They appear in the list after the workflow has run at least once on a PR.)
3. **Require branches to be up to date before merging** (recommended).
4. **Do not allow bypassing the above settings** / **Restrict who can push** — this is what makes `main` PR-only. (Leave "Include administrators" off at first if you want an escape hatch.)

Repeat for **`staging`** with the same PR + status-check requirements (you can skip "restrict pushes" on staging if you want to be able to hotfix it directly).

⚠️ Enabling "Restrict who can push to matching branches" with administrators included means *everyone* — including you — must use PRs. Keep an escape hatch until you've watched a full prod deploy succeed.

## Production approval gate (GitHub UI — one-time)

Settings → Environments → **Production** → **Required reviewers** → add yourself.
After this, every prod deploy pauses on the `deploy` job until you click
**Review deployments → Approve**. This is the "ask before prod deploy" control.

## Normal deploy flow

1. Open a PR → `test.yml` runs → review + green checks → merge to `staging`.
2. `deploy-staging.yml` fires → tests rerun → staging gets migrations + functions + an EAS build → Slack ✅.
3. Smoke-test staging (app + #euda-monitoring + Sentry `euda-edge`).
4. Open a `staging → main` promotion PR → merge.
5. `deploy-production.yml` fires → tests rerun → **approve the deployment** in the Actions tab → prod gets migrations + functions + EAS build → release tag + Slack ✅.

## Rollback runbook

There are no auto down-migrations — the policy is **forward-fix**, with PITR as the safety net.

**Edge functions** (safest, fastest):
```bash
# Re-deploy the previous good version of a function
git checkout <previous-good-sha> -- supabase/functions/<fn>
supabase functions deploy <fn> --project-ref <ref>
git checkout HEAD -- supabase/functions/<fn>
```
Or revert the offending commit on the branch and let CI redeploy.

**Database migration gone wrong:**
- **Forward-fix (preferred):** write a new migration (next number) that reverses the bad change, and ship it through the normal flow. Never edit an applied migration in place.
- **Point-in-time recovery:** prod is Supabase Pro → PITR is available. Supabase Dashboard → Database → Backups → restore to a timestamp just before the deploy. Use only for genuinely destructive mistakes; it reverts *all* data since that point.
- Migration `137` (post-verification) is **sacred** — never roll it back without explicit sign-off.

**Mobile / EAS:**
- OTA-eligible JS change: publish a corrective `eas update` to the affected channel (`staging` / `production`), or roll the channel back to the prior update.
- Native build regression: submit/promote the previous build in EAS; the bad build stops being the latest.

**Full revert of a bad release:**
1. `git revert -m 1 <merge-commit>` on `main` → open PR → merge → prod redeploys the prior code.
2. Separately undo any DB state — **migrations are forward-only and a code revert does NOT touch the database.** Schema changes need a forward-fix migration (or PITR). **Non-schema runtime state a migration ships is also not reverted by code:** a `cron.schedule(...)` persists (undo with `cron.unschedule('<job>')`); enabled `collector_targets` / seeded rows persist (undo with the migration's documented rollback SQL, e.g. `UPDATE collector_targets SET is_enabled=FALSE WHERE name IN (...)`). **Every such migration carries its own rollback SQL in its header — that per-change path is the reference**, not a blanket `git revert`.
3. Confirm recovery in #euda-monitoring + Sentry.

## After every deploy — verify
- Slack summary posted in #euda-monitoring.
- Sentry `euda-edge` quiet (no new error spike).
- `pipeline_health_log` still logging; `monitor-*` crons green.
- For prod: open the app on the `production` channel and sanity-check the feed.

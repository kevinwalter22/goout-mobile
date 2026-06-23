# Multi-interface parity — VS Code, Slack, mobile

Goal: any work can be done from a local VS Code session, a Slack-initiated
session, or the Claude mobile/web app, with the same result.

## The model (why this works)

Sessions from **Slack and mobile/web run in an isolated Anthropic cloud VM** that
only clones the repo. They do **not** inherit your VS Code machine's `.env*`
files, cached CLI logins, or git credentials, and they do **not** get GitHub
Actions Secrets (those are injected only into Actions *workflow runs*). Cloud
push/PR is handled by the **Claude GitHub App** (no PAT needed). Env vars reach a
cloud sandbox only through a **Cloud Environment** config (+ optional setup
script) at claude.ai/code.

So the dividing line is **where the privileged work executes**:

- **Through the pipeline (git → GitHub Actions):** already interface-agnostic.
  The full deploy chain (CI → staging deploy → gated prod deploy → EAS → Slack)
  runs in Actions with GitHub Secrets. A session only pushes code.
- **Directly in the session sandbox (reads env):** needs the env provided to that
  sandbox. Local VS Code reads `.env.local`/`.env.staging`; cloud reads the Cloud
  Environment.

Parity = give the cloud sandbox the same env (curated, staging-pointed) + a setup
script + this orientation.

## Security model (important)

- **Cloud sessions point at STAGING by default.** The bare `SUPABASE_URL` /
  `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in the Cloud Environment are
  the **staging** values, so any direct execution from a cloud session hits
  staging — never prod. This is deliberate: the security/RLS suite and several
  scripts read the bare names.
- **Production is reached only through the gated pipeline.** That already works
  from any interface (push from anywhere → Actions deploys → approve on your
  phone). We intentionally do **not** place prod-write creds (prod service-role
  key, prod DB password) in the Cloud Environment — those vars are visible to
  anyone who can edit the environment, and loose prod write-access defeats the
  approval gate. If you ever truly need prod-direct from cloud, add them
  knowingly and temporarily.

## What's in the repo for parity

- **`CLAUDE.md`** (root) — auto-loaded orientation for every session.
- **`.claude/cloud-setup.sh`** — setup script for the cloud sandbox (installs
  tooling, runs `npm ci`). Point the Cloud Environment "Setup script" at it.
- **`.env.cloud.example`** — the **shape** of the Cloud Environment (key names, no
  values). The real values get pasted into claude.ai/code (see checklist).
- **`scripts/gh_api.mjs`, `scripts/invoke_fn.mjs`** — ops helpers, now committed.

## Credential map (where each lives)

| Need | Local (VS Code) | Cloud session | Pipeline (Actions) |
|---|---|---|---|
| Staging Supabase (url/anon/service/db pw) | `.env.local`/`.env.staging` | Cloud Env (staging-pointed) | GitHub Secrets `SUPABASE_STAGING_*` |
| Prod Supabase write | `.env.local` | **excluded by design** | GitHub Secrets `SUPABASE_PROD_*` (gated) |
| `EXPO_PUBLIC_*` build config | `.env` | Cloud Env | n/a (EAS uses its own) |
| `EXPO_TOKEN`, `SUPABASE_ACCESS_TOKEN` | `.env.local` | Cloud Env | GitHub Secrets |
| 3rd-party keys (Google/PredictHQ/Ticketmaster/Anthropic/Resend) | `.env.local` | Cloud Env | Supabase function secrets (runtime) |
| Sentry tokens (`SENTRY_*`) | `.env.local` | Cloud Env | `SENTRY_DSN_EDGE` secret |
| Test logins (`USER_A/B_*`, ADMIN/NORMAL/REVIEW) | `.env.local` (partial) | Cloud Env | GitHub Secrets `USER_A/B_*` |
| GitHub push/PR | git credential mgr | **Claude GitHub App** | auto `GITHUB_TOKEN` |
| App Store submit (`.p8`) | `secrets/asc-api-key.p8` | EAS-managed creds | EAS-managed creds |

## One-time setup checklist (Kevin)

These run in external UIs I can't reach; everything else is in the repo.

1. **claude.ai/code → create a Cloud Environment** for `kevinwalter22/goout-mobile`:
   - **Environment variables:** paste the contents of the local file
     `.env.cloud.local` (generated for you; gitignored; staging-pointed). `.env`
     format, no quotes.
   - **Setup script:** `bash .claude/cloud-setup.sh` (or paste its contents).
2. **Install the Claude GitHub App** on the repo (enables cloud/Slack push + PRs).
3. **Add `USER_A_EMAIL/PASSWORD` + `USER_B_EMAIL/PASSWORD`** to the Cloud
   Environment (copy from GitHub Secrets) if you want `npm run security:test` to
   run interactively from cloud.
4. **(Optional) EAS-managed App Store key:** run `eas credentials` and upload
   `secrets/asc-api-key.p8` so submissions can be driven from the pipeline/cloud
   instead of the local file.

After step 1–2, a phone/Slack session can do: all code/doc work, the full deploy
pipeline, staging integration tests, staging edge-fn invocation, ad-hoc scripts,
and direct 3rd-party API calls — i.e., parity with VS Code for everything except
prod-direct mutation (which stays gated on purpose).

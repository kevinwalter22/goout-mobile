# Euda — Claude Code project guide

This file is auto-loaded at the start of every Claude Code session (local **and**
cloud). It orients you fast so work is identical from VS Code, Slack, or the
mobile app. Read it first, then `PROJECT_STATE.md`.

## Read these before acting
1. **`PROJECT_STATE.md`** — single source of truth: who we are, current
   priorities, recent decisions, system state. Bootstrap context lives here.
2. **`docs/chief_engineer/autonomy_ladder.md`** — **authoritative** rules for what
   ships without asking vs. what stops for Kevin. Classify every task into a tier
   first. Tiers 1–2 ship through staging on their own; Tier 3–4 stop for Kevin;
   **every production deploy stops for Kevin's approval, no matter the tier.**
3. **`docs/chief_engineer/multi_interface.md`** — how the three interfaces stay
   equivalent (cloud env, secrets, what only runs locally).

## What this is
React Native / Expo (expo-router) iOS app + Supabase backend (Postgres, auth,
storage, edge functions). TypeScript throughout.

## Commands
- Build check: `npx expo export --platform web` (needs `EXPO_PUBLIC_*` env)
- Unit tests: `npm test` · Integration (vs staging): `npm run test:integration`
- Lint: `npm run lint` · Types: `npm run typecheck`
- Security/RLS suite (vs staging): `npm run security:test`
- Pre-submission scan: `npm run scan:preflight`

## How deploys work (interface-agnostic)
The privileged work runs in **GitHub Actions**, not in your session — so it's
identical from any interface:
- PR → `test.yml` gate (lint → typecheck → unit → preflight → integration vs staging)
- merge to **`staging`** → `deploy-staging.yml` auto-deploys (migrations + edge
  functions + EAS staging build + Slack)
- merge to **`main`** → `deploy-production.yml`, which **pauses at the `Production`
  approval gate (Kevin = required reviewer)**. Release tags `v<ver>-prod.<run#>`.

## Golden rules
- **Production is reached ONLY through the gated pipeline** — never with a loose
  prod service-role key from a session. In cloud sessions the bare `SUPABASE_*`
  vars point at **staging** by design.
- Don't bypass the geo+time post invariant (migration 137).
- Commit/push only when the work is ready; branch first if on `staging`/`main`.
- Never print secrets to the Slack channel.
- End commit messages with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Conventions (see PROJECT_STATE §7 + memory for the full list)
- Migrations: `supabase/migrations/NNN_description.sql` (sequential).
- RPCs: `p_` param prefix, `SECURITY DEFINER`, `GRANT TO authenticated`, RLS on all tables.
- Edge functions import supabase-js via the `npm:` specifier (NOT esm.sh — that was a deploy SPOF).
- Recommender weights in `src/config/recommenderConfig.ts` must sum to 1.0.

## Ops helpers (no `gh` CLI assumed)
`scripts/gh_api.mjs` (GitHub REST via `GITHUB_TOKEN`) and `scripts/invoke_fn.mjs`
(invoke a staging edge fn with `STG_URL`/`STG_KEY`). In cloud, `git`/PRs work via
the Claude GitHub App — no PAT needed for push.

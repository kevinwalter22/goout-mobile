# Security Regression Tests

Automated tests that prove RLS policies, RPC ownership guards, edge-function auth, storage isolation, and rate limiting are working correctly.

## Prerequisites

1. **Two test accounts** — both non-admin, ideally not friends with each other (the suite adapts if they are friends).
2. **Environment variables** — set before running:

```bash
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_ANON_KEY="<anon-key>"
export USER_A_EMAIL="testA@example.com"
export USER_A_PASSWORD="..."
export USER_B_EMAIL="testB@example.com"
export USER_B_PASSWORD="..."
```

Or use the `EXPO_PUBLIC_` prefixed variants already in your `.env`.

## Run

```bash
npm run security:test
```

Or directly:

```bash
npx tsx security-tests/run.ts
```

## What it tests

| Group | Tests |
|-------|-------|
| **A1** Profiles RLS | Own read, cross-user blocked, public_profiles view, sensitive fields hidden, app_secrets blocked |
| **A2** Friendships RLS | Own read, insert-as-other blocked |
| **A3** Posts RLS | Own read, create-as-other blocked |
| **A4** Explore Items | Soft-deleted items hidden from non-admins |
| **A5** Content Reports | Cross-user view blocked, insert-as-other blocked |
| **B1** Admin RPCs | approve/reject quarantined, toggle_feature_flag — all blocked for non-admin |
| **B2** RPC Ownership | 7 RPCs with assert_caller — own ID succeeds, cross-user blocked |
| **C1** Edge Function Auth | 12 internal + 3 user-facing functions reject unauthenticated calls |
| **C2** Edge Function CORS | Disallowed origin doesn't get `*`, allowed origin echoed |
| **D** Storage Isolation | Own-folder upload OK, cross-user blocked, explore-images blocked |
| **E** Rate Limiting | match_contacts 5/min limit triggers |

## Exit codes

- `0` — all passed
- `1` — one or more failures
- `2` — fatal error (e.g. sign-in failed)

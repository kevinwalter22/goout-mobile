# Preflight Test Suite

Automated integration tests that verify auth, content flows, moderation, enforcement, storage isolation, edge-function auth, and rate limiting against the live Supabase backend.

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (or `EXPO_PUBLIC_SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | Supabase anon/public key (or `EXPO_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (for cleanup) |
| `NORMAL_EMAIL` | Email of a non-admin test account |
| `NORMAL_PASSWORD` | Password for the normal test account |
| `ADMIN_EMAIL` | Email of an admin test account (`is_admin = true`) |
| `ADMIN_PASSWORD` | Password for the admin test account |

All variables are read from `.env.local` automatically via `tsx`.

## Usage

```bash
npm run test:preflight
# or
npx tsx preflight-tests/run.ts
```

## Test Suites

| Suite | Tests | What it proves |
|-------|-------|----------------|
| **A** Auth + Profile | 4 | Sign-in works, own profile readable, public_profiles hides sensitive fields, admin RPC |
| **B** Friend + Restricted Profile | 4 | Pending friends can't read full profile, accepted friends can |
| **C** Core Content Flows | 4 | Post create/read/delete works, cross-user delete blocked |
| **D** Moderation E2E | 9 | Text moderation (block/allow/quarantine), flag inbox, moderate_content RPC |
| **E** Enforcement | 6 | Suspension check, shadowban trigger auto-quarantines, admin visibility |
| **F** Storage Isolation | 5 | Owner upload/delete works, cross-user upload/delete blocked |
| **G** Edge Function Auth | 21 | Internal functions reject anon, user functions require JWT |
| **H** Rate Limiting | 3 | Post/comment rate limit RPCs callable, match_contacts limit triggers |

## Deterministic Cleanup

Every test run generates a unique `RUN_ID` (e.g., `pflt-1708123456789-a1b2c`). All rows created during the run are tagged with this ID in their caption, reason, or note fields. Cleanup at the end of each suite deletes rows matching the `RUN_ID` using the service-role client (bypasses RLS).

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed |
| `1` | One or more tests failed |
| `2` | Fatal error (sign-in failed, missing env vars, etc.) |

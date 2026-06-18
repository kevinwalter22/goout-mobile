# Schema Drift Audit — Production vs Staging (Chief Engineer Phase 3a)

**Date:** 2026-06-18
**Method:** `scripts/schema_audit.js` connects to both pooler DBs and diffs every
object class via `pg_catalog` / `information_schema`, printing only differences.
**Baselines:** prod `lkmntknpaiaiqvupzjbz` (pg 17.6) vs staging
`baulipaydofqtkihkghj` (pg 17.6), the latter rebuilt cleanly from the 137
migrations + `000_legacy_baseline`.

**Headline:** no real *logic* drift in functions, triggers, or RLS. The only
genuine prod-only objects were a handful never captured in migrations (events
RLS policy, `get_pipeline_health`, `pg_net`, a hand-patched function, and
9 cron jobs). Migration **138** catches up the first four; cron is documented
as separate tech debt. Everything else is runtime artifacts or cosmetics.

Classification key: **(a)** prod has it, staging didn't → catch-up; **(b)**
staging has it, prod doesn't → flag; **(c)** both have it, differs.

---

## Resolved by migration 138 (`138_schema_drift_catchup.sql`)
Applied to **staging** and verified (re-audit clean). Every statement is
idempotent and a **no-op on prod** (prod already has these). **Not yet applied
to prod — awaiting Kevin's approval** (touches RLS; see "Production apply" below).

| # | Class | Object | Finding | Resolution |
|---|---|---|---|---|
| 1 | (a) | `pg_net` extension | prod has it (schema `extensions`), staging missing | `CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions` |
| 2 | (a) | `events` RLS | prod: RLS enabled + policy "events are readable by everyone" (SELECT, `true`, public). Staging: RLS off, no policy (000_baseline made the table only) | enable RLS + recreate policy |
| 3 | (a) | `get_pipeline_health(text)` | prod-only admin helper wrapping the `v_*` health views; never in a migration | reconstructed verbatim from prod |
| 4 | (c) | `invoke_cleanup_orphaned_media()` | prod hand-patched to read config from `app_config` table instead of `current_setting()` (the cron-outage fix); migration version stale | `CREATE OR REPLACE` with prod's live body |
| 5 | (b)/security | grants on `app_config`, `v_collector_target_health`, `v_ingestion_activity`, `v_pipeline_stage_health` | staging's rebuild ran a blanket `ALTER DEFAULT PRIVILEGES … GRANT ALL`, over-granting `anon`/`authenticated` vs prod's stricter grants. **`app_config` can hold the service_role_key** → real exposure risk | `REVOKE` the extra grants (no-op on prod) |

---

## Accepted drift (no action — documented reasons)

**(a-accept) `engagement_log_2026_05` monthly partition** + its 16 columns,
7 indexes, and 3 grants. This is a **runtime-created partition** (the
auto-partition cron makes them per month). Staging simply hasn't created a May
partition because no May data / its cron hasn't run. Not schema drift — staging
will create its own partitions on demand. No migration.

**(c-accept) 3 functions differ only cosmetically** —
`invoke_cleanup_orphaned_media` (after #4), `mark_fuzzy_duplicates`,
`next_fetch_partition`. Verified **logic-identical** after stripping CRLF +
comments + whitespace. Cause: prod stores older comment-less bodies with CRLF
line endings (applied from Windows files long ago); staging replayed the
current migration files (LF, with comments). Same behavior. Not worth a
re-`CREATE OR REPLACE` on prod just to normalize whitespace.

> Note: the CRLF-vs-LF storage difference is why a naive `md5(pg_get_functiondef)`
> flagged **all 156** functions. It is cosmetic across the board.

**(b-accept) 3 staging-only legacy functions** — `get_ingestion_stats()`,
`get_sources_due_for_fetch()`, `source_needs_fetch(text)`. Created by migration
020; **prod dropped them manually** (dashboard, no migration) as unused helpers.
Staging (clean replay) still has them. Harmless; leaving them. If we want strict
parity later, a one-line `DROP FUNCTION IF EXISTS` migration would do it — not
worth it now.

**(c-accept) `pg_net` version** — prod `0.19.5`, staging `0.20.3`. Supabase
installed the current version on the newer staging project. Patch-level
extension version; no API surface we use differs. Accept.

---

## ⚠️ Flagged for follow-up (NOT fixed here)

**9 prod-only pg_cron jobs** (prod 17 vs staging 8):
`cache-place-photos-run`, `dedup-daily`, `discover-venues-hourly`,
`enrich-new-items`, `fetch-coordinator-run`, `ingest-venue-website-run`,
`normalize-new-events`, `send-event-reminders`, `web-collector-run`.

These were created/rewritten via the **diagnose-cron edge function** (decision
05/21/2026), which embeds the prod URL + auth bearer as **string literals** in
`cron.job.command` — so they live **outside the migration set**. The 8 jobs
staging does have are the ones defined in migrations.

- **Why not catch up via 138:** prod's jobs hard-code prod URLs/auth; copying
  them to staging would make staging's cron hit **production**. Staging cron is a
  separate, env-specific setup, not a "match prod" migration.
- **Root tech debt:** cron definitions aren't reproducible from migrations. This
  is the same class of gap that caused the 3-month silent cron outage.
- **Plan:** addressed pragmatically in **Phase 3b (monitoring)** — new monitor
  jobs + a GitHub Actions backup heartbeat so a cron outage is *detected*. A
  proper fix (parameterized, env-aware cron definitions in migrations) is a
  larger future item; logged in PROJECT_STATE tech debt.

---

## Production apply (needs Kevin's approval)
Migration 138 is idempotent and a no-op on prod, **but it includes an RLS change
on `events`** (per the operating rule, RLS changes get explicit approval — even
though prod already has this exact state). On approval I'll run
`supabase db push` against prod, which records 138 in prod's history and is a
no-op for every object. The `REVOKE`s also run on prod (already absent → no-op).

## How to re-run this audit
`node scripts/schema_audit.js` (requires `pg`; `npm install pg --no-save`).
Re-run after any prod hotfix to catch new dashboard-era drift early.

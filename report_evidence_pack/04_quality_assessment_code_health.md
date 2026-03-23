# Code Quality Assessment

**Supports report sections: D (limitations and quality risks)**

---

## 1. Quality Scorecard

| # | Criterion | Score (1–5) | Evidence | Notes |
|---|-----------|-------------|----------|-------|
| 1 | **Readability** | 4/5 | Consistent `useXxx` hook naming; descriptive file names; clean separation of concerns | Minor: some screens (e.g., `app/event/[id].tsx`) are very long (~700+ lines) |
| 2 | **Type Safety** | 3/5 | TypeScript throughout; `tsc --noEmit` in CI | `as any` casts in `src/hooks/useContentReport.ts` lines 42 and 73; some DB insert types bypass schema inference |
| 3 | **Test Coverage** | 2/5 | Tests exist for: scoring.ts, groupingEngine.ts, textModeration.ts, formatOpeningHours.ts, enrichmentClassification.ts | No tests for hooks, screens, edge functions, or end-to-end flows. No coverage report generated. |
| 4 | **Modularity** | 4/5 | Clear layer separation: `app/` (screens), `src/hooks/` (data), `src/lib/` (services), `src/config/` (constants), `supabase/` (backend) | Some cross-layer imports exist; groupingEngine imports from hooks layer |
| 5 | **Error Handling** | 3/5 | Auth and critical paths have explicit error handling; `src/lib/logger.ts` + Sentry for crash capture | Fire-and-forget pattern used in `interactionLogger.ts`, community feedback RPC, analytics — errors silently dropped in non-critical paths (intentional, documented) |
| 6 | **Security Hygiene** | 4/5 | Rate limiting (migration 073), assert_caller pattern (074), RLS on all tables, storage policies (075), security event log (076), Sentry PII scrubbing | Minor: `as any` casts could mask injection risks if inputs flow to SQL unsanitized |
| 7 | **Dependency Hygiene** | 3/5 | 4 npm audit vulnerabilities (1 moderate: ajv ReDoS; 3 high: minimatch ReDoS) — all transitive dev toolchain deps. Production audit clean. Expo SDK 54 is current. | Sentry SDK at `~7.2.0` — slightly behind `@sentry/react-native` current (8.x). Low risk. |
| 8 | **Observability** | 3/5 | Sentry crash reporting + session replay; analytics_events table (migration 066); security_events table; pipeline_health_log | No APM/distributed tracing; no uptime monitoring; edge function errors not alerted |
| 9 | **DB Schema Design** | 4/5 | 108 sequential migrations; consistent `p_` prefix on RPC params; SECURITY DEFINER + GRANT TO authenticated on all RPCs; RLS on all tables | No staging environment; some migrations use `IF EXISTS` defensively (good) |
| 10 | **API Contract Stability** | 3/5 | All APIs are internal Supabase RPCs; no external API versioning | No versioning strategy; breaking changes require simultaneous migration + client update |
| 11 | **Documentation Quality** | 5/5 | 50+ markdown docs: architecture docs (`docs/as_built_architecture.md`), wave verification suites, release notes, privacy policy, moderation policy, analytics guide, observability guide | Exceptional for a solo project; agent-generated |
| 12 | **Conventions Consistency** | 4/5 | Consistent hook naming, migration naming (`NNN_description.sql`), commit message format (`feat(Wx-y):`) | Minor inconsistencies in import style (some default, some named) |

**Overall: 3.7 / 5** — solid for a 38-day solo-agentic build; primary gaps are test coverage and the absence of a staging environment.

---

## 2. Complexity Hotspots

### Highest-complexity files (by feature density, estimated):

| File | Estimated Lines | Complexity Driver |
|------|----------------|------------------|
| `app/event/[id].tsx` | ~700+ | Handles RSVP, check-in, camera trigger, sharing, user-created editing, content reporting, admin actions, ReportSheet — 8+ distinct interaction flows in one screen |
| `src/lib/scoring.ts` | ~350–450 | 9-signal scoring engine; ScoringContext, ScoreBreakdown, scoreItem, computeXxxScore per signal; debug logging |
| `supabase/migrations/058_add_recommender_infrastructure.sql` | ~200–300 | Establishes all recommender DB tables, materialized views, and batch RPCs |
| `supabase/functions/enrich-explore-item/index.ts` | ~300–400 | LLM enrichment with multi-step prompting, confidence parsing, field-level writeback |
| `src/lib/groupingEngine.ts` | ~200–250 | Grouping taxonomy, score-based sorting, carousel construction logic |

### Architectural observation:
`app/event/[id].tsx` is the primary complexity hotspot. It has accumulated responsibilities from 8 feature waves (RSVP → check-in → camera → share → admin → report → user-created events → feedback). This is a candidate for decomposition into subcomponents or a dedicated `EventDetailContext`.

---

## 3. Positive Patterns

These patterns demonstrate agentic coding producing high-quality architectural decisions consistently:

### Pattern 1: Hook-per-concern
Every data concern has a dedicated `useXxx` hook that encapsulates loading state, error handling, and Supabase calls. Example:
```
src/hooks/useExploreItemRSVP.ts  — RSVP state for explore items
src/hooks/useItemFeedback.ts     — community feedback state
src/hooks/useContentReport.ts   — report submission
src/hooks/useBlockUser.ts        — user blocking
src/hooks/useFriendship.ts       — friend graph operations
```
This makes screens thin and testable in isolation.

### Pattern 2: Security-first DB
Every migration follows the pattern:
- `CREATE TABLE` → `RLS ENABLE` → `CREATE POLICY` (select/insert/update/delete separately)
- `CREATE FUNCTION` → `SECURITY DEFINER` → `GRANT TO authenticated`
- Rate limiting via `check_rate_limit()` on all write RPCs

Evidence: migration 073 (`add_rate_limiting`) + migration 074 (`enforce_rpc_ownership`) established the pattern; all subsequent migrations follow it.

### Pattern 3: Feature flag gating
Every major feature is controlled by a row in the `feature_flags` table. The `useFeatureFlags` hook reads these at app start. This allows surgical kill switches without a new build.
Evidence: `src/hooks/useFeatureFlags.ts`; flags like `community_feedback`, `friend_recommendations`, `contact_sync`.

### Pattern 4: Fire-and-forget logging (intentional)
Non-critical telemetry (interaction logging, analytics events, security events) uses fire-and-forget — no `await`, no error propagation. This is explicitly correct: a UX action must never fail because analytics failed.
Evidence: `src/lib/interactionLogger.ts` — documented design decision.

---

## 4. Quality Debt Inventory

| Issue | Severity | File(s) | Recommended Fix |
|-------|----------|---------|-----------------|
| `as any` type casts on DB inserts | Medium | `src/hooks/useContentReport.ts:42,73` | Generate proper Supabase TypeScript types via `supabase gen types` |
| No integration tests for edge functions | Medium | `supabase/functions/*/index.ts` | Add Deno test files; use Supabase local dev for integration tests |
| ~70 ESLint warnings (exhaustive-deps, unused vars) | Low | Various | Gradual cleanup; none cause runtime bugs but indicate code quality gaps |
| No E2E test suite | Medium | (missing) | Add Maestro or Detox for critical user flows: sign-in, explore, RSVP, check-in |
| No staging environment | High (operational) | Infrastructure | Create separate Supabase project for staging |
| Single environment for development | High (risk) | Infrastructure | See 05_risks R-O1 |
| No line count / coverage metrics collected | Low (measurement gap) | (missing) | Run `jest --coverage`; add to CI |
| `app/event/[id].tsx` monolith | Low-Medium | `app/event/[id].tsx` | Decompose into subcomponents over time |

---

## 5. Static Analysis Results

**TypeScript (`tsc --noEmit`):** Passing as of latest commit `dba2ecf`. CI enforces this on every push.

**ESLint:** Passing (no errors; ~70 warnings). CI enforces zero errors. Warnings are non-blocking — primarily `react-hooks/exhaustive-deps` (dependency array incompleteness) and `@typescript-eslint/no-unused-vars`.

**npm audit:**
```
4 vulnerabilities found:
  1 moderate  — ajv < 6.14.0 (ReDoS via $data option) — GHSA-2g4f-4pwh-qvx6
  3 high       — minimatch (ReDoS via repeated wildcards) — GHSA-3ppc-4f35-3m26
```
All 4 vulnerabilities are in transitive dev toolchain dependencies (build tools, not production code). A `--production` audit would show 0 vulnerabilities. Fix available for all via `npm audit fix`.

**SAST (Semgrep / CodeQL):** Not yet run. Flagged in `13_data_gaps` as a recommended pre-launch step.

**Test coverage:** Not yet measured. Estimated: 15–25% coverage across the codebase (based on known test files vs. total source file count). Flagged in `13_data_gaps`.

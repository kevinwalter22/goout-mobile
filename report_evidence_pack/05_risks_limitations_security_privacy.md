# Risks, Limitations & Security/Privacy Analysis

**Supports report sections: D (quality/limitations), E (appropriability context), G (ecosystem), I (adoption barriers)**

---

## 1. Risk Register by Category

### A. Security Risks

| ID | Risk | Likelihood | Impact | Current Controls | Recommended Mitigation |
|----|------|-----------|--------|-----------------|----------------------|
| R-S1 | `as any` TypeScript casts bypass type safety — if DB input is unsanitized, could theoretically enable injection | Low (Supabase parameterizes all RPC calls server-side) | High | Supabase RPC parameterization prevents SQL injection even if TypeScript types are wrong | Remove `as any`; run `supabase gen types typescript` to generate schema-accurate types |
| R-S2 | API keys in environment variables — risk of accidental commit or leak | Low (.gitignore enforced; startup validation in `src/config/env.ts`) | Critical | `.env` in `.gitignore`; `validateEnv()` at startup | EAS secrets for all production keys; periodic key rotation |
| R-S3 | Post-audit RPC ownership gaps — new RPCs added after migration 106 may lack `assert_caller` | Medium (easy to forget) | High | Migration checklist (manual); MEMORY.md notes the pattern | Add migration checklist item to CLAUDE.md; consider a CI check that scans new SECURITY DEFINER functions |
| R-S4 | Web collector scraping may violate ToS of target sites | Medium | Legal/Operational | `docs/web_collectors.md` compliance guardrails | Legal review of each collector target before enabling |
| R-S5 | Sentry session replay — prior to `maskAllText: true` fix, could have captured PII | Low (fix applied) | High | Fix applied in current audit (Sentry SDK configured with `maskAllText: true`) | Review any existing session replays captured before the fix |

### B. Privacy / Compliance Risks

| ID | Risk | Likelihood | Impact | Current Controls | Recommended Mitigation |
|----|------|-----------|--------|-----------------|----------------------|
| R-P1 | Phone number hashing (SHA-256 + random salt) for contact sync — GDPR requires explicit consent and data minimization | Medium (if EU users) | High | UI consent gating; hashing limits exposure | Add explicit in-app consent screen before contact access; document retention limit |
| R-P2 | Location data implicit in RSVP + check-in records — no documented retention policy | Medium | Medium | Check-in distance not stored (only pass/fail result) | Document retention policy; add TTL or anonymization for old check-in records |
| R-P3 | Push tokens stored in `push_tokens` table — potential for indefinite retention | Low | Low | `removePushToken` called on sign-out (`app/_layout.tsx`); token removed on sign-out | Add TTL index or cron cleanup for stale tokens |
| R-P4 | User-generated content (posts, comments) stored indefinitely — no documented deletion policy | Medium | Medium | `delete-account` edge function exists; soft-delete via `is_deleted` flag on posts | Document content retention policy; add account deletion flow to UI |
| R-P5 | Analytics events table — may capture identifiable user behavior patterns | Low | Medium | `analytics_events` table has user_id FK; not shared externally | Review analytics schema for PII minimization; document retention |

### C. Operational Risks

| ID | Risk | Likelihood | Impact | Current Controls | Recommended Mitigation |
|----|------|-----------|--------|-----------------|----------------------|
| R-O1 | No staging environment — all development deploys to production Supabase | Medium | Catastrophic | Developer caution; migration review | Create separate staging Supabase project; EAS preview profile |
| R-O2 | Edge function failures are silent — enrichment pipeline has no alerting | High (transient API failures are common) | Data quality degradation | Pipeline health log table (migration 033) | Add Sentry alerts for edge function error rates; dead-letter queue for failed enrichments |
| R-O3 | `submit_item_feedback` RPC refreshes materialized view synchronously — blocks under load | Low (low current scale) | Medium | Feature flag can disable | Move mat view refresh to async trigger or scheduled job |
| R-O4 | No documented incident response playbook | Medium | Varies | Sentry for detection; Supabase dashboard for DB | Create runbook: on-call contacts, escalation, rollback procedure, communication template |
| R-O5 | Single point of failure (solo founder) — no bus factor | High (inherent) | Operational continuity | Comprehensive documentation (50+ docs) | Document codebase; create onboarding guide; consider adding a second engineer |

### D. Product / AI-Generated Logic Risks

| ID | Risk | Likelihood | Impact | Current Controls | Recommended Mitigation |
|----|------|-----------|--------|-----------------|----------------------|
| R-A1 | LLM enrichment may hallucinate incorrect descriptions, tags, or hours | Medium | Data quality; user trust | Confidence scoring (migration 030); quality gate; admin suppression | Human spot-check of enriched items; feedback loop from user reports |
| R-A2 | Agent introduces edge cases not anticipated by human or agent | Medium | Silent bugs in production | CI typecheck/lint; physical device testing | E2E test suite (Maestro/Detox); broader unit test coverage |
| R-A3 | "Unknown unknowns" in agent-generated code — human reviewer may not understand why a code path exists | Medium | Debugging burden | Commit messages + docs are agent-generated and generally explanatory | Document complex logic with inline comments; maintain architecture docs |
| R-A4 | Recommender weight misconfiguration — weights must sum to 1.0; dev assertion only | Low (assertion in code) | Incorrect ranking | Dev assertion in `recommenderConfig.ts` | Add runtime assertion or CI test that validates sum = 1.0 exactly |

### E. Team / Process Risks

| ID | Risk | Likelihood | Impact | Current Controls | Recommended Mitigation |
|----|------|-----------|--------|-----------------|----------------------|
| R-T1 | Solo founder = no code review by second human | High (structural) | Bugs reach production unchallenged | CI quality gates; agent self-review | Hire first engineer; or use async code review services |
| R-T2 | Approval fatigue — high volume of agent-generated code may lead to rubber-stamp review | Medium | Regression risk increases | Structured review checklists (being established) | Timeboxed review sessions; focus review on security-sensitive changes |
| R-T3 | Skill atrophy — heavy agent reliance reduces founder's ability to maintain code independently | Low (founder remains technically engaged) | Long-term maintainability | Founder reviews all diffs | Maintain direct implementation skills on at least 1 feature per quarter |

---

## 2. Top 10 Prioritized Risks

| Rank | Risk ID | Description | Priority Score (Likelihood × Impact) | Urgency |
|------|---------|-------------|--------------------------------------|---------|
| 1 | R-O1 | No staging environment | High × Catastrophic | Before scaling |
| 2 | R-T1 | Solo founder, no second reviewer | High × High | Ongoing |
| 3 | R-O2 | Silent edge function failures | High × Medium | Pre-launch |
| 4 | R-A1 | LLM hallucination in enrichment data | Medium × High | Pre-launch |
| 5 | R-A2 | Undetected edge cases from agent code | Medium × High | Pre-launch |
| 6 | R-P1 | GDPR: phone contact sync consent | Medium × High | Pre-launch (if EU) |
| 7 | R-S3 | New RPC ownership gaps (post-audit) | Medium × High | Ongoing |
| 8 | R-O4 | No incident response playbook | Medium × Varies | Pre-launch |
| 9 | R-S4 | Web collector ToS compliance | Medium × Legal | Pre-launch |
| 10 | R-P4 | No content retention policy documented | Medium × Medium | 90 days post-launch |

---

## 3. Near-Miss Examples (Detectable from Git History)

### Near-Miss 1: Missing `assert_caller` on Push Notification RPCs
**What happened:** Migration 084 (`push_notifications`, created during data pipeline work) added three SECURITY DEFINER RPCs: `upsert_push_token`, `remove_push_token`, and `update_notification_preferences`. These were created after the `assert_caller` pattern was established in migration 074, but the new migration did not include the guard.

**Risk during the gap:** An attacker could have called `upsert_push_token(victim_user_id, attacker_device_token, 'ios')` to register their device for another user's push notifications — receiving the victim's event reminders and friend request alerts.

**Resolution:** Migration 106 (`fix_rpc_ownership_checks`) caught this gap during the security audit and added `assert_caller(p_user_id)` to all three functions.

**Lesson for agentic systems:** Patterns established in early migrations (074) are not automatically applied to later migrations (084) created in a different session. This is a class of "cross-session consistency" bug unique to agentic development.

### Near-Miss 2: Duplicate Migration Number
**What happened:** Two migrations were inadvertently assigned number `023`. This would cause migration runner failures (duplicate filename detection) when deploying to production.

**Resolution:** Commit `93f2d6e` — "fix: rename duplicate migration 023 to 027" — caught and corrected the numbering.

**Lesson:** Sequential migration numbering is a human-coordination task that agents can get wrong across sessions if they don't check existing files before creating new ones. MEMORY.md should record "current highest migration number."

### Near-Miss 3: Deprecated Deno Hash Import in Edge Function
**What happened:** An edge function used a Deno-specific hash import (`https://deno.land/std/hash/...`) that was deprecated in newer Deno versions. This would have caused a runtime failure on Supabase's Deno runtime upgrade.

**Resolution:** Commit `9bb1736` — "fix: replace deprecated deno hash import with Web Crypto API" — replaced with the standards-compliant `crypto.subtle` API.

**Lesson:** Edge function dependencies on specific runtime versions are a subtle failure mode. The agent used a valid import at the time of writing, but the import became invalid due to an upstream change. CI does not currently run edge function tests — a gap flagged in quality assessment.

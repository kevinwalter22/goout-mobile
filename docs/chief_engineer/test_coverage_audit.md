# Test Coverage Audit — Phase 4

_Chief Engineer Setup, Phase 4. Snapshot date: 2026-06-18._

Goal of this audit: catalog what is tested today, identify the critical paths
that have no safety net, and define the gaps Phase 4 closes. The bar is "tests
cover what would actually break," not a coverage percentage.

---

## 1. What existed before Phase 4

### Unit tests (Jest + `jest-expo`)

Config: `jest.config.js` — `testMatch: **/__tests__/**/*.test.ts?(x)`, no setup
file, no Supabase/Expo mocks. Run with `npm test`. Baseline: **8 suites, 364
tests, all green.**

| Suite | Covers |
| --- | --- |
| `src/lib/moderation/__tests__/policy.test.ts` | Moderation policy classification |
| `src/lib/moderation/__tests__/textModeration.test.ts` | `moderateText`, `checkBeforeSubmit`, `shouldEscalateToLLM` |
| `src/lib/moderation/__tests__/moderation-coverage.test.ts` | 40+ extended moderation cases |
| `src/utils/__tests__/formatOpeningHours.test.ts` | `parseScheduleText` / `formatOpeningHours` (partial) |
| `src/lib/__tests__/enrichmentClassification.test.ts` | audience_fit / is_event_venue scoring multipliers |
| `src/lib/__tests__/scoring.test.ts` | community feedback + freshness signals + weight-sum invariant |
| `src/lib/__tests__/groupingEngine.test.ts` | grouping quality gates |
| `__tests__/exploreFilters.test.ts` | explore filter state + normalization |

### Integration-ish runners (bespoke, not Jest)

- `security-tests/run.ts` (`npm run security:test`) — RLS isolation, RPC auth,
  edge-function auth, storage isolation, rate limiting. Hits real Supabase via
  `tsx`; reads two non-admin accounts from env.
- `preflight-tests/run.ts` (`npm run test:preflight`) — broad app-store-style
  E2E across auth/content/moderation/enforcement/storage/edge-auth. Loads
  `.env.local`, uses a `RUN_ID` namespace + service-role cleanup.

These are valuable but: (a) not wired into a standard `test:integration` entry,
(b) point at whatever project `.env.local` names (historically prod), and (c)
don't cover the data-plane critical paths below.

### Extractor fixture tests

- `supabase/functions/_shared/llm-extractor.ts` + 10 fixtures under
  `_shared/__fixtures__/`, runner `scripts/llm_extractor_test.ts` (`tsx`, real
  Anthropic API). Recall/precision gates. Not in CI (costs API tokens).

### Phase 2 Sentry smoke stub

- `supabase/functions/_shared/sentry_smoke_test.ts` — `Deno.test`, `ignore: true`,
  left to be activated in Phase 4.

---

## 2. Critical paths and their coverage status (before Phase 4)

| Critical path | Source | Covered? | Risk if it breaks |
| --- | --- | --- | --- |
| Post creation geo+time invariant (migration 137 trigger) | `137_enforce_post_verification.sql`, `app/checkin/camera.tsx`, `src/utils/location.ts` | ❌ none | Unverified posts accepted, or all posts rejected — corrupts the core "proof you were there" guarantee |
| `engagement_log` fire-off on verified post | 137 AFTER-INSERT trigger, `compute_funnel_chain` | ❌ none | Silent loss of the funnel data the Phase 1 ranker trains on |
| Engagement logging endpoint validation | `supabase/functions/log-engagement` | ❌ none | Bad batches accepted, or valid telemetry dropped |
| Engagement client buffer + sampling + dedup | `src/lib/engagementBuffer.ts` | ❌ none | Over/under-sampling silently skews training data |
| Ingest: normalize-raw-events | `supabase/functions/normalize-raw-events` | ❌ none | Malformed `explore_items` reach the feed |
| Ingest: enrichment apply | `supabase/functions/run-enrichment-queue`, `apply_enrichment` | ❌ none | Enrichment clobbers good fields |
| LLM extractor | `_shared/llm-extractor.ts` | ✅ fixtures (manual) | Recall/precision regressions |
| RSVP + unsave | `src/hooks/useExploreItemRSVP.ts` | ❌ none | RSVP counts wrong; expiry logic for activities silently broken |
| Distance filter + strict null-coord gate | `src/lib/exploreQuery.ts` (`applyDistanceFilter`) | ❌ none | Null-coord events leak into feed (the "45 null-coord" data-quality signal makes this live) |
| Scoring engine incl. chain penalty | `src/lib/scoring.ts` | ⚠️ partial (2 of 12 signals) | Mis-ranking; chain venues flood the feed |
| Civic filter | `supabase/functions/_shared/civic-filter.ts` | ❌ none | Zoning-board meetings surface as "events" (the exact bug civic-filter was added to kill) |
| Hours formatting (`parseScheduleText`) | `src/utils/formatOpeningHours.ts` | ⚠️ partial | **Broken 3× historically.** Wrong "Open/Closed now" shown to users |

---

## 3. Gaps Phase 4 closes

**New integration infrastructure** (`integration-tests/`, `jest.integration.config.js`):
staging-only (prod-safety guard), per-run namespace, seed → operate → assert →
cleanup. Run with `npm run test:integration`.

**New / expanded suites:**

- Unit (fast, `npm test`):
  - Scoring: all signals exercised + **chain penalty** (the 0.5× multiplier and
    its search/friend escape hatches).
  - `parseScheduleText` / `formatOpeningHours`: comprehensive — every branch
    (closed, 24h, inherited AM/PM, en/em-dash, malformed) given its history.
  - Civic filter: title patterns + venue+title combos + the "Memorial Day Parade
    at Town Hall is NOT civic" guards.
  - Distance filter + strict null-coord gate: the `!lat || !lng` drop, 50-mile
    floor, search override, distance sort tie-break.
  - Engagement buffer: sampling (100% conversions / 25% impressions / cold-start
    / previously-engaged), dedup window, flush triggers.
- Integration (staging, `npm run test:integration`):
  - Post creation: 137 rejects unverified, accepts verified, and the verified
    insert produces an `engagement_log` `post_at_event` row.
  - `log-engagement`: batch-size, user-id match, event_type allowlist,
    `occurred_at` window, returns rejections without poisoning the batch.
  - RSVP + unsave round-trips against `explore_item_rsvps`.
  - normalize-raw-events + enrichment apply against real rows.
- Sentry smoke test activated (`supabase/functions/_shared/sentry_smoke_test.ts`).
- LLM extractor fixtures verified to still pass.

---

## 4. Deliberately not covered (and why)

- **UI rendering / navigation** — out of scope for this phase; the value is in
  the data-plane invariants, not snapshot tests of screens.
- **LLM extractor in CI** — costs real Anthropic tokens per run; kept as an
  opt-in script (`npm run test:extractor`), not in `test:all`.
- **Auth / RLS deep matrix** — already owned by `security-tests` and
  `preflight-tests`; Phase 4 does not duplicate them.

See `docs/chief_engineer/testing.md` for the philosophy and the gating policy
that keeps this from rotting.

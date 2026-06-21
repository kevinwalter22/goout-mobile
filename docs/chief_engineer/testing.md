# Testing — philosophy, how-to, and gating policy

_Chief Engineer Setup, Phase 4. Owner: whoever touches the code next._

This is the safety net that lets future work (human or autonomous) move fast
without silently breaking the things that matter. Read this before adding a
feature or an edge function.

---

## Philosophy

1. **Test what would actually break, not coverage percentages.** A green 90%
   number that misses the migration-137 trigger is worthless. One integration
   test that proves the trigger rejects an unverified post is worth more than
   fifty component snapshots.
2. **Invariants over implementation.** Assert the contract ("a post linked to an
   explore_item must carry verification proof"), not the line of code that
   happens to enforce it today. Tests should survive a refactor.
3. **The data plane is the product.** Euda's value is correct, verified,
   well-ranked content. The highest-value tests live on: post verification,
   engagement logging, ingest/normalize/enrich, ranking, and the feed gates
   (distance, null-coord, civic, hours).
4. **Fast by default, slow on purpose.** Unit tests run in seconds with no
   network so nobody is tempted to skip them. Integration tests hit staging and
   are opt-in for the slower, higher-confidence pass.
5. **Tests clean up after themselves.** Anything an integration test creates is
   namespaced and deleted in `afterAll`. A failed test must not leave staging
   dirty for the next run.

---

## The three tiers

| Command | What runs | Speed | Network | When |
| --- | --- | --- | --- | --- |
| `npm test` | Jest unit (`**/__tests__/**/*.test.ts(x)`) | seconds | none | Every change; pre-commit; CI on every push |
| `npm run test:integration` | Jest against **staging** (`integration-tests/**/*.integration.test.ts`) | ~30s–2min | staging Supabase | Before merging anything that touches the data plane or an edge function |
| `npm run test:all` | unit then integration | combined | staging | Before a release / promotion |
| `npm run test:extractor` | LLM extractor fixtures (real Anthropic API) | minutes, costs ~$0.05 | Anthropic | When changing `llm-extractor.ts` or its prompts |

Unit and integration are separate Jest configs on purpose:

- `jest.config.js` — `jest-expo` preset (RN environment), excludes
  `integration-tests/`.
- `jest.integration.config.js` — Node environment (no RN runtime needed to call
  Supabase), `maxWorkers: 1` (deterministic teardown on shared staging tables),
  30s timeout (network + edge cold starts).

---

## Integration test harness

Everything lives in `integration-tests/`:

```
integration-tests/
  _helpers/
    env.ts         # loads .env.staging (fallback .env.local), HARD-REFUSES prod
    client.ts      # adminClient() [service-role], anonClient() [RLS]
    namespace.ts   # newNamespace(prefix), testUserEmail(ns)
    seed.ts        # createTestUser / insertExploreItem / cleanupNamespace
  *.integration.test.ts
```

**Safety guard (non-negotiable):** `assertStagingEnv()` throws if the configured
URL is the production project ref. Integration tests seed and delete rows; they
must never run against prod. Migration 137 / sacred prod data is protected by
this guard, not by convention.

**Credentials:** read from `.env.staging` (`STAGING_SUPABASE_URL`,
`STAGING_SERVICE_ROLE_KEY`, `STAGING_SUPABASE_ANON_KEY`) with a fallback to the
`SUPABASE_STAGING_*` keys in `.env.local`. Never hard-code keys; a missing key
fails the run loudly.

**The pattern** — seed → operate → assert → clean up, all namespaced:

```ts
import { adminClient } from "./_helpers/client";
import { newNamespace } from "./_helpers/namespace";
import { insertExploreItem, createTestUser, cleanupNamespace } from "./_helpers/seed";

describe("my critical path", () => {
  const ns = newNamespace("myfeature");
  const admin = adminClient();
  let userId: string;
  let itemId: string;

  beforeAll(async () => {
    userId = (await createTestUser(admin, ns)).id;
    itemId = (await insertExploreItem(admin, ns)).id;
  });

  afterAll(async () => {
    await cleanupNamespace(admin, ns); // deletes ONLY this run's rows
  });

  it("does the thing", async () => {
    // ...operate via admin/anon client, then assert server state
  });
});
```

Why namespaces: parallel CI runs and local re-runs must not collide, and cleanup
must delete exactly what a run created — never a real row. The namespace string
is woven into test-user emails (`it_<ns>@euda-test.invalid`) and
`explore_items.external_id` so `cleanupNamespace` can target precisely.

---

## How to write tests for a new feature

1. **Name the invariant.** What must always be true? ("Only verified posts get
   an engagement_log row.") That sentence is your test's `it(...)`.
2. **Pick the tier.** Pure function / client logic → unit. Anything that crosses
   into Postgres, a trigger, RLS, or an edge function → integration.
3. **Cover the failure mode, not just the happy path.** The bug that ships is the
   rejected case you didn't assert. Test the reject, the null, the boundary.
4. **For data-plane work, assert server state**, not the client return value.
   Insert, then read it back with the admin client and check what Postgres
   actually stored / what the trigger actually did.
5. **Clean up.** Use `cleanupNamespace` in `afterAll`. If you create a row type
   the helper doesn't yet handle, extend `cleanupNamespace` — don't leave it.

---

## Gating policy

- **Unit tests must be green to merge anything.** `npm test` is the floor.
- **New edge functions and any change to a DB trigger / RPC on the data plane
  require an integration test before merge to `staging`.** No exceptions for
  "it's small" — silent data-plane failures are exactly what cost us 3 months of
  ingestion once (see PROJECT_STATE §7 tech-debt #5). If a function genuinely
  can't be integration-tested, say why in the PR.
- **Touching a previously-broken area carries a higher bar.** `parseScheduleText`
  has broken three times; any change there must add cases for the branch you
  touched.
- **`test:all` before a staging→main promotion.**
- **`test:extractor` when you change extractor prompts or parsing** — it costs
  real tokens, so it's not in `test:all`, but a prompt change is meaningless
  without it.

---

## Known constraints

- Integration tests depend on staging edge functions being deployed. If a
  function under test was just changed, `supabase functions deploy <name>`
  against staging first.
- `supabase.ts` generated types lag migrations (see MEMORY); integration tests
  use `as any` casts for new tables/RPCs until `supabase gen types` is run.
- The Sentry smoke test (`_shared/sentry_smoke_test.ts`) needs `SENTRY_DSN_EDGE`
  set in the run env, and to assert delivery it needs a Sentry read token; see
  that file's header for how it degrades when the token is absent.

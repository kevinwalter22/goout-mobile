// Sentry edge smoke test — STUB (Chief Engineer Phase 2).
//
// Intentionally a Deno test that lives OUTSIDE the jest match pattern
// (**/__tests__/**/*.test.ts) and outside any __tests__ dir, so the mobile
// jest suite never tries to run it. It is also `ignore: true` so a manual
// `deno test` run won't fail on the missing test DSN.
//
// ACTIVATED IN PHASE 4 (integration test suite): flip `ignore` to false, set
// SENTRY_DSN_EDGE to a throwaway test project's DSN, throw a known error
// through captureEdgeException, then assert via the Sentry API that an event
// with tag function="smoke-test" arrived. Until then this documents intent.

import { captureEdgeException, SENTRY_ENABLED } from "./sentry.ts";

Deno.test({
  name: "captureEdgeException delivers a tagged event (Phase 4)",
  ignore: true, // remove in Phase 4 once an integration test DSN exists
  fn: async () => {
    await captureEdgeException(new Error("Euda edge smoke test — safe to ignore"), {
      function: "smoke-test",
      tags: { smoke: "true" },
    });
    // Phase 4: poll the Sentry events API and assert the event is present.
    if (!SENTRY_ENABLED) {
      throw new Error("SENTRY_DSN_EDGE not configured for the smoke test");
    }
  },
});

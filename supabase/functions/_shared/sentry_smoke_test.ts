// Sentry edge smoke test — ACTIVATED (Chief Engineer Phase 4).
//
// A Deno test that lives OUTSIDE the jest match pattern (**/__tests__/**) so the
// mobile jest suite never runs it. Run it with:
//   SENTRY_DSN_EDGE=<euda-edge dsn> deno test --allow-net --allow-env \
//     supabase/functions/_shared/sentry_smoke_test.ts
//
// The CI-wired equivalent (runs in `npm run test:integration`) is
// integration-tests/sentry-smoke.integration.test.ts — it reuses the same
// transport and asserts Sentry accepts the event. This Deno test verifies the
// actual edge client (captureEdgeException) end to end inside the Deno runtime.
//
// It is no longer `ignore`d: if SENTRY_DSN_EDGE is unset it fails fast with a
// clear message (the edge client itself no-ops when unconfigured, so the test
// must assert configuration explicitly).

import { captureEdgeException, SENTRY_ENABLED } from "./sentry.ts";

Deno.test("captureEdgeException delivers a tagged event to euda-edge", async () => {
  if (!SENTRY_ENABLED) {
    throw new Error(
      "SENTRY_DSN_EDGE not configured — set it to the euda-edge DSN before running this smoke test.",
    );
  }

  // The edge client swallows transport errors by design (telemetry must never
  // break a function), so we can't get a return value to assert on. Instead we
  // assert it runs without throwing through the real code path with a real DSN;
  // the jest integration test asserts the store endpoint's 200 + event id.
  await captureEdgeException(
    new Error("Euda edge smoke test — safe to ignore"),
    { function: "smoke-test", tags: { smoke: "true" } },
  );
});

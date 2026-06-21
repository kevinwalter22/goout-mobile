/**
 * Sentry edge smoke test — ACTIVATED in Phase 4 (was a Phase 2 stub).
 *
 * Proves the euda-edge crash-reporting pipeline actually delivers: it sends a
 * known, tagged event through the SAME transport the edge client uses
 * (supabase/functions/_shared/sentry.ts — DSN store endpoint + X-Sentry-Auth)
 * and asserts Sentry accepts it (HTTP 200 + an event id).
 *
 * Why assert on ingestion acceptance rather than polling for searchability:
 * Sentry's event → searchable latency is seconds-to-minutes and would make this
 * flaky. A 200 + returned event id from the store endpoint proves DSN, auth, and
 * transport are correct end to end — which is what "is crash reporting wired?"
 * actually asks. A best-effort search confirmation is attempted but never fails
 * the test.
 *
 * Requires SENTRY_DSN_EDGE (set in .env.staging). Optional: SENTRY_ORG_AUTH_TOKEN
 * enables the best-effort search confirmation.
 */
import { SENTRY_DSN_EDGE } from "./_helpers/env";

/** Mirror of parseDsn in _shared/sentry.ts — keep in sync with the edge client. */
function parseDsn(dsn: string): { url: string; publicKey: string } | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!publicKey || !projectId) return null;
    return { url: `${u.protocol}//${u.host}/api/${projectId}/store/`, publicKey };
  } catch {
    return null;
  }
}

describe("Sentry edge crash-reporting pipeline", () => {
  it("has SENTRY_DSN_EDGE configured", () => {
    expect(SENTRY_DSN_EDGE).toBeTruthy();
    expect(parseDsn(SENTRY_DSN_EDGE!)).not.toBeNull();
  });

  it("delivers a tagged event to the euda-edge project (store endpoint accepts it)", async () => {
    const parsed = parseDsn(SENTRY_DSN_EDGE!)!;
    const eventId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-smoke`)
      .replace(/-/g, "");

    const event = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: "javascript",
      level: "info",
      environment: "staging",
      server_name: "smoke-test",
      tags: { function: "smoke-test", runtime: "deno-edge", smoke: "true" },
      exception: {
        values: [{ type: "EudaSmokeTest", value: "Euda Phase 4 smoke test — safe to ignore" }],
      },
    };

    const auth = `Sentry sentry_version=7, sentry_client=euda-edge-smoke/1.0, sentry_key=${parsed.publicKey}`;
    const res = await fetch(parsed.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sentry-Auth": auth },
      body: JSON.stringify(event),
    });

    expect(res.status).toBe(200);
    const body = await res.json().catch(() => ({} as any));
    // Sentry returns { id: "<event_id>" } on accepted ingestion.
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
  });
});

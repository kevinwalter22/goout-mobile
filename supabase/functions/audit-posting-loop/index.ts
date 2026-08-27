/**
 * audit-posting-loop — Posting-loop-health scorer (Phase 3 · Act 1 instrumentation).
 *
 * Returns the "are people actually posting?" scorecard as { current, previous }
 * (this 7-day window vs. the prior 7-day window) so the weekly auditor worker can
 * narrate the delta AND propose a fix if the loop looks unhealthy (an unused
 * route, verification failing often, high abandonment, or errors).
 *
 * Read-only: it only calls the posting_loop_health() RPC (migration 175) — no
 * writes, no snapshot table (the two windows are computed directly; the posts
 * table is small). Service-role only. Like the other audit-* functions it does
 * NOT post to Slack — the auditor composes the #euda-chief report from this JSON.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  const cors = getCorsHeaders(req);

  const auth = requireServiceRole(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.error === "Forbidden" ? 403 : 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = Date.now();
    const curSince = new Date(now - 7 * DAY_MS).toISOString();
    const curUntil = new Date(now).toISOString();
    const prevSince = new Date(now - 14 * DAY_MS).toISOString();
    const prevUntil = curSince;

    const [cur, prev] = await Promise.all([
      supabase.rpc("posting_loop_health", { p_since: curSince, p_until: curUntil }),
      supabase.rpc("posting_loop_health", { p_since: prevSince, p_until: prevUntil }),
    ]);
    if (cur.error) throw cur.error;
    if (prev.error) throw prev.error;

    return new Response(
      JSON.stringify({
        ok: true,
        generated_at: curUntil,
        window_days: 7,
        current: cur.data,
        previous: prev.data,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("audit-posting-loop error:", error);
    await captureEdgeException(error, { function: "audit-posting-loop" });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});

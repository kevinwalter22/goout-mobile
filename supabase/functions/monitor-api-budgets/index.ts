/**
 * monitor-api-budgets (Phase 3b) — cron hourly.
 * Checks api_usage_counters usage vs limit for the current period:
 *   >= 50% → info, >= 80% → warning, >= 95% → critical.
 * Catches runaway LLM / API spend before it hits the hard cap.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { notify, type Severity } from "../_shared/notify.ts";

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
    // Current-period counters (latest period_start per service).
    const { data, error } = await supabase
      .from("api_usage_counters")
      .select("service, period_start, requests_used, requests_limit")
      .order("period_start", { ascending: false })
      .limit(200);
    if (error) throw error;

    const seen = new Set<string>();
    const fields: Record<string, string> = {};
    let topSeverity: Severity | null = null;
    const breaches: string[] = [];
    const rank: Record<Severity, number> = { info: 1, warning: 2, error: 3, critical: 4 };

    for (const r of data ?? []) {
      if (seen.has(r.service)) continue; // keep only latest period per service
      seen.add(r.service);
      const limit = r.requests_limit ?? 0;
      if (!limit) continue;
      const pct = (r.requests_used / limit) * 100;
      fields[r.service] = `${r.requests_used}/${limit} (${pct.toFixed(0)}%)`;
      let sev: Severity | null = null;
      if (pct >= 95) sev = "critical";
      else if (pct >= 80) sev = "warning";
      else if (pct >= 50) sev = "info";
      if (sev) {
        breaches.push(`${r.service}: ${pct.toFixed(0)}%`);
        if (!topSeverity || rank[sev] > rank[topSeverity]) topSeverity = sev;
      }
    }

    if (topSeverity) {
      await notify(topSeverity, "API budget threshold reached", {
        text: breaches.map((b) => `• ${b}`).join("\n"),
        fields,
        context: "monitor-api-budgets",
      });
    }

    return new Response(
      JSON.stringify({ ok: true, services: seen.size, usage: fields, alerted: topSeverity }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("monitor-api-budgets error:", error);
    await captureEdgeException(error, { function: "monitor-api-budgets" });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});

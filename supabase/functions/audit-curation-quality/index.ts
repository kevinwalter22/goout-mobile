/**
 * audit-curation-quality — Quality Audit Loop scorer (North Star §5, §7).
 *
 * Computes the deterministic Level-1/Level-2 curation scorecard (via the
 * compute_curation_scorecard() RPC from migration 153), persists a daily
 * snapshot to curation_audit for week-over-week trend, and returns the current
 * scorecard PLUS the previous snapshot so the weekly auditor worker can narrate
 * the delta.
 *
 * Read-only over the catalog; the only write is its own snapshot row (idempotent
 * per day). Service-role only. It deliberately does NOT post to Slack — the
 * auditor worker composes the #euda-chief report from this JSON, so we keep the
 * #euda-monitoring alert stream clean (Decision 3).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

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

    // 1. Compute the current scorecard (deterministic, entirely in SQL).
    const { data: current, error: scErr } = await supabase.rpc("compute_curation_scorecard");
    if (scErr) throw scErr;

    const cat = (current as Record<string, any>)?.catalog ?? {};
    const today = new Date().toISOString().slice(0, 10);

    // 2. Most-recent prior snapshot (for the week-over-week delta).
    const { data: prevRows, error: pErr } = await supabase
      .from("curation_audit")
      .select(
        "snapshot_date, card_ready_pct, avg_completeness_pct, avg_event_freshness_pct, avg_notability_confidence, scorecard",
      )
      .eq("scope", "catalog")
      .lt("snapshot_date", today)
      .order("snapshot_date", { ascending: false })
      .limit(1);
    if (pErr) throw pErr;
    const previous = prevRows?.[0] ?? null;

    // 3. Upsert today's snapshot (idempotent — re-running the same day overwrites).
    const row = {
      snapshot_date: today,
      scope: "catalog",
      total_items: cat.total_items ?? 0,
      card_ready_items: cat.card_ready_items ?? 0,
      card_ready_pct: cat.card_ready_pct ?? null,
      avg_completeness_pct: cat.avg_completeness_pct ?? null,
      avg_event_freshness_pct: cat.avg_event_freshness_pct ?? null,
      avg_notability_confidence: cat.avg_notability_confidence ?? null,
      scorecard: current,
    };
    const { error: upErr } = await supabase
      .from("curation_audit")
      .upsert(row, { onConflict: "snapshot_date,scope" });
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({ ok: true, snapshot_date: today, current, previous }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("audit-curation-quality error:", error);
    await captureEdgeException(error, { function: "audit-curation-quality" });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});

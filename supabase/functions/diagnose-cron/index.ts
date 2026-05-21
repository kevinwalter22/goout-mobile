/**
 * diagnose-cron — service-role-only diagnostic + fix for pg_cron health.
 *
 * Modes (via POST body { mode }):
 *   "diagnose" (default) — read-only snapshot of pg_cron state
 *   "fix"                — ALTER DATABASE to set app.supabase_url
 *                          and app.service_role_key (idempotent)
 *
 * Auth: service-role only.
 *
 * Uses deno-postgres via SUPABASE_DB_URL to access the cron.* schema
 * (PostgREST exposes only the public schema; supabase-js can't reach
 * cron.job or cron.job_run_details).
 *
 * This function is intended to be deleted after the diagnostic is complete.
 */

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  const corsHeaders = getCorsHeaders(req);

  const auth = requireServiceRole(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.error === "Forbidden" ? 403 : 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { mode?: string; supabase_url?: string; service_role_key?: string; jobs?: Array<{ name: string; schedule: string; endpoint: string; payload: string }> } = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      // empty body OK
    }
  }
  const mode = body.mode ?? "diagnose";

  const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DB_URL");
  if (!dbUrl) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_DB_URL not set" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sql = postgres(dbUrl, { max: 1, prepare: false, ssl: "require" });
  const result: Record<string, unknown> = { mode };

  try {
    if (mode === "fix") {
      const url = body.supabase_url ?? "https://lkmntknpaiaiqvupzjbz.supabase.co";
      const key = body.service_role_key;
      if (!key) {
        return new Response(
          JSON.stringify({ error: "service_role_key required in fix mode" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!/^https:\/\/[\w.-]+\.supabase\.co$/.test(url)) {
        return new Response(
          JSON.stringify({ error: "supabase_url must match https://*.supabase.co" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!/^[A-Za-z0-9_\-.]+$/.test(key)) {
        return new Response(
          JSON.stringify({ error: "service_role_key contains unexpected characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ALTER DATABASE persists across sessions; pg_cron opens a fresh
      // connection per job invocation, so the next tick reads the new values.
      // ALTER DATABASE is locked by Supabase for custom params (perm denied
      // even for supabase_admin). Workaround: rewrite each cron job's
      // command to embed the URL + key as literals.
      const jobsToFix = body.jobs ?? [
        { name: "fetch-coordinator-run", schedule: "*/30 * * * *", endpoint: "fetch-coordinator", payload: '{"max_fetches": 3}' },
        { name: "normalize-new-events", schedule: "*/15 * * * *", endpoint: "normalize-raw-events", payload: '{"max_items": 100}' },
        { name: "enrich-new-items", schedule: "5,35 * * * *", endpoint: "run-enrichment-queue", payload: '{"max_items": 10}' },
        { name: "web-collector-run", schedule: "*/30 * * * *", endpoint: "ingest-web-collector", payload: '{"max_targets": 10}' },
        { name: "discover-venues-hourly", schedule: "0 * * * *", endpoint: "discover-venues-to-crawl", payload: '{"max_per_run": 50}' },
        { name: "ingest-venue-website-run", schedule: "15 * * * *", endpoint: "ingest-venue-website", payload: '{"max_per_run": 5}' },
      ];
      result.fixes = [];
      for (const job of jobsToFix) {
        try {
          const command = `
            SELECT net.http_post(
              url := '${url}/functions/v1/${job.endpoint}',
              headers := jsonb_build_object(
                'Authorization', 'Bearer ${key}',
                'Content-Type', 'application/json'
              ),
              body := '${job.payload}'::jsonb
            )`;
          await sql.unsafe(`SELECT cron.schedule('${job.name}', '${job.schedule}', $cmd$${command}$cmd$)`);
          (result.fixes as any[]).push({ job: job.name, ok: true });
        } catch (e) {
          (result.fixes as any[]).push({
            job: job.name,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      result.note =
        "Rewrote cron commands with literal URL + auth token (cron.schedule replaces existing jobs). " +
        "Next scheduled tick should succeed.";
    }

    // Always return diagnostic snapshot.
    result.pg_cron_ext = await sql`SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net')`;
    try {
      const settings = await sql`
        SELECT
          current_setting('app.service_role_key', true) AS service_role_key,
          current_setting('app.supabase_url', true)     AS supabase_url`;
      const row = settings[0];
      result.session_settings = {
        service_role_key_set: !!(row.service_role_key && row.service_role_key.length > 10),
        service_role_key_length: (row.service_role_key ?? "").length,
        supabase_url: row.supabase_url ?? null,
      };
    } catch (e) {
      result.settings_error = e instanceof Error ? e.message : String(e);
    }

    // Database-level persisted settings (visible to all new connections)
    try {
      const dbSettings = await sql`
        SELECT unnest(s.setconfig) AS setting
        FROM pg_db_role_setting s
        JOIN pg_database d ON d.oid = s.setdatabase
        WHERE d.datname = 'postgres' AND s.setrole = 0`;
      result.db_level_settings = dbSettings.map((r) => {
        const setting = r.setting as string;
        if (setting.startsWith("app.service_role_key=")) {
          return `app.service_role_key=<${setting.length - 22} chars>`;
        }
        return setting;
      });
    } catch (e) {
      result.db_level_settings_error = e instanceof Error ? e.message : String(e);
    }

    try {
      const runs = await sql`
        SELECT jobid, status, return_message, start_time
        FROM cron.job_run_details
        WHERE start_time > NOW() - INTERVAL '15 minutes'
        ORDER BY start_time DESC
        LIMIT 30`;
      result.recent_runs = runs;
    } catch (e) {
      result.recent_runs_error = e instanceof Error ? e.message : String(e);
    }

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end();
  }
});

-- 138_schema_drift_catchup.sql
--
-- Chief Engineer Phase 3a — catch-up for production schema drift found by
-- comparing prod (lkmntknpaiaiqvupzjbz) vs the cleanly-replayed staging
-- (baulipaydofqtkihkghj). See docs/chief_engineer/schema_drift_audit.md.
--
-- Every statement is idempotent and a NO-OP on production (which already has
-- these objects/state). Effect on staging: brings it to parity with prod AND
-- captures these previously-dashboard-only objects in the migration set so the
-- schema is reproducible from migrations alone (resolves tech debt #10).

-- 1) pg_net extension (prod has it in the `extensions` schema; used by cron
--    HTTP calls). Staging was missing it.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2) RLS on the legacy `events` table. 000_legacy_baseline created the table
--    but not its RLS; prod has RLS enabled + a public-read policy.
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events are readable by everyone" ON public.events;
CREATE POLICY "events are readable by everyone"
  ON public.events FOR SELECT TO public USING (true);

-- 3) get_pipeline_health(text): prod-only admin helper (wraps the v_* health
--    views), never captured in a migration. Reconstructed verbatim from prod.
CREATE OR REPLACE FUNCTION public.get_pipeline_health(p_view text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF p_view = 'targets' THEN
    RETURN (SELECT jsonb_agg(row_to_json(t)) FROM v_collector_target_health t);
  ELSIF p_view = 'stages' THEN
    RETURN (SELECT jsonb_agg(row_to_json(t)) FROM v_pipeline_stage_health t);
  ELSIF p_view = 'activity' THEN
    RETURN (SELECT jsonb_agg(row_to_json(t)) FROM v_ingestion_activity t);
  ELSE
    RAISE EXCEPTION 'Unknown view: %', p_view;
  END IF;
END;
$function$;

-- 4) invoke_cleanup_orphaned_media(): prod was hand-patched to read config from
--    the app_config table instead of current_setting() (the cron-outage fix);
--    the migration version was stale. Align to prod's live version.
CREATE OR REPLACE FUNCTION public.invoke_cleanup_orphaned_media()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  edge_function_url TEXT;
  service_role_key TEXT;
BEGIN
  SELECT value INTO edge_function_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO service_role_key FROM app_config WHERE key = 'service_role_key';

  edge_function_url := edge_function_url || '/functions/v1/cleanup-orphaned-media';

  IF edge_function_url IS NULL OR service_role_key IS NULL THEN
    RAISE LOG 'Orphaned media cleanup: Config not set in app_config table';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := '{}'::jsonb
  );

  RAISE LOG 'Orphaned media cleanup: Triggered Edge Function';
END;
$function$;

-- 5) Tighten over-permissive grants that the staging rebuild's blanket
--    ALTER DEFAULT PRIVILEGES introduced (prod is stricter). REVOKE is a no-op
--    on prod (grants already absent). SECURITY-relevant: app_config can hold
--    the service_role_key, so anon/authenticated must NOT read it.
REVOKE ALL ON public.app_config FROM anon, authenticated;
REVOKE SELECT ON public.v_collector_target_health FROM authenticated;
REVOKE SELECT ON public.v_ingestion_activity FROM authenticated;
REVOKE SELECT ON public.v_pipeline_stage_health FROM authenticated;

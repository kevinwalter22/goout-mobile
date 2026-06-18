-- 140_monitor_cron_jobs.sql
-- Chief Engineer Phase 3b — schedule the 4 monitor edge functions on pg_cron.
--
-- ENV-AWARE BY DESIGN: the job command reads the project URL + service-role key
-- from the app_config table (same pattern as the patched
-- invoke_cleanup_orphaned_media), instead of hard-coding a prod URL. So this
-- migration is reproducible and safe to replay on staging (where app_config has
-- no rows → the call no-ops). This avoids the literal-URL cron tech-debt (#11)
-- for these new jobs.
--
-- cron.schedule() upserts by jobname, so re-running is idempotent.
-- Dollar-quoting: outer block is $do$, the cron command bodies are $job$ — never
-- reuse the same tag (the bug that broke migration 020).
--
-- ROLLOUT: deploy the monitor-* edge functions BEFORE this runs, or the first
-- ticks 404 until they exist (harmless). On prod, app_config must hold
-- 'supabase_url' and 'service_role_key' rows (it already does).

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    PERFORM cron.schedule('monitor-pipeline-health', '*/30 * * * *', $job$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_config WHERE key = 'supabase_url')
               || '/functions/v1/monitor-pipeline-health',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'service_role_key')
        ),
        body := '{}'::jsonb
      )
    $job$);

    PERFORM cron.schedule('monitor-api-budgets', '0 * * * *', $job$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_config WHERE key = 'supabase_url')
               || '/functions/v1/monitor-api-budgets',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'service_role_key')
        ),
        body := '{}'::jsonb
      )
    $job$);

    -- 12:00 UTC ≈ 08:00 America/New_York (EDT). Shifts 1h vs EST; acceptable.
    PERFORM cron.schedule('monitor-data-quality', '0 12 * * *', $job$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_config WHERE key = 'supabase_url')
               || '/functions/v1/monitor-data-quality',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'service_role_key')
        ),
        body := '{}'::jsonb
      )
    $job$);

    PERFORM cron.schedule('monitor-error-rates', '*/30 * * * *', $job$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_config WHERE key = 'supabase_url')
               || '/functions/v1/monitor-error-rates',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'service_role_key')
        ),
        body := '{}'::jsonb
      )
    $job$);

    RAISE NOTICE 'Phase 3b monitor cron jobs scheduled.';
  ELSE
    RAISE NOTICE 'pg_cron not available; monitor jobs not scheduled.';
  END IF;
END $do$;

-- ============================================================================
-- 145_cron_service_key_refs.sql — de-inline the service-role key from cron jobs
-- ============================================================================
-- SECURITY FIX. Nine active pg_cron jobs carried the CURRENT service-role key as
-- a literal in their `command` text (readable by anyone with cron/DB read):
--   fetch-coordinator-run, normalize-new-events, enrich-new-items,
--   evaluate-venue-websites, send-event-reminders, web-collector-run,
--   discover-venues-hourly, ingest-venue-website-run, cache-place-photos-run.
--
-- Root cause: the key rotation re-scheduled these jobs with the new sb_secret_*
-- key INLINED, instead of the reference pattern it applied to the other
-- consumers (monitor-* jobs, migration 140). So prod drifted from its migration
-- source (132/088, which used current_setting('app.service_role_key')). The
-- migration files never contained a literal — only the live DB did.
--
-- This re-asserts the canonical migration-140 pattern: URL + Bearer key read from
-- the app_config table at call time. ENV-AWARE: on staging app_config is empty →
-- the post no-ops (and stops staging cron from calling prod, a latent bug of the
-- inlined literal prod URL). cron.schedule() upserts by jobname → idempotent.
-- Bodies below preserve each job's CURRENT (out-of-band-tuned) values, not the
-- older bodies in migration 132.
--
-- Dollar-quoting: outer $do$, inner $job$ (never reuse a tag — migration 020 bug).
-- Rollback: not needed (removing a secret from plaintext); jobs keep running.
-- ============================================================================

DO $do$
DECLARE
  jobs jsonb := jsonb_build_array(
    jsonb_build_object('name','fetch-coordinator-run',   'sched','*/30 * * * *', 'fn','fetch-coordinator',        'body','{"max_fetches": 3}'),
    jsonb_build_object('name','normalize-new-events',     'sched','*/15 * * * *', 'fn','normalize-raw-events',      'body','{"max_items": 100}'),
    jsonb_build_object('name','enrich-new-items',         'sched','5,35 * * * *', 'fn','run-enrichment-queue',      'body','{"max_items": 10}'),
    jsonb_build_object('name','evaluate-venue-websites',  'sched','0 2 * * 0',    'fn','evaluate-venue-websites',   'body','{"batch_size": 20}'),
    jsonb_build_object('name','send-event-reminders',     'sched','*/15 * * * *', 'fn','send-event-reminders',      'body','{}'),
    jsonb_build_object('name','web-collector-run',        'sched','*/30 * * * *', 'fn','ingest-web-collector',      'body','{"max_targets": 10}'),
    jsonb_build_object('name','discover-venues-hourly',   'sched','0 * * * *',    'fn','discover-venues-to-crawl',  'body','{"max_per_run": 50, "bbox": {"min_lat":40.75,"max_lat":41.75,"min_lng":-75,"max_lng":-73.7}}'),
    jsonb_build_object('name','ingest-venue-website-run', 'sched','15 * * * *',   'fn','ingest-venue-website',      'body','{"max_per_run": 25}'),
    jsonb_build_object('name','cache-place-photos-run',   'sched','*/15 * * * *', 'fn','cache-place-photos',        'body','{"max_items": 100, "mode": "cache"}')
  );
  j jsonb;
  cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not available; cron re-scheduling skipped.';
    RETURN;
  END IF;

  FOR j IN SELECT * FROM jsonb_array_elements(jobs) LOOP
    cmd := format(
      $tmpl$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_config WHERE key = 'supabase_url') || '/functions/v1/%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'service_role_key')
        ),
        body := %L::jsonb
      )
      $tmpl$,
      (j->>'fn'), (j->>'body')
    );
    PERFORM cron.schedule(j->>'name', j->>'sched', cmd);
    RAISE NOTICE 'Re-scheduled % (%) → app_config reference', j->>'name', j->>'sched';
  END LOOP;

  RAISE NOTICE 'All 9 cron jobs de-inlined to app_config reference pattern.';
END $do$;

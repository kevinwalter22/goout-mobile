-- ============================================================================
-- Phase 5.* cron schedules (132)
-- ============================================================================
-- Closes a gap that existed since migration 044 introduced collector_targets:
-- there was no pg_cron job invoking ingest-web-collector. The pipeline ran
-- ONLY when an operator manually POSTed to the function. Albert Wisner was
-- the only Warwick venue with any data because Kevin manually triggered it
-- during the Phase 5.2 deploy; the other four were stuck at last_run_at=NULL.
--
-- Three jobs:
--   1. web-collector-run        (every 30 min)  — processes collector_targets
--   2. discover-venues-hourly   (every hour)    — Phase 5.3 enqueue
--   3. ingest-venue-website-run (every hour)    — Phase 5.3 consume
--
-- All three use the same auth pattern as the existing pg_cron jobs from
-- migration 088: net.http_post with Bearer current_setting('app.service_role_key').
-- That setting carries the legacy JWT-format service role key; the gateway
-- accepts JWT-format, and the function-level requireServiceRole verifies it
-- via the LEGACY_SERVICE_ROLE_JWT env-var fallback (added in earlier session).
--
-- Rollback:
--   SELECT cron.unschedule('web-collector-run');
--   SELECT cron.unschedule('discover-venues-hourly');
--   SELECT cron.unschedule('ingest-venue-website-run');
-- ============================================================================

DO $outer$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN

    -- ────────────────────────────────────────────────────────────────────
    -- 1. ingest-web-collector — every 30 minutes
    -- ────────────────────────────────────────────────────────────────────
    -- Processes whatever is enabled in collector_targets. The function's
    -- internal logic (get_enabled_collector_targets RPC) gates which rows
    -- run, so this cron doesn't need partition awareness. max_targets=10
    -- per call stays within the 150s edge-function budget; with 25 enabled
    -- targets and 30-minute cadence, each target gets a chance to run
    -- roughly every 75 minutes worst-case. Acceptable for events whose
    -- pages typically update no more than daily.
    --
    -- Safe to schedule even if the job already exists — cron.schedule
    -- replaces the existing schedule for the same name.
    PERFORM cron.schedule(
      'web-collector-run',
      '*/30 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/ingest-web-collector',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_targets": 10}'::jsonb
      )
      $cron$
    );
    RAISE NOTICE 'Scheduled: web-collector-run (every 30 min, max_targets=10)';

    -- ────────────────────────────────────────────────────────────────────
    -- 2. discover-venues-to-crawl — every hour
    -- ────────────────────────────────────────────────────────────────────
    -- Enqueues Google-Places-discovered venues into venue_crawl_state.
    -- Default max_per_run=50; the function's internal filter (Phase 5.3
    -- corrected enqueue query) already excludes chains, sub_category
    -- exclusion list, and kind!='activity'.
    PERFORM cron.schedule(
      'discover-venues-hourly',
      '0 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/discover-venues-to-crawl',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_per_run": 50}'::jsonb
      )
      $cron$
    );
    RAISE NOTICE 'Scheduled: discover-venues-hourly (top of every hour)';

    -- ────────────────────────────────────────────────────────────────────
    -- 3. ingest-venue-website — every hour at :15
    -- ────────────────────────────────────────────────────────────────────
    -- Consumes venue_crawl_state rows. Offset by 15 min from the discover
    -- job so newly-enqueued rows are picked up on the same hour rather than
    -- waiting until the next tick. claim_limit=5 keeps within the 150s
    -- edge budget (each venue is 1 fetch + up to 2 subpages + LLM extract,
    -- ~30-40s in practice).
    PERFORM cron.schedule(
      'ingest-venue-website-run',
      '15 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/ingest-venue-website',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_per_run": 5}'::jsonb
      )
      $cron$
    );
    RAISE NOTICE 'Scheduled: ingest-venue-website-run (hour:15, max_per_run=5)';

    RAISE NOTICE 'Phase 5 cron jobs scheduled successfully.';

  ELSE
    RAISE NOTICE 'pg_cron or pg_net not available; Phase 5 cron jobs not scheduled.';
  END IF;
END $outer$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After applying:
--   SELECT jobname, schedule, active FROM cron.job
--     WHERE jobname IN (
--       'web-collector-run','discover-venues-hourly','ingest-venue-website-run'
--     ) ORDER BY jobname;
--
-- Expected: 3 rows, all active=TRUE, with the schedules above.
-- ============================================================================

-- ============================================================================
-- Automated Pipeline Scheduling (088)
-- ============================================================================
-- Consolidates all cron jobs for the ingestion pipeline into one migration.
-- Uses pg_cron + pg_net to call Edge Functions on a schedule.
--
-- PRE-REQUISITES (do these in Supabase Dashboard BEFORE applying this migration):
--   1. Enable pg_cron extension:  Database > Extensions > search "pg_cron" > Enable
--   2. Enable pg_net extension:   Database > Extensions > search "pg_net" > Enable
--   3. Set custom config values in SQL Editor:
--      ALTER DATABASE postgres SET app.supabase_url = 'https://YOUR_PROJECT.supabase.co';
--      ALTER DATABASE postgres SET app.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
--
-- If pg_cron is not available, these jobs won't be created (safe to apply).
-- You can set up external scheduling instead (GitHub Actions, Vercel Cron, etc.)
-- ============================================================================

DO $outer$
BEGIN
  -- Check if pg_cron is available
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN

    -- ========================================================================
    -- 1. Fetch Coordinator — every 30 minutes
    -- Picks the most overdue partition and runs its ingestion function.
    -- Handles Ticketmaster, Google Places, PredictHQ round-robin.
    -- ========================================================================
    PERFORM cron.schedule(
      'fetch-coordinator-run',
      '*/30 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/fetch-coordinator',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_fetches": 3}'::jsonb
      )
      $cron$
    );
    RAISE NOTICE 'Scheduled: fetch-coordinator-run (every 30 min)';

    -- ========================================================================
    -- 2. Normalize new raw events — every 15 minutes
    -- Converts event_ingest_raw → explore_items via source adapters.
    -- ========================================================================
    PERFORM cron.schedule(
      'normalize-new-events',
      '*/15 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/normalize-raw-events',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_items": 100}'::jsonb
      )
      $cron$
    );
    RAISE NOTICE 'Scheduled: normalize-new-events (every 15 min)';

    -- ========================================================================
    -- 3. LLM Enrichment — every 30 minutes
    -- Generates tags, hook_lines, descriptions for new items.
    -- max_items=10 to stay within Supabase free-tier compute limits.
    -- ========================================================================
    PERFORM cron.schedule(
      'enrich-new-items',
      '5,35 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/run-enrichment-queue',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_items": 10}'::jsonb
      )
      $cron$
    );
    RAISE NOTICE 'Scheduled: enrich-new-items (every 30 min, offset by 5 min)';

    -- ========================================================================
    -- 4. Demote stale items — daily at 04:00 UTC
    -- Marks past events with priority = -1 so they drop from the feed.
    -- ========================================================================
    PERFORM cron.schedule(
      'demote-stale-items',
      '0 4 * * *',
      $cron$SELECT demote_stale_items()$cron$
    );
    RAISE NOTICE 'Scheduled: demote-stale-items (daily 04:00 UTC)';

    -- ========================================================================
    -- 5. Dedup — daily at 04:30 UTC
    -- Consolidates cross-source duplicates.
    -- ========================================================================
    PERFORM cron.schedule(
      'dedup-daily',
      '30 4 * * *',
      $cron$SELECT mark_duplicates()$cron$
    );
    RAISE NOTICE 'Scheduled: dedup-daily (daily 04:30 UTC)';

    RAISE NOTICE 'All pipeline cron jobs scheduled successfully.';

  ELSE
    RAISE NOTICE 'pg_cron or pg_net not available. Enable both extensions in Supabase Dashboard, then re-run this migration.';
    RAISE NOTICE 'Alternative: set up external scheduling (GitHub Actions, Vercel Cron, etc.)';
  END IF;
END $outer$;

-- ============================================================================
-- Reference: Manual invocation commands (if not using pg_cron)
-- ============================================================================
-- Fetch coordinator (every 30 min):
--   curl -X POST $SUPABASE_URL/functions/v1/fetch-coordinator
--     -H "Authorization: Bearer $SERVICE_ROLE_KEY"
--     -d '{"max_fetches": 3}'
--
-- Normalize (every 15 min):
--   curl -X POST $SUPABASE_URL/functions/v1/normalize-raw-events
--     -H "Authorization: Bearer $SERVICE_ROLE_KEY"
--     -d '{"max_items": 100}'
--
-- Enrich (every 30 min):
--   curl -X POST $SUPABASE_URL/functions/v1/run-enrichment-queue
--     -H "Authorization: Bearer $SERVICE_ROLE_KEY"
--     -d '{"max_items": 10}'
--
-- Maintenance (daily):
--   SELECT demote_stale_items();
--   SELECT mark_duplicates();

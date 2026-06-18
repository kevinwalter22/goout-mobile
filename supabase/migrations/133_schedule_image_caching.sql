-- ============================================================================
-- Schedule cache-place-photos (133)
-- ============================================================================
-- The Warwick fanout produced 939 Google-Places-sourced explore_items, but
-- no pg_cron job ever invoked cache-place-photos. As a result image_url and
-- image_thumb_url stayed NULL across the board and every Warwick venue
-- displayed the category placeholder. cache-place-photos already supports
-- a drain mode via get_items_needing_images; this migration just schedules
-- it.
--
-- Cadence: every 15 minutes, max 25 items per run.
-- Cost envelope: Google Places Photo requests ~$0.007 each → ~$0.70/hour
-- worst-case while the backlog drains, then negligible at steady state
-- (new items only).
--
-- Companion fix in this commit: ingest-google-places FIELD_MASK now includes
-- places.photos, so the per-item Photo lookup short-circuits when the photo
-- metadata is already in place_details_cache.
--
-- Rollback:
--   SELECT cron.unschedule('cache-place-photos-run');
-- ============================================================================

DO $outer$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN

    -- pg_cron commands embed the URL + bearer as literals because Supabase
    -- managed instances don't permit ALTER DATABASE for app.supabase_url /
    -- app.service_role_key (see migration 132 diagnosis notes). Operator
    -- must rewrite this job's command with current_setting() OR rewrite via
    -- the same diagnose-cron fix flow used for the Phase 5 jobs.
    PERFORM cron.schedule(
      'cache-place-photos-run',
      '*/15 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/cache-place-photos',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{"max_items": 25, "mode": "cache"}'::jsonb
      )
      $cron$
    );
    RAISE NOTICE 'Scheduled: cache-place-photos-run (every 15 min, max_items=25)';

  ELSE
    RAISE NOTICE 'pg_cron or pg_net not available; image-caching job not scheduled.';
  END IF;
END $outer$;

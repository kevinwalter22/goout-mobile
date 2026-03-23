-- ============================================================================
-- Drop no-op refresh-stale-images cron job (108)
-- ============================================================================
-- Migration 052 scheduled a daily pg_cron job with body `SELECT 1`.
-- This was a placeholder that was never implemented, so the job runs
-- every day at 3 AM and does nothing. Removing it to avoid confusion.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('refresh-stale-images');
    RAISE NOTICE 'Removed no-op refresh-stale-images cron job';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not remove cron job (may not exist): %', SQLERRM;
END;
$$;

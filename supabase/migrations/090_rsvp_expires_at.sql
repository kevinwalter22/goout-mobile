-- ============================================================================
-- RSVP Expiry for Activities (090)
-- ============================================================================
-- Adds expires_at column to explore_item_rsvps so activity RSVPs
-- auto-expire at end of day. Event RSVPs keep expires_at = NULL (never expire).
--
-- Activity RSVPs are set to expire at midnight local time (ET) of the day
-- they were created, so "I'm Going" resets daily for activities.
-- ============================================================================

-- Add nullable expires_at column
ALTER TABLE explore_item_rsvps
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Index for efficient filtering of non-expired RSVPs
CREATE INDEX IF NOT EXISTS explore_item_rsvps_expires_at_idx
  ON explore_item_rsvps(expires_at)
  WHERE expires_at IS NOT NULL;

-- Cleanup function: remove expired activity RSVPs
-- Called by pg_cron daily or on-demand
CREATE OR REPLACE FUNCTION cleanup_expired_rsvps()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM explore_item_rsvps
  WHERE expires_at IS NOT NULL
    AND expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_expired_rsvps() TO authenticated;

-- Schedule cleanup via pg_cron (if available)
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-expired-rsvps',
      '0 5 * * *',
      $cron$SELECT cleanup_expired_rsvps()$cron$
    );
    RAISE NOTICE 'Scheduled: cleanup-expired-rsvps (daily 05:00 UTC)';
  END IF;
END $outer$;

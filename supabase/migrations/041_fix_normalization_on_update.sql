-- ============================================================================
-- Fix: Re-queue normalization when raw data is updated (hash changed)
-- ============================================================================
-- The original trigger (migration 017) only fires AFTER INSERT.
-- When ingest-google-places upserts a changed record, the ON CONFLICT DO UPDATE
-- path does not fire the INSERT trigger, so changed data silently skips
-- normalization.
--
-- Fix:
--   1. Expand create_normalization_job() to handle UPDATE (status → 'new')
--   2. Add AFTER UPDATE trigger on event_ingest_raw
--
-- Rollback:
--   DROP TRIGGER IF EXISTS auto_requeue_normalization_job ON event_ingest_raw;
--   -- Restore create_normalization_job from migration 017
-- ============================================================================

CREATE OR REPLACE FUNCTION create_normalization_job()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New record: create normalization job
    INSERT INTO event_normalization_jobs (raw_id, status)
    VALUES (NEW.id, 'queued')
    ON CONFLICT (raw_id) DO NOTHING;

  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'new'
    AND OLD.status IS DISTINCT FROM 'new' THEN
    -- Data was re-ingested with changes (status reset to 'new').
    -- Re-queue the existing normalization job.
    UPDATE event_normalization_jobs
    SET status = 'queued',
        attempts = 0,
        last_error = NULL,
        started_at = NULL,
        completed_at = NULL,
        updated_at = NOW()
    WHERE raw_id = NEW.id;

    -- If no job row exists (edge case), create one.
    IF NOT FOUND THEN
      INSERT INTO event_normalization_jobs (raw_id, status)
      VALUES (NEW.id, 'queued');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add AFTER UPDATE trigger (the existing AFTER INSERT trigger remains unchanged)
DROP TRIGGER IF EXISTS auto_requeue_normalization_job ON event_ingest_raw;
CREATE TRIGGER auto_requeue_normalization_job
  AFTER UPDATE ON event_ingest_raw
  FOR EACH ROW EXECUTE FUNCTION create_normalization_job();

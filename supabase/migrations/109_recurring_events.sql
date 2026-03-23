-- ============================================================================
-- Recurring Events Support
-- ============================================================================
-- Adds advance_recurring_events() to bump starts_at forward for user-created
-- recurring events after each occurrence passes.  Updates demote_stale_items()
-- to skip recurring events (they get advanced, not demoted).
--
-- The existing `recurrence` TEXT column (migration 017) stores the pattern:
--   'weekly', 'monthly', or NULL/'' for non-recurring.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS advance_recurring_events();
--   -- Re-create demote_stale_items without the recurrence exclusion
--   SELECT cron.unschedule('advance-recurring-events');
-- ============================================================================

-- ============================================================================
-- 1. advance_recurring_events()
-- ============================================================================
CREATE OR REPLACE FUNCTION advance_recurring_events()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INTEGER := 0;
  rec RECORD;
  new_starts_at TIMESTAMPTZ;
  new_ends_at TIMESTAMPTZ;
  duration INTERVAL;
BEGIN
  FOR rec IN
    SELECT id, starts_at, ends_at, recurrence
    FROM explore_items
    WHERE
      recurrence IN ('weekly', 'monthly')
      AND created_by_user_id IS NOT NULL
      AND deleted_at IS NULL
      AND starts_at < NOW() - INTERVAL '3 hours'
      AND priority >= 0
  LOOP
    -- Preserve original event duration for ends_at
    duration := COALESCE(rec.ends_at - rec.starts_at, INTERVAL '0');

    -- Advance starts_at until it's in the future
    new_starts_at := rec.starts_at;

    IF rec.recurrence = 'weekly' THEN
      WHILE new_starts_at < NOW() LOOP
        new_starts_at := new_starts_at + INTERVAL '7 days';
      END LOOP;
    ELSIF rec.recurrence = 'monthly' THEN
      WHILE new_starts_at < NOW() LOOP
        new_starts_at := new_starts_at + INTERVAL '1 month';
      END LOOP;
    END IF;

    -- Recalculate ends_at preserving original duration
    new_ends_at := NULL;
    IF rec.ends_at IS NOT NULL THEN
      new_ends_at := new_starts_at + duration;
    END IF;

    -- Update the event row
    UPDATE explore_items
    SET
      starts_at = new_starts_at,
      ends_at = new_ends_at,
      updated_at = NOW()
    WHERE id = rec.id;

    -- Clear RSVPs from the old occurrence
    DELETE FROM explore_item_rsvps
    WHERE explore_item_id = rec.id
      AND created_at < new_starts_at - INTERVAL '1 day';

    affected := affected + 1;
  END LOOP;

  RAISE NOTICE 'advance_recurring_events: advanced % events', affected;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION advance_recurring_events() TO authenticated;

-- ============================================================================
-- 2. Update demote_stale_items() to skip recurring events
-- ============================================================================
CREATE OR REPLACE FUNCTION demote_stale_items()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE explore_items
  SET
    priority = -1,
    updated_at = NOW()
  WHERE
    kind = 'event'
    AND starts_at < NOW() - INTERVAL '1 day'
    AND priority >= 0
    AND (recurrence IS NULL OR recurrence IN ('none', ''));

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'demote_stale_items: demoted % events', affected;
  RETURN affected;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION demote_stale_items() TO authenticated;

-- ============================================================================
-- 3. Schedule via pg_cron (daily at 03:50 UTC, before demoter at 04:00)
-- ============================================================================
DO $$
BEGIN
  PERFORM cron.schedule(
    'advance-recurring-events',
    '50 3 * * *',
    'SELECT advance_recurring_events()'
  );
  RAISE NOTICE 'pg_cron job scheduled: advance-recurring-events (daily 03:50 UTC)';
EXCEPTION
  WHEN undefined_function OR invalid_schema_name THEN
    RAISE NOTICE 'pg_cron not available — schedule advance_recurring_events() via Edge Function cron or manually';
END;
$$;

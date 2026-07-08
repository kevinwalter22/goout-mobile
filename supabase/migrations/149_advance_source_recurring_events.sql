-- ============================================================================
-- 149_advance_source_recurring_events.sql
-- ============================================================================
-- INTERIM fix for Tier 1.1 (recurring events show past dates) and part of
-- Tier 1.3 (recurring events invisible on the map).
--
-- Problem: source-ingested recurring events (trivia, live music, weekly markets)
-- store a single `starts_at` = their ORIGINAL occurrence and never advance. The
-- feed's `starts_at >= now()-3h` guard then either hides them or shows a stale
-- date at the top of the list, and the map's date-windowed query skips them
-- entirely (they're neither in-window nor starts_at IS NULL).
--
-- migration 109's advance_recurring_events() already rolls USER-created weekly/
-- monthly events forward. This extends it to:
--   • SOURCE-ingested events (created_by_user_id IS NULL), and
--   • the 'daily' pattern (walking tours, daily programs),
-- so their `starts_at` is advanced to the NEXT upcoming occurrence.
--
-- The roll is DETERMINISTIC (advance in fixed interval steps to the first
-- occurrence >= now), so it is idempotent and AGREES with the identical roll
-- applied at normalize-time (normalize-raw-events) — a re-crawl that re-supplies
-- the original past date self-heals to the same next occurrence instead of
-- fighting this job.
--
-- SEASON-BOUND GUARD (interim): source events are only rolled when their latest
-- stored occurrence is within the last 35 days — i.e. the source is still
-- actively listing them. A seasonal series (e.g. a May–Nov farmers market) whose
-- source stops listing it goes stale and is NOT rolled into the off-season; it
-- falls out of the feed via the past-event guard. This does not perfectly bound
-- a source that keeps a stale in-season listing up year-round — the DURABLE fix
-- (Tier 2: RFC 5545 RRULE with UNTIL/COUNT + availability_json season bounds)
-- handles that precisely and is specced separately.
--
-- Rollback: re-apply migration 109's advance_recurring_events() body.
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
    SELECT id, starts_at, ends_at, recurrence, created_by_user_id
    FROM explore_items
    WHERE
      recurrence IN ('daily', 'weekly', 'monthly')
      AND deleted_at IS NULL
      AND starts_at IS NOT NULL
      AND starts_at < NOW() - INTERVAL '3 hours'
      AND priority >= 0
      AND NOT COALESCE(is_admin_suppressed, FALSE)
      AND (
        -- User-created recurring events always advance (the user owns the series).
        created_by_user_id IS NOT NULL
        -- Source-ingested events advance only while the source still lists them
        -- (latest occurrence within 35 days) — the interim season-bound guard.
        OR starts_at > NOW() - INTERVAL '35 days'
      )
  LOOP
    -- Preserve the original event duration for ends_at.
    duration := COALESCE(rec.ends_at - rec.starts_at, INTERVAL '0');

    new_starts_at := rec.starts_at;

    IF rec.recurrence = 'daily' THEN
      WHILE new_starts_at < NOW() LOOP
        new_starts_at := new_starts_at + INTERVAL '1 day';
      END LOOP;
    ELSIF rec.recurrence = 'weekly' THEN
      WHILE new_starts_at < NOW() LOOP
        new_starts_at := new_starts_at + INTERVAL '7 days';
      END LOOP;
    ELSIF rec.recurrence = 'monthly' THEN
      WHILE new_starts_at < NOW() LOOP
        new_starts_at := new_starts_at + INTERVAL '1 month';
      END LOOP;
    END IF;

    new_ends_at := NULL;
    IF rec.ends_at IS NOT NULL THEN
      new_ends_at := new_starts_at + duration;
    END IF;

    UPDATE explore_items
    SET
      starts_at = new_starts_at,
      ends_at = new_ends_at,
      updated_at = NOW()
    WHERE id = rec.id;

    -- Clear RSVPs tied to the occurrence that just passed.
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
-- Also skip 'daily' recurring events in the stale-item demoter (mirror 109's
-- weekly/monthly exclusion — daily events are advanced, not demoted).
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
-- Advance the existing backlog immediately (don't wait for the 03:50 cron).
-- ============================================================================
SELECT advance_recurring_events();

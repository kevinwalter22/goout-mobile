-- Migration 116: Fix event-reminders push notification pipeline
--
-- 1. Creates get_upcoming_event_reminders() RPC that was never created.
--    The send-event-reminders edge function tries this RPC first and falls back
--    to an inline query on error — creating it removes the error noise.
--
-- 2. Removes the broken _cron_send_event_reminders helper and reschedules
--    the cron job with values inlined directly (Supabase does not grant
--    ALTER DATABASE to SQL-editor users, so the app.* settings approach
--    from migration 112 has been failing on every cron run since deployment).
--
--    The cron job is rescheduled here with the URL inlined. The service-role
--    key must be inlined via a separate one-time SQL statement run in the
--    Supabase SQL editor (see docs/ENVIRONMENTS.md or the verification checklist).
--
-- ============================================================

-- ── RPC: get_upcoming_event_reminders ────────────────────────────────

CREATE OR REPLACE FUNCTION get_upcoming_event_reminders()
RETURNS TABLE(
  user_id         UUID,
  explore_item_id UUID,
  title           TEXT,
  starts_at       TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    r.user_id,
    r.explore_item_id,
    e.title,
    e.starts_at
  FROM explore_item_rsvps r
  JOIN explore_items e ON e.id = r.explore_item_id
  JOIN profiles     p ON p.id = r.user_id
  WHERE
    e.starts_at >= now() + INTERVAL '45 minutes'
    AND e.starts_at <= now() + INTERVAL '75 minutes'
    AND p.notify_event_reminders = true;
$$;

GRANT EXECUTE ON FUNCTION get_upcoming_event_reminders() TO service_role;

-- ── Drop the broken helper from previous attempt ─────────────────────
DROP FUNCTION IF EXISTS _cron_send_event_reminders();

-- ── Note on cron rescheduling ─────────────────────────────────────────
-- The cron job cannot be rescheduled here with credentials inlined because
-- service-role keys must not be committed to the migrations repo.
-- Run the following one-time SQL in the Supabase SQL editor to fix it:
--
--   SELECT cron.unschedule('send-event-reminders');
--   SELECT cron.schedule(
--     'send-event-reminders',
--     '*/15 * * * *',
--     $$SELECT net.http_post(
--       url     := 'https://<your-project>.supabase.co/functions/v1/send-event-reminders',
--       headers := '{"Authorization":"Bearer <service-role-key>","Content-Type":"application/json"}'::jsonb,
--       body    := '{}'::jsonb
--     )$$
--   );

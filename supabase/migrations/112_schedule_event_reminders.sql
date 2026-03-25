-- Migration 112: Schedule send-event-reminders cron job
--
-- The send-event-reminders edge function was implemented in migration 084
-- but never scheduled. This migration creates the pg_cron job that calls
-- it every 15 minutes to send push notifications for events starting ~1 hour out.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    PERFORM cron.schedule(
      'send-event-reminders',
      '*/15 * * * *',
      $cron$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/send-event-reminders',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      )
      $cron$
    );
    RAISE NOTICE 'Scheduled: send-event-reminders (every 15 min)';

  ELSE
    RAISE NOTICE 'pg_cron or pg_net not available — skipping send-event-reminders schedule';
  END IF;
END;
$$;

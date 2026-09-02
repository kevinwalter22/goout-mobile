-- 185_generate_event_pins_cron.sql
--
-- Durable, hands-off photo-bubble pins (Plan B). Every 2 minutes, invoke the
-- generate-event-pins edge function, which renders + caches a circular photo pin for any
-- user-created event with a photo that still needs one (new events + a one-time backfill of
-- existing ones). The edge function is idempotent (skips events that already have a pin) and
-- caches the PNG forever, so this is $0 per map render — same discipline as score-notability.
--
-- Env-aware exactly like the score-notability cron (mig 161): reads supabase_url +
-- service_role_key from app_config, so it no-ops on any env where those aren't seeded and
-- never inlines the service key.
--
-- ROLLBACK: select cron.unschedule('generate-event-pins-run');

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'generate-event-pins-run') then
    perform cron.schedule('generate-event-pins-run', '*/2 * * * *', $job$
      select net.http_post(
        url := (select value from public.app_config where key = 'supabase_url') || '/functions/v1/generate-event-pins',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select value from public.app_config where key = 'service_role_key')
        ),
        body := '{"limit":30}'::jsonb
      );
    $job$);
  end if;
end $$;

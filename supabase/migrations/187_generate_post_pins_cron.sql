-- 187_generate_post_pins_cron.sql
--
-- Durable, hands-off check-in pins (social map). Every 2 minutes, invoke the
-- generate-post-pins edge function, which renders + caches a circular photo pin for any
-- approved, plottable post that still needs one (new check-ins + a one-time backfill).
-- Idempotent + cached forever => $0 per map render. Env-aware via app_config, exactly like
-- the score-notability (161) + generate-event-pins (185) crons.
--
-- ROLLBACK: select cron.unschedule('generate-post-pins-run');

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'generate-post-pins-run') then
    perform cron.schedule('generate-post-pins-run', '*/2 * * * *', $job$
      select net.http_post(
        url := (select value from public.app_config where key = 'supabase_url') || '/functions/v1/generate-post-pins',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select value from public.app_config where key = 'service_role_key')
        ),
        body := '{"limit":30}'::jsonb
      );
    $job$);
  end if;
end $$;

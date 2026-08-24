-- 169_score_notability_cron_frequency.sql
--
-- Cost/scaling hygiene for the score-notability generator (migration 161).
--
-- WHY: the cron ran HOURLY (`20 * * * *`). Notability doesn't change hour-to-hour, and
-- at low ingestion an hourly run scores 1–4 items in near-empty batches — wasting the
-- generator's built-in batching (score-notability already packs batch_size=15 items per
-- Opus call). Running less often lets new items POOL between runs so each run fills fuller
-- batches → fewer API calls per item. This is flat now (~$1–2/mo) but keeps the API-call
-- count from growing linearly with ingestion as we add cities/sources.
--
-- CHANGE:
--   * schedule  hourly (`20 * * * *`)  ->  every 6h (`20 */6 * * *`)  — 24 runs/day -> 4.
--     New items wait at most ~6h to be scored (fine for curation; not time-critical).
--   * per-run limit  50 -> 200  — so a single run clears accumulated backlog (the function
--     loops batches of 15 up to a 110s deadline; 200 = ~13 batches, comfortably in-window).
--
-- The generator's batching (multiple items per Opus call) is UNCHANGED — it already exists
-- in the edge function; this migration only re-times + resizes the trigger.
--
-- Env-aware + idempotent: cron.schedule upserts by jobname; app_config is empty on staging
-- so the job no-ops there by design (migration 145 pattern). Same job body as 161.
--
-- ROLLBACK: re-run migration 161's schedule block (hourly, limit 50).

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('score-notability-run', '20 */6 * * *', $job$
      select net.http_post(
        url := (select value from public.app_config where key = 'supabase_url') || '/functions/v1/score-notability',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select value from public.app_config where key = 'service_role_key')
        ),
        body := '{"limit": 200}'::jsonb
      );
    $job$);
  end if;
end $do$;

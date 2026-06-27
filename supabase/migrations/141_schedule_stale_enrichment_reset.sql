-- 141_schedule_stale_enrichment_reset.sql
--
-- Schedule reset_stale_enrichment_jobs() on pg_cron.
--
-- WHY: reset_stale_enrichment_jobs() has existed since migration 048 but was
-- NEVER scheduled. With nothing recovering them, enrichment jobs left in
-- 'running' by a timed-out run-enrichment-queue invocation accumulated silently
-- — 3,500+ jobs were found stuck (oldest since 2026-02-26), which stalled
-- hook_line/tag enrichment across every market. This is the exact silent
-- pipeline degradation the monitoring effort exists to catch.
--
-- The companion code fix (run-enrichment-queue wall-clock guard) prevents new
-- orphans; this cron is the backstop that auto-recovers any that still slip
-- through. The command is pure SQL — no HTTP/auth needed — so unlike the monitor
-- jobs it carries no URL/key and is fully reproducible on any environment.
--
-- cron.schedule() upserts by jobname → idempotent on replay.
-- Dollar-quoting: outer block $do$, the cron command body $job$ (never reuse a
-- tag — the bug that broke migration 020).

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Every 15 min: requeue jobs stuck 'running' longer than 30 min.
    PERFORM cron.schedule('reset-stale-enrichment', '*/15 * * * *', $job$
      SELECT public.reset_stale_enrichment_jobs(30)
    $job$);
    RAISE NOTICE 'Scheduled: reset-stale-enrichment (every 15 min, 30 min timeout)';
  ELSE
    RAISE NOTICE 'pg_cron not installed — skipped scheduling reset-stale-enrichment';
  END IF;
END
$do$;

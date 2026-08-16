-- ============================================================================
-- 157_fix_complete_normalization_job_enum_cast.sql
-- ============================================================================
-- BUG (same class as 155_fix_claim_build_task_enum_cast): complete_normalization_job
-- assigns text CASE expressions to two enum columns without a cast →
-- ERROR 42804 ("column status is of type job_status but expression is of type text").
-- Because a CASE's type is resolved at plan time, the UPDATE errored on EVERY call
-- once `status` columns became enums (event_normalization_jobs.status = job_status,
-- event_ingest_raw.status = ingest_status).
--
-- The normalize-raw-events worker calls this RPC but does NOT check its `.error`
-- return, so the failure was swallowed silently: jobs stayed 'running' forever from
-- the RPC's perspective. It went unnoticed for ~2 months because (a) the only thing
-- masking it is reset_stale_normalization_jobs (cron jobid 62, */15), which sweeps
-- stuck 'running' jobs whose raw is already 'normalized' to 'done' ~15 min late —
-- so completion *appeared* to work, just delayed with an inaccurate completed_at;
-- and (b) API ingestion was dark, so the fresh-job case was never watched in real
-- time until Ticketmaster was re-enabled.
--
-- FIX: cast both CASE branches to their enum types. Restores immediate, correct job
-- completion; reset_stale reverts to a true safety-net instead of the primary path.
-- Tier 2, function redefinition only. Rollback: revert to migration 017's definition.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_normalization_job(
  p_job_id UUID,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE event_normalization_jobs
  SET
    status = (CASE WHEN p_success THEN 'done' ELSE 'failed' END)::job_status,
    completed_at = NOW(),
    last_error = p_error,
    updated_at = NOW()
  WHERE id = p_job_id;

  -- Also update the raw record status
  UPDATE event_ingest_raw
  SET
    status = (CASE WHEN p_success THEN 'normalized' ELSE 'failed' END)::ingest_status,
    last_error = p_error,
    updated_at = NOW()
  WHERE id = (SELECT raw_id FROM event_normalization_jobs WHERE id = p_job_id);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.complete_normalization_job(UUID, BOOLEAN, TEXT) TO service_role;

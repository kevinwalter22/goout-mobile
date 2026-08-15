-- ============================================================================
-- 155_fix_claim_build_task_enum_cast.sql
-- ============================================================================
-- BUG: claim_build_task's stale-reset UPDATE assigned a text CASE expression to
-- `status` (type build_task_status) without a cast → ERROR 42804 ("column status
-- is of type build_task_status but expression is of type text"). Because a CASE's
-- type is resolved at plan time, the UPDATE errored on EVERY call once the
-- kill-switch was ON — so the nightly builder claimed nothing ("no ready tasks").
-- It slipped validation because the only prior test ran with the switch OFF,
-- which returns before the stale-reset.
--
-- FIX: cast the CASE branches to build_task_status. (The final claim UPDATE uses a
-- single literal 'claimed', which casts implicitly and is fine.) Tier 2, function
-- redefinition only. Rollback: revert to migration 154's definition.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_build_task(p_worker text, p_lease_minutes int DEFAULT 30)
RETURNS SETOF public.build_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.build_queue_enabled() THEN RETURN; END IF;

  UPDATE build_tasks
  SET status = CASE WHEN attempts >= max_attempts
                    THEN 'blocked'::build_task_status
                    ELSE 'ready'::build_task_status END,
      blocked_reason = CASE WHEN attempts >= max_attempts THEN 'lease expired, attempts exhausted' ELSE blocked_reason END,
      claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
  WHERE status IN ('claimed', 'in_progress') AND lease_expires_at < now();

  SELECT id INTO v_id FROM build_tasks
  WHERE status = 'ready'
  ORDER BY priority ASC, created_at ASC
  LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE build_tasks
  SET status = 'claimed', claimed_by = p_worker, claimed_at = now(),
      lease_expires_at = now() + make_interval(mins => p_lease_minutes),
      attempts = attempts + 1
  WHERE id = v_id
  RETURNING *;
END; $$;

REVOKE ALL ON FUNCTION public.claim_build_task(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_build_task(text, int) TO service_role;

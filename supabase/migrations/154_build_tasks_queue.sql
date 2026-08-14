-- ============================================================================
-- 154_build_tasks_queue.sql — overnight builder task queue + guardrails + kill-switch
-- ============================================================================
-- The prerequisite for the overnight builder (scheduled-autonomous-dev). Modeled
-- on collector_targets / enrichment_queue (DB table + claim RPC + lease), NOT
-- parsed markdown. Approved design decisions:
--   * A task is claimable only when its SPEC is complete (the scoping-quality
--     gate — enforced structurally by a trigger). Vague tasks stay in 'draft'.
--   * tier is 1 or 2 ONLY (CHECK) — the builder never does Tier-3 work.
--   * needs_device tasks are worked but never auto-shipped (the builder has no
--     merge step at all — every task ends at needs_kevin / a PR Kevin approves).
--   * claim RPC has a LEASE + STALE-RESET (explicitly avoids the normalization
--     queue's 1,464-stuck-running bug).
--   * build_queue_enabled feature flag = master kill-switch (off by default).
--   * Hard guardrail numbers live in the build_queue_guardrails flag config.
--
-- ALSO (Kevin: "fix the existing stuck jobs alongside"): a durable stale-reset
-- for the NORMALIZATION queue + a one-time cleanup of jobs left 'running'. The
-- cleanup is idempotent (no-op on staging, already fixed) and runs on prod via
-- the gated deploy.
--
-- Tier 2 (additive: new enum, table, functions, feature flags; the normalization
-- cleanup only touches stuck 'running' rows). Rollback: DROP TABLE build_tasks;
-- DROP the functions/type/flags; the normalization cleanup is not reversible but
-- only finalized already-completed work.
-- ============================================================================

-- ── 1. status enum ──────────────────────────────────────────────────────────
DO $do$ BEGIN
  CREATE TYPE build_task_status AS ENUM
    ('draft','ready','claimed','in_progress','needs_kevin','blocked','done');
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- ── 2. build_tasks table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.build_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  tier             int NOT NULL DEFAULT 2 CHECK (tier IN (1, 2)),  -- Tier 1-2 only
  spec             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {why, files, change, context, out_of_scope}
  acceptance       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {checks:[...], done_when}
  needs_device     boolean NOT NULL DEFAULT false,       -- map/camera/native → implement + flag, never merge
  status           build_task_status NOT NULL DEFAULT 'draft',
  priority         int NOT NULL DEFAULT 100,             -- lower = sooner
  claimed_by       text,
  claimed_at       timestamptz,
  lease_expires_at timestamptz,
  attempts         int NOT NULL DEFAULT 0,
  max_attempts     int NOT NULL DEFAULT 2,
  pr_url           text,
  result           text,
  blocked_reason   text,
  created_by       text NOT NULL DEFAULT 'kevin',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.build_tasks ENABLE ROW LEVEL SECURITY;  -- service-role only; no policies
CREATE INDEX IF NOT EXISTS idx_build_tasks_claim ON public.build_tasks (status, priority, created_at);

COMMENT ON TABLE public.build_tasks IS
  'Overnight builder task queue. Claimable only when the spec is complete (scoping-quality gate); tier<=2; needs_device tasks never auto-merge; gated by the build_queue_enabled kill-switch.';

-- updated_at touch
CREATE OR REPLACE FUNCTION public.touch_build_tasks_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_build_tasks_touch ON public.build_tasks;
CREATE TRIGGER trg_build_tasks_touch BEFORE UPDATE ON public.build_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_build_tasks_updated_at();

-- ── 3. scoping-quality gate: non-draft REQUIRES a complete spec ──────────────
-- Structurally prevents a vague task from ever becoming claimable. The spec must
-- carry why/files/change/context/out_of_scope and acceptance must carry checks.
CREATE OR REPLACE FUNCTION public.enforce_build_task_spec() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'draft' THEN
    IF NOT (NEW.spec ? 'why' AND NEW.spec ? 'files' AND NEW.spec ? 'change'
            AND NEW.spec ? 'context' AND NEW.spec ? 'out_of_scope')
       OR NOT (NEW.acceptance ? 'checks') THEN
      RAISE EXCEPTION
        'build_task "%" cannot leave draft: spec needs why/files/change/context/out_of_scope and acceptance.checks (scoping-quality gate)',
        NEW.title;
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_build_tasks_spec ON public.build_tasks;
CREATE TRIGGER trg_build_tasks_spec BEFORE INSERT OR UPDATE ON public.build_tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_build_task_spec();

-- ── 4. kill-switch + guardrail config (feature_flags) ───────────────────────
INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, config_json) VALUES
  ('build_queue_enabled', false, 100, jsonb_build_object(
     'description', 'Master kill-switch for the overnight builder. OFF = the builder claims nothing (read-workers unaffected).')),
  ('build_queue_guardrails', true, 100, jsonb_build_object(
     'description', 'Hard caps read by the overnight builder workflow.',
     'max_tasks_per_night', 4,           -- night-1 conservative (3-5)
     'max_turns_per_task', 40,           -- per-task turn ceiling (measured task was 13)
     'max_wallclock_min_per_task', 30,   -- per-task wall-clock ceiling
     'max_cost_usd_per_task', 8,         -- per-task cost ceiling (~10x the measured $0.79 → aborts a ballooning vague task)
     'max_cost_usd_per_night', 25,       -- per-night cost ceiling
     'model', 'sonnet',                  -- default builder model; Opus is per-task opt-in
     'lease_minutes', 30))
ON CONFLICT (flag_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.build_queue_enabled() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT is_enabled FROM feature_flags WHERE flag_name = 'build_queue_enabled'), false);
$$;

-- ── 5. claim_build_task() — lease + stale-reset ─────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_build_task(p_worker text, p_lease_minutes int DEFAULT 30)
RETURNS SETOF public.build_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.build_queue_enabled() THEN RETURN; END IF;

  -- stale-reset: claims past their lease recycle to 'ready' (or 'blocked' if attempts exhausted)
  UPDATE build_tasks
  SET status = CASE WHEN attempts >= max_attempts THEN 'blocked' ELSE 'ready' END,
      blocked_reason = CASE WHEN attempts >= max_attempts THEN 'lease expired, attempts exhausted' ELSE blocked_reason END,
      claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
  WHERE status IN ('claimed','in_progress') AND lease_expires_at < now();

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

-- ── 6. normalization queue: durable stale-reset (the 1,464 fix) ─────────────
CREATE OR REPLACE FUNCTION public.reset_stale_normalization_jobs(p_stale_minutes int DEFAULT 15)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  WITH upd AS (
    UPDATE event_normalization_jobs j
    SET status = CASE
                   WHEN r.status = 'normalized' THEN 'done'::job_status       -- work done → finalize
                   WHEN r.status = 'failed'     THEN 'failed'::job_status
                   WHEN j.attempts >= j.max_attempts THEN 'failed'::job_status
                   ELSE 'queued'::job_status                                    -- genuinely incomplete → reprocess
                 END,
        started_at   = CASE WHEN r.status NOT IN ('normalized','failed') AND j.attempts < j.max_attempts THEN NULL ELSE j.started_at END,
        completed_at = CASE WHEN r.status IN ('normalized','failed') OR j.attempts >= j.max_attempts THEN COALESCE(j.completed_at, now()) ELSE j.completed_at END,
        updated_at   = now()
    FROM event_ingest_raw r
    WHERE j.raw_id = r.id
      AND j.status = 'running'
      AND j.started_at < now() - make_interval(mins => p_stale_minutes)
    RETURNING j.id
  ) SELECT count(*) INTO v_n FROM upd;
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.reset_stale_normalization_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_stale_normalization_jobs(int) TO service_role;

-- schedule it (pure SQL, no HTTP) — skip gracefully where pg_cron isn't wired (staging)
DO $do$ BEGIN
  PERFORM cron.schedule('reset-stale-normalization-jobs', '*/15 * * * *',
    $cron$SELECT public.reset_stale_normalization_jobs(15);$cron$);
EXCEPTION WHEN others THEN RAISE NOTICE 'cron schedule skipped: %', SQLERRM; END $do$;

-- ── 7. one-time cleanup of jobs already left 'running' (idempotent) ──────────
-- Finalizes stuck jobs whose work is done → 'done', else 'failed'. Does NOT
-- re-queue (that would re-flood the queue). No-op on staging (already fixed);
-- runs on prod via the gated deploy.
DO $do$ BEGIN
  UPDATE event_normalization_jobs j
  SET status = CASE WHEN r.status = 'normalized' THEN 'done'::job_status ELSE 'failed'::job_status END,
      completed_at = COALESCE(j.completed_at, now()),
      last_error = CASE WHEN r.status = 'normalized' THEN j.last_error
                        ELSE COALESCE(j.last_error, 'stale-reset: left running after processing') END,
      updated_at = now()
  FROM event_ingest_raw r
  WHERE j.raw_id = r.id AND j.status = 'running';

  UPDATE event_normalization_jobs
  SET status = 'failed'::job_status,
      last_error = COALESCE(last_error, 'stale-reset: orphaned running job'), updated_at = now()
  WHERE status = 'running';
END $do$;

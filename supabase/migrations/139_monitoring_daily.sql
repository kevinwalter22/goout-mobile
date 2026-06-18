-- 139_monitoring_daily.sql
-- Chief Engineer Phase 3b — trend table for the daily data-quality snapshot
-- written by the monitor-data-quality edge function.

CREATE TABLE IF NOT EXISTS public.monitoring_daily (
  snapshot_date         date PRIMARY KEY,
  new_items_total       integer NOT NULL DEFAULT 0,
  new_items_by_source   jsonb   NOT NULL DEFAULT '{}'::jsonb,
  null_coord_events     integer NOT NULL DEFAULT 0,
  missing_starts_events integer NOT NULL DEFAULT 0,
  post_at_event_24h     integer NOT NULL DEFAULT 0,
  quarantined_total     integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monitoring_daily ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS (writes via the edge function); admins may read for
-- a future dashboard. No anon access.
DROP POLICY IF EXISTS "admins read monitoring_daily" ON public.monitoring_daily;
CREATE POLICY "admins read monitoring_daily"
  ON public.monitoring_daily FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

GRANT SELECT ON public.monitoring_daily TO authenticated;
GRANT ALL ON public.monitoring_daily TO service_role;

COMMENT ON TABLE public.monitoring_daily IS
  'Daily data-quality metrics snapshot (Phase 3b). One row per snapshot_date, upserted by monitor-data-quality.';

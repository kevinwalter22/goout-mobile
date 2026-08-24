-- 170_engagement_log_partition_rls.sql
--
-- SECURITY: the engagement_log monthly partitions (engagement_log_YYYY_MM) had RLS
-- DISABLED. The parent (migration 136) has RLS + policies — users may read/insert only
-- their OWN rows (user_id = auth.uid()) — but a partition accessed DIRECTLY does not
-- inherit the parent's RLS enforcement, and anon held SELECT/INSERT/DELETE grants on the
-- partitions. Supabase flagged this as `rls_disabled_in_public` + `sensitive_columns_exposed`
-- (the partitions carry user_id + user_location).
--
-- VERIFIED EXPOSURE (live, anon key): the partitions are NOT reachable through the anon
-- API surface — PostgREST does not expose partition child tables (404/PGRST205) and
-- pg_graphql is not enabled; the parent endpoint is RLS-protected (anon → []). So this was
-- a LATENT DB-level misconfiguration, not a live data path. But public tables must carry
-- RLS regardless (defense-in-depth), and the maintenance cron was minting a fresh RLS-off
-- partition every month — a recurring leak. This closes both.
--
-- VALIDATED on staging: with partition RLS enabled, an authenticated parent-routed INSERT
-- still succeeds (RLS is enforced on the query target = the parent, not the routed
-- partition), so the engagement write path is unaffected. Edge-function writes use
-- service_role, which bypasses RLS entirely.
--
-- Idempotent + re-runnable. ROLLBACK: `alter table <partition> disable row level security`
-- (not advised — it re-opens the finding).

-- 1. Enable RLS on every existing partition of engagement_log.
do $$
declare part regclass;
begin
  for part in
    select inhrelid::regclass
    from pg_inherits
    where inhparent = 'public.engagement_log'::regclass
  loop
    execute format('alter table %s enable row level security', part);
  end loop;
end $$;

-- 2. Patch the monthly-maintenance function so EVERY new partition gets RLS enabled at
--    creation (was migration 136; it created partitions without RLS → recurring leak).
create or replace function ensure_engagement_log_partitions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
  start_month date;
  end_month date;
  partition_name text;
  v_created int := 0;
begin
  for i in 0..3 loop
    start_month := date_trunc('month', now() + (i || ' months')::interval)::date;
    end_month   := start_month + interval '1 month';
    partition_name := 'engagement_log_' || to_char(start_month, 'YYYY_MM');

    if not exists (select 1 from pg_class where relname = partition_name) then
      execute format(
        'create table %I partition of engagement_log for values from (%L) to (%L)',
        partition_name, start_month, end_month
      );
      -- SECURITY (migration 170): new partitions must carry RLS too — the parent's RLS
      -- is not enforced on direct partition access.
      execute format('alter table %I enable row level security', partition_name);
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end;
$$;

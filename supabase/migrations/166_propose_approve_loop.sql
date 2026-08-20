-- 166_propose_approve_loop.sql
-- The propose→approve→queue RPCs. Depends on 'proposed' state (migration 165).
-- agent → propose_build_task() → 'proposed' → Slack digest → Kevin promote_proposed_task()
-- → 'ready' → builder claim_build_task() (pulls only 'ready', unchanged).
-- Spec-completeness (why/files/change/context/out_of_scope + acceptance.checks) is
-- enforced by the existing enforce_build_task_spec trigger ('proposed' is non-draft).

-- Hard rule enforced structurally: agents can ONLY reach 'proposed' (via the keyless
-- Claude step → a post-step that calls propose_build_task with a service key). They have
-- no path to 'ready' — promote_proposed_task is Kevin's action. And the existing
-- enforce_build_task_spec trigger already requires a complete spec (why/files/change/
-- context/out_of_scope + acceptance.checks) for any non-draft status, so 'proposed'
-- inherits the spec-completeness bar automatically — no vague "improve the data" proposals.

-- 1. New state. (ADD VALUE is not used in evaluated DDL below — only inside function
--    bodies — so this applies cleanly in one migration.)

-- 2. propose_build_task — agents draft here. Caps proposals per agent per day so Kevin
--    isn't drowned. Spec completeness is enforced by the enforce_build_task_spec trigger
--    (fires because 'proposed' is non-draft) → a bad spec raises and the proposal is refused.
create or replace function public.propose_build_task(
  p_title text,
  p_tier integer,
  p_spec jsonb,
  p_acceptance jsonb,
  p_agent text,
  p_priority integer default 50,
  p_cap integer default 5
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_id uuid; v_today integer;
begin
  select count(*) into v_today
  from public.build_tasks
  where status = 'proposed' and created_by = p_agent and created_at::date = current_date;
  if v_today >= p_cap then
    raise exception 'propose cap reached for %: % proposed today (cap %)', p_agent, v_today, p_cap;
  end if;

  insert into public.build_tasks (title, tier, spec, acceptance, status, priority, created_by)
  values (p_title, p_tier, p_spec, p_acceptance, 'proposed', p_priority, p_agent)
  returning id into v_id;
  return v_id;
end $fn$;
grant execute on function public.propose_build_task(text,integer,jsonb,jsonb,text,integer,integer) to service_role;

-- 3. promote_proposed_task — KEVIN'S GATE. proposed → ready. Only this moves a proposal
--    into the builder's reach. Agents never call it.
create or replace function public.promote_proposed_task(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  update public.build_tasks set status = 'ready', updated_at = now()
  where id = p_id and status = 'proposed';
  if not found then raise exception 'no proposed task with id %', p_id; end if;
end $fn$;
grant execute on function public.promote_proposed_task(uuid) to service_role;

-- 4. reject_proposed_task — dismiss a proposal (audit trail via blocked_reason).
create or replace function public.reject_proposed_task(p_id uuid, p_reason text default 'rejected')
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  update public.build_tasks set status = 'blocked', blocked_reason = p_reason, updated_at = now()
  where id = p_id and status = 'proposed';
end $fn$;
grant execute on function public.reject_proposed_task(uuid,text) to service_role;

-- 5. list_proposed_tasks — for the daily "proposed tasks" Slack digest + Kevin's review.
create or replace function public.list_proposed_tasks()
returns table(id uuid, title text, tier integer, priority integer, created_by text, created_at timestamptz, spec jsonb)
language sql security definer set search_path to 'public' as $fn$
  select id, title, tier, priority, created_by, created_at, spec
  from public.build_tasks where status = 'proposed'
  order by created_at desc;
$fn$;
grant execute on function public.list_proposed_tasks() to service_role;

-- ROLLBACK (copy-paste):
--   drop function if exists public.list_proposed_tasks();
--   drop function if exists public.reject_proposed_task(uuid,text);
--   drop function if exists public.promote_proposed_task(uuid);
--   drop function if exists public.propose_build_task(text,integer,jsonb,jsonb,text,integer,integer);
--   -- (enum value 'proposed' cannot be dropped; harmless if left. Move any proposed rows first:
--   --  update build_tasks set status='draft' where status='proposed';)

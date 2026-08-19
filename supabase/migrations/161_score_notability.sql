-- 161_score_notability.sql
--
-- The reproducible model-knowledge notability layer. Turns the hand-seeded
-- model_notability scores into a generated, re-runnable pipeline: the
-- `score-notability` edge function (Google-blind Opus judgment) writes here,
-- keyed by source_signature so each item is scored once and reused until its
-- signature changes. A cron scans for unscored items so NEW items auto-score
-- and a new city is one run away.
--
-- Idempotent: the table already exists on staging (created direct during the
-- MVP); this migration makes it a versioned, prod-reproducible object.

-- 1. The table (model's raw per-item judgment; feeds the downstream blend).
create table if not exists public.model_notability (
  item_id uuid primary key references public.explore_items(id) on delete cascade,
  verdict text not null check (verdict in ('notable','fine','unsure')),
  confidence numeric,
  reason text,
  intent text,
  model text,
  source_signature text,
  scored_at timestamptz default now()
);
alter table public.model_notability add column if not exists intent text;
create index if not exists idx_model_notability_signature on public.model_notability(source_signature);

alter table public.model_notability enable row level security;
-- service_role only (like the enrichment tables); no public policy.
grant all on public.model_notability to service_role;

-- 2. Canonical signature: normalize(title) | lower(sub_category). MUST match the
-- edge function's signatureOf() so the cache lines up.
create or replace function public.notability_signature(p_title text, p_sub_category text)
returns text language sql immutable as $$
  select btrim(regexp_replace(lower(coalesce(p_title,'')), '[^a-z0-9]+', ' ', 'g'))
         || '|' || lower(coalesce(p_sub_category, ''));
$$;

-- 3. Cache-correct selection: items lacking a model_notability row for their
-- CURRENT signature (or everything in scope when p_force). The edge function
-- calls this to decide what to score.
create or replace function public.find_items_needing_notability(
  p_region_slug text default null,
  p_limit integer default 200,
  p_force boolean default false
)
returns table(item_id uuid, title text, sub_category text, town text)
language sql
security definer
set search_path to 'public'
as $$
  select ei.id, ei.title, ei.sub_category, coalesce(ei.town, '')
  from public.explore_items ei
  where coalesce(ei.is_admin_suppressed, false) = false
    and ei.relevance_tier >= 1
    and (p_region_slug is null
         or ei.region_id = (select id from public.region where slug = p_region_slug))
    and (p_force or not exists (
      select 1 from public.model_notability mn
      where mn.item_id = ei.id
        and mn.source_signature = public.notability_signature(ei.title, ei.sub_category)
    ))
  order by ei.relevance_tier desc, ei.title
  limit p_limit;
$$;
grant execute on function public.find_items_needing_notability(text, integer, boolean) to service_role;

-- 4. Budget counter for the Opus scorer (separate service so it's tracked apart
-- from the Haiku enrichment spend).
insert into public.api_usage_counters (service, period_start, requests_used, requests_limit)
values ('anthropic_opus_notability', date_trunc('month', now())::date, 0, 100000)
on conflict (service, period_start) do nothing;

-- 5. Hourly cron: scan for unscored items and score a bounded batch. Env-aware
-- (app_config empty on staging => no-op); never inlines the service key
-- (migration 145 pattern).
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('score-notability-run', '20 * * * *', $job$
      select net.http_post(
        url := (select value from public.app_config where key = 'supabase_url') || '/functions/v1/score-notability',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select value from public.app_config where key = 'service_role_key')
        ),
        body := '{"limit": 50}'::jsonb
      );
    $job$);
  end if;
end $do$;

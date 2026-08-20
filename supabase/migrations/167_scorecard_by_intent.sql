-- 167_scorecard_by_intent.sql
--
-- Re-key the curation scorecard from the OLD `category` taxonomy to the 6 INTENTS,
-- scored against the LIVE system (item_intents base mapping + is_carousel_eligible +
-- blended_notability + model_notability). The auditor is the engine of the propose loop;
-- scoring against the retired category map would point every proposal at the wrong things.
--
-- Keeps the `catalog` top-line keys stable (the audit-curation-quality edge fn upserts
-- them to curation_audit for week-over-week deltas). Per-item detail moves from
-- `categories` → `intents` (+ a `residue` mapping-health signal). Each auditor run
-- already recomputes this (gather_audit_inputs.sh calls the fn) — it only looked stale
-- because the fn wasn't deployed until the prod promotion.
--
-- coverage_pct stays NULL (Level-3 reference sets unbuilt) — noted, not blocking. We
-- score what's measurable now: per-intent eligibility, notability distribution,
-- completeness, event freshness, and unmapped (residue) counts.
--
-- ROLLBACK: restore the 153 body of compute_curation_scorecard() (git).

create or replace function public.compute_curation_scorecard()
returns jsonb
language sql
security definer
set search_path = public
as $$
with base as (
  select
    ei.id, ei.kind,
    coalesce(r.slug, 'unassigned') as region_slug,
    coalesce(r.name, 'Unassigned') as region_name,
    i.slug as intent,
    (ei.lat is not null and ei.lng is not null
       and ei.hook_line is not null and length(ei.hook_line) >= 10
       and ei.image_url is not null)                              as complete,
    (ei.kind = 'event')                                           as is_event,
    (ei.kind = 'event' and ei.starts_at is not null
       and (ei.ends_at is null or ei.ends_at >= now()))           as event_upcoming,
    coalesce(ei.is_carousel_eligible, false)                      as eligible,
    ei.blended_notability,
    mn.verdict                                                    as model_verdict
  from public.explore_items ei
  join public.item_intents ii on ii.item_id = ei.id and ii.is_primary and ii.source = 'base'
  join public.intents i on i.id = ii.intent_id
  left join public.region r on r.id = ei.region_id
  left join public.model_notability mn on mn.item_id = ei.id
  where ei.priority >= 0 and ei.deleted_at is null and coalesce(ei.is_admin_suppressed,false) = false
    and (ei.review_status is null or ei.review_status in ('auto_approved','approved'))
),
per as (
  select region_slug, region_name, intent,
    count(*)                                            as total,
    count(*) filter (where eligible)                    as eligible_n,
    count(*) filter (where complete)                    as complete_n,
    count(*) filter (where is_event)                    as events_total,
    count(*) filter (where is_event and event_upcoming) as events_upcoming_n,
    count(*) filter (where model_verdict = 'notable')   as notable_n,
    count(*) filter (where model_verdict = 'fine')      as fine_n,
    count(*) filter (where model_verdict = 'unsure')    as unsure_n,
    count(*) filter (where model_verdict is null)       as unscored_n,
    round(avg(blended_notability) filter (where eligible), 2) as avg_blended_eligible
  from base group by region_slug, region_name, intent
),
scored as (
  select *,
    round(100.0 * eligible_n / nullif(total,0), 1)  as eligible_pct,
    round(100.0 * complete_n / nullif(total,0), 1)  as completeness_pct,
    round(100.0 * notable_n  / nullif(total,0), 1)  as pct_notable,
    round(100.0 * unscored_n / nullif(total,0), 1)  as pct_unscored,
    case when events_total > 0 then round(100.0 * events_upcoming_n / events_total, 1) else null end as event_freshness_pct
  from per
),
final as (
  select *,
    -- intent scorecard = curation (eligibility) + presentation (completeness) + notability coverage (scored)
    round( coalesce(eligible_pct,0) * 0.4
         + coalesce(completeness_pct,0) * 0.3
         + (100 - coalesce(pct_unscored,0)) * 0.3 ) as scorecard_pct
  from scored
)
select jsonb_build_object(
  'generated_at', now(),
  'keyed_by', 'intent',
  'notes', 'Per-(region,intent) scorecard vs the live carousel-eligibility + blended-notability + model_notability system. coverage_pct NULL pending Level-3 reference sets (§10).',
  -- top-line keys kept STABLE for the edge-fn upsert (card_ready == carousel-eligible now)
  'catalog', (
    select jsonb_build_object(
      'total_items',               coalesce(sum(total),0),
      'card_ready_items',          coalesce(sum(eligible_n),0),
      'card_ready_pct',            round(100.0 * coalesce(sum(eligible_n),0) / nullif(sum(total),0), 1),
      'avg_completeness_pct',      round(avg(completeness_pct)::numeric, 1),
      'avg_event_freshness_pct',   round(avg(event_freshness_pct)::numeric, 1),
      'avg_notability_confidence', round(100.0 * coalesce(sum(notable_n),0) / nullif(sum(total),0), 1),
      'intent_count',              count(distinct intent),
      'region_count',              count(distinct region_slug)
    ) from final
  ),
  'intents', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'region', region_slug, 'region_name', region_name, 'intent', intent,
      'total', total, 'eligible', eligible_n, 'eligible_pct', eligible_pct,
      'avg_blended_eligible', avg_blended_eligible,
      'completeness_pct', completeness_pct,
      'events_total', events_total, 'event_freshness_pct', event_freshness_pct,
      'notable', notable_n, 'fine', fine_n, 'unsure', unsure_n, 'unscored', unscored_n,
      'pct_notable', pct_notable, 'pct_unscored', pct_unscored,
      'coverage_pct', null,
      'scorecard_pct', scorecard_pct
    ) order by scorecard_pct asc nulls first, total desc), '[]'::jsonb)
    from final
  ),
  -- mapping health: items that map to NO base intent (residue) per region
  'residue', (
    select coalesce(jsonb_agg(jsonb_build_object('region', rs, 'unmapped', n) order by n desc), '[]'::jsonb)
    from (
      select coalesce(r.slug,'unassigned') rs, count(*) n
      from public.explore_items ei
      left join public.region r on r.id = ei.region_id
      where ei.priority >= 0 and ei.deleted_at is null and coalesce(ei.is_admin_suppressed,false) = false
        and ei.relevance_tier >= 1
        and not exists (select 1 from public.item_intents ii where ii.item_id = ei.id and ii.is_primary and ii.source = 'base')
      group by rs
    ) x
  )
);
$$;

grant execute on function public.compute_curation_scorecard() to service_role;
comment on function public.compute_curation_scorecard() is
  'North Star scorecard per (region, INTENT) vs the live eligibility/blend/model_notability system (migration 167). coverage_pct NULL pending Level-3 reference sets. Read-only.';

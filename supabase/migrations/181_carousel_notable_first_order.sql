-- 181_carousel_notable_first_order.sql
--
-- Notable-first ordering WITHIN each carousel (Kevin's Wave-2 refinement). The browse
-- carousels display by blended_notability desc (groupingEngine.carouselRankValue), which
-- does NOT guarantee genuine gems lead: a merely-`fine` place with a very high Google
-- rating can out-blend a modest `notable` place, so padding could sit above a gem. In a
-- thin market (Potsdam) that reads as "random mix"; the fix makes every carousel read
-- gems-first, then the real-but-ordinary places trailing — curated-at-the-top even when
-- notability is scarce.
--
-- We do this as a pure DISPLAY-ORDER change, NOT by inflating blended_notability: that
-- column is a shared magnitude with threshold semantics — trim_region_sprawl (178/179)
-- exempts items with blended_notability >= 4.5 from the region-proximity trim, and the
-- scorecard (167) averages it. A tier offset there would exempt every notable item from
-- sprawl-trimming and corrupt the metric. Instead we denormalize the model verdict onto
-- explore_items so the client can sort notable-first as a tiebreaker ABOVE blended, while
-- the eligible SET and blended magnitude stay exactly as approved.
--
-- `select("*")` (backfill) and the explore RPC's `SELECT e.*` both already pass every
-- explore_items column to the client, so no RPC signature change is needed — the new
-- column flows through automatically and the grouping engine reads it off the raw row.
--
-- ROLLBACK: re-run 180's refresh_carousel_eligibility body (without the model_verdict SET);
-- drop column explore_items.model_verdict.

alter table public.explore_items add column if not exists model_verdict text;

comment on column public.explore_items.model_verdict is
  'Denormalized model_notability.verdict (notable|fine|unsure|null), written by '
  'refresh_carousel_eligibility. DISPLAY-ORDER ONLY — the client sorts notable-first '
  'above blended_notability so carousels read gems-first. Not a threshold; do not blend.';

create or replace function public.refresh_carousel_eligibility(p_region_slug text)
returns integer
language plpgsql security definer set search_path to 'public'
as $fn$
declare v_n integer;
begin
  update public.explore_items ei set is_carousel_eligible = false
  from public.item_intents ii join public.intents i on i.id = ii.intent_id
  where ii.item_id = ei.id and ii.is_primary and ii.source = 'base'
    and i.slug in ('get_a_bite','grab_a_drink','get_outside','see_something')
    and ei.kind::text = 'activity'
    and ei.region_id = (select id from public.region where slug = p_region_slug);

  with base as (
    select ei.id, i.slug as intent, ei.title,
      coalesce(ei.notability_score,0) as google_notab,
      coalesce((ei.notability_provenance->>'no_signal') is distinct from 'true', false) as google_ok,
      mn.verdict as model_verdict, coalesce(mn.confidence,0) as model_conf,
      coalesce(es.bestof_count,0) as bestof, coalesce(es.cross_source_count,0) as cross_src
    from public.explore_items ei
    join public.item_intents ii on ii.item_id = ei.id and ii.is_primary and ii.source = 'base'
    join public.intents i on i.id = ii.intent_id and i.slug in ('get_a_bite','grab_a_drink','get_outside','see_something')
    join public.region r on r.id = ei.region_id and r.slug = p_region_slug
    left join public.model_notability mn on mn.item_id = ei.id
    left join public.editorial_signal es on es.item_id = ei.id
    where ei.kind::text = 'activity' and coalesce(ei.is_admin_suppressed,false) = false and ei.relevance_tier >= 1
  ),
  flags as (
    select *,
      (model_verdict = 'notable' and not (bestof >= 1 or (google_ok and google_notab >= 3.3))) as flagged_uncorroborated,
      round((3.0 * (case when model_verdict = 'notable' then model_conf else 0 end)
           + 3.0 * greatest(0, least(1, (google_notab - 3.8) / 1.0))
           + 0.5 * least(bestof,3) + 0.3 * least(cross_src,3)
           + 0.4 * google_notab)::numeric, 3) as blended
    from base
  ),
  elig as (
    select *,
      (not flagged_uncorroborated and (model_verdict = 'notable' or bestof >= 1 or google_ok)) as eligible_candidate
    from flags
  ),
  ranked as (
    select *,
      case when eligible_candidate then
        row_number() over (partition by intent, eligible_candidate order by blended desc, title)
      end as rank_in_intent,
      count(*) filter (where eligible_candidate) over (partition by intent) as pool
    from elig
  ),
  final as (
    select id, blended, model_verdict,
      (eligible_candidate and rank_in_intent <= least(30, greatest(5, round(pool * 0.25)))) as elig
    from ranked
  )
  update public.explore_items ei
    set blended_notability = f.blended,
        is_carousel_eligible = f.elig,
        model_verdict = f.model_verdict
  from final f where f.id = ei.id;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

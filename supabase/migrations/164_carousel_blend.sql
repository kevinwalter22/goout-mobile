-- 164_carousel_blend.sql
--
-- The agreement-weighted blend + hallucination guard + region-relative cutoff, as a
-- re-runnable per-region FUNCTION that writes is_carousel_eligible + blended_notability
-- onto explore_items (was a staging-direct script into a temp table).
--
-- REPRODUCIBLE CORE = model + Google. editorial_signal is optional: when empty,
-- corroboration falls back to a solid operating Google presence, and the blended
-- score's editorial terms are simply 0 — the guard still holds (model-notable-but-
-- uncorroborated is flagged out), and the iconic anchors stay eligible on model+Google.
--
-- NOT backfilled on deploy: it reads model_notability, which the score-notability
-- generator (161) populates first. Prod sequence: deploy -> run score-notability over
-- the catalog -> run refresh_carousel_eligibility(region) -> carousels populate.

create or replace function public.refresh_carousel_eligibility(p_region_slug text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_n integer;
begin
  -- Clear the region's static-intent activities first (clean re-run).
  update public.explore_items ei set is_carousel_eligible = false
  from public.item_intents ii
  join public.intents i on i.id = ii.intent_id
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
      (bestof >= 1 or (google_ok and google_notab >= 3.3)) as corroborated,
      (model_verdict = 'notable' and not (bestof >= 1 or (google_ok and google_notab >= 3.3))) as flagged_uncorroborated,
      -- MODEL PRIMARY: the model carries a place on its confidence when Google verifies
      -- existence; editorial BOOSTS but doesn't gate.
      round((4.0 * (case when model_verdict = 'notable' then model_conf else 0 end)
           + 0.5 * least(bestof,3) + 0.3 * least(cross_src,3)
           + 0.4 * google_notab)::numeric, 3) as blended
    from base
  ),
  elig as (
    select *,
      (not flagged_uncorroborated and ((model_verdict = 'notable' and corroborated) or bestof >= 1)) as eligible_candidate
    from flags
  ),
  ranked as (
    select *,
      case when eligible_candidate then
        row_number() over (partition by intent, eligible_candidate order by blended desc, title)
      end as rank_in_intent,
      count(*) over (partition by intent) as pool
    from elig
  ),
  final as (
    select id, blended,
      (eligible_candidate and rank_in_intent <= least(30, greatest(5, round(pool * 0.25)))) as elig
    from ranked
  )
  update public.explore_items ei
    set blended_notability = f.blended, is_carousel_eligible = f.elig
  from final f
  where f.id = ei.id;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

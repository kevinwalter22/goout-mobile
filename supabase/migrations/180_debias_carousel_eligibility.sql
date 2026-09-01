-- 180_debias_carousel_eligibility.sql
--
-- Region-relative + de-biased carousel eligibility. The 164 blend made candidacy REQUIRE
-- model_verdict='notable' and weighted the model at 4.0, so a place locals love but the
-- model doesn't nationally recognize (Bellvale Farms Creamery — Google 4.79 but model
-- 'unsure') was excluded and scored ~1.9 — starving smaller markets. This:
--   • adds a LOCAL-LOVE term (a strong Google rating == locals love it) so such a place
--     can qualify + rank on local signal even without model recognition;
--   • broadens candidacy to any real, non-hallucinated place with SOME signal;
--   • keeps the per-region + per-intent top-25% rank as the curator, so each market
--     surfaces ITS best (not Portland's absolute bar) without flooding.
--
-- Validated on prod: Warwick get_a_bite ~4 → ~25 eligible with Bellvale + the local
-- cideries/breweries surfacing; Potsdam surfaces Remington + its real local spots; and
-- with the model-town fix the Portland carousels hold (3/58 marginal) while ~35 buried
-- gems recover. Also wires eligibility for ALL regions (was Portland-only) + a cron.
--
-- ROLLBACK: re-run 164's refresh_carousel_eligibility body; drop refresh_all_* + the cron.

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
      -- Hallucination guard (unchanged): model says notable but nothing corroborates it.
      (model_verdict = 'notable' and not (bestof >= 1 or (google_ok and google_notab >= 3.3))) as flagged_uncorroborated,
      -- De-biased blend: model recognition (3.0) + LOCAL LOVE (Google rating, 0 at 3.8 →
      -- +3.0 at 4.8) so a locally-beloved place ranks even if the model doesn't recognize
      -- it; + editorial + a light Google term.
      round((3.0 * (case when model_verdict = 'notable' then model_conf else 0 end)
           + 3.0 * greatest(0, least(1, (google_notab - 3.8) / 1.0))
           + 0.5 * least(bestof,3) + 0.3 * least(cross_src,3)
           + 0.4 * google_notab)::numeric, 3) as blended
    from base
  ),
  elig as (
    select *,
      -- Region-relative candidacy: any real, non-hallucinated place with SOME signal
      -- (model-recognized OR editorial OR a live Google presence). The rank curates.
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
    select id, blended,
      -- Top 25% of the intent's CANDIDATES per region (min 5 so a thin market isn't
      -- starved, max 30 so a dense one isn't flooded).
      (eligible_candidate and rank_in_intent <= least(30, greatest(5, round(pool * 0.25)))) as elig
    from ranked
  )
  update public.explore_items ei
    set blended_notability = f.blended, is_carousel_eligible = f.elig
  from final f where f.id = ei.id;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- Run eligibility for EVERY active region (the deploy loop was Portland-only — which is
-- why the ingestion refill never populated Warwick/Potsdam carousels).
create or replace function public.refresh_all_carousel_eligibility()
returns void language plpgsql security definer set search_path to 'public'
as $$
declare r record;
begin
  for r in select slug from public.region where is_active order by display_order loop
    perform public.refresh_carousel_eligibility(r.slug);
  end loop;
end $$;

-- Keep carousels fresh as new items ingest + get scored (daily, after score-notability).
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'refresh-carousel-eligibility-daily') then
    perform cron.schedule('refresh-carousel-eligibility-daily', '0 6 * * *',
      'select public.refresh_all_carousel_eligibility();');
  end if;
end $$;

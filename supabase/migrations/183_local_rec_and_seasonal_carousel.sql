-- 183_local_rec_and_seasonal_carousel.sql
--
-- Two carousel-selection fixes (both live in refresh_carousel_eligibility):
--
-- (1) LOCAL CIVIC/RECREATION FLOOR — surface review-less local staples.
--     A town's own public-recreation places (municipal parks, disc-golf courses, public
--     trails/fields) are genuine local staples locals name, but Google barely reviews them
--     and the model doesn't nationally recognize them — so notability buries them (Warwick
--     Town Park: fine, g=3.28, blended 1.31; Warwick Town Park Disc Golf: fine, g=null,
--     blended 0.00; The Oasis DGC: unsure, g=2.16, blended 0.86 — all ineligible). The
--     de-biased local-love term only fires at Google>=3.8, so it misses these. Fix: a
--     LOCAL public-rec place (a park/golf/disc-golf/trail sub-type OR tagged 'parks',
--     WITHIN the proximity zone) is a civic candidate on its own, and its carousel rank
--     score gets a FLOOR so it competes for a slot. Scoped to LOCAL only (proximity) so it
--     lifts a town's own staples, never far random fields. Floors the SEPARATE rank score,
--     not blended_notability (which stays the sprawl/scorecard threshold).
--
-- (2) SEASONAL HIDE — out-of-season activities drop from carousels. Seasonality (034,
--     availability_json.available_seasons + is_available_in_season) was applied by the
--     feed RPC but NOT by carousel eligibility, so a ski area showed in September. Fix:
--     eligibility now requires the item to be in-season for get_current_season(); the daily
--     refresh cron re-evaluates, so winter things reappear when winter starts. Also
--     backfills available_seasons for clearly-winter items (skiing/snowboarding/ski-resort)
--     that enrichment left untagged — Mount Peter had only descriptive tags, no structured
--     season, so nothing could hide it.
--
-- ROLLBACK: re-run 182's refresh_carousel_eligibility body; the season backfill is additive
-- (safe to leave) but can be undone by nulling available_seasons on the affected rows.

-- ── 1. backfill structured winter seasonality where enrichment left it null ───────────
update public.explore_items
set availability_json = jsonb_set(
      coalesce(availability_json, '{}'::jsonb), '{available_seasons}', '["winter"]'::jsonb, true)
where kind::text = 'activity'
  and (availability_json->'available_seasons') is null
  and (
    sub_category ~* 'ski'
    or tags && array['skiing','snowboarding','winter_activity','snow_tubing']
  );

-- ── 2. selection: local civic/rec floor + seasonal hide ──────────────────────────────
create or replace function public.refresh_carousel_eligibility(p_region_slug text)
returns integer
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_n integer;
  v_season text := public.get_current_season();
  v_civic_floor numeric := 3.5;   -- rank-score floor lifting thin-signal in-town rec staples above typical carousel cutoffs (tunable)
  v_local_rec_radius numeric := 6; -- "in-town + immediately adjacent" for a civic staple; NOT the 18mi catchment (tunable)
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
      coalesce(es.bestof_count,0) as bestof, coalesce(es.cross_source_count,0) as cross_src,
      case when ei.lat is null or ei.lng is null then 0
        else 3959 * acos(least(1, greatest(-1,
               cos(radians(r.center_lat)) * cos(radians(ei.lat)) *
               cos(radians(ei.lng) - radians(r.center_lng)) +
               sin(radians(r.center_lat)) * sin(radians(ei.lat))
             ))) end as dist_miles,
      coalesce(pc.decay_scale_miles, 30) as decay_scale,
      coalesce(r.proximity_radius_miles, r.radius_miles) as prox_radius,
      -- a LOCAL public-recreation staple: a park/golf/disc-golf/trail/preserve sub-type,
      -- or tagged 'parks', that a resident actually uses.
      (ei.sub_category ~* '(park|golf|trail|preserve|campground|athletic field|playground|botanical|recreation)'
        or 'parks' = any(coalesce(ei.tags, array[]::text[]))) as rec_type,
      -- in-season for the current season (null/year_round items are always available)
      coalesce(public.is_available_in_season(ei.availability_json, v_season), true) as in_season
    from public.explore_items ei
    join public.item_intents ii on ii.item_id = ei.id and ii.is_primary and ii.source = 'base'
    join public.intents i on i.id = ii.intent_id and i.slug in ('get_a_bite','grab_a_drink','get_outside','see_something')
    join public.region r on r.id = ei.region_id and r.slug = p_region_slug
    left join public.model_notability mn on mn.item_id = ei.id
    left join public.editorial_signal es on es.item_id = ei.id
    left join public.intent_proximity_config pc on pc.intent_slug = i.slug
    where ei.kind::text = 'activity' and coalesce(ei.is_admin_suppressed,false) = false and ei.relevance_tier >= 1
  ),
  flags as (
    select *,
      -- a genuine IN-TOWN civic/rec staple (a few miles, not the whole catchment) — so a
      -- 16mi county park or a 14mi golf club never counts as "the town's own" staple.
      (rec_type and dist_miles <= v_local_rec_radius) as is_local_rec,
      (model_verdict = 'notable' and not (bestof >= 1 or (google_ok and google_notab >= 3.3))) as flagged_uncorroborated,
      round((3.0 * (case when model_verdict = 'notable' then model_conf else 0 end)
           + 3.0 * greatest(0, least(1, (google_notab - 3.8) / 1.0))
           + 0.5 * least(bestof,3) + 0.3 * least(cross_src,3)
           + 0.4 * google_notab)::numeric, 3) as blended
    from base
  ),
  scored as (
    select *,
      -- proximity-decayed notability, FLOORED for local civic/rec staples so a beloved
      -- review-less town park/disc-golf competes for a slot instead of scoring ~0.
      round(greatest(
        blended * exp(- dist_miles / nullif(decay_scale, 0)),
        case when is_local_rec then v_civic_floor else 0 end
      )::numeric, 3) as rank_score
    from flags
  ),
  elig as (
    select *,
      -- candidacy: the existing de-biased gate OR a genuine local civic/rec staple; AND in-season.
      ((not flagged_uncorroborated and (model_verdict = 'notable' or bestof >= 1 or google_ok))
        or is_local_rec)
       and in_season as eligible_candidate
    from scored
  ),
  ranked as (
    select *,
      case when eligible_candidate then
        row_number() over (partition by intent, eligible_candidate order by rank_score desc, title)
      end as rank_in_intent,
      count(*) filter (where eligible_candidate) over (partition by intent) as pool
    from elig
  ),
  final as (
    -- Standard top-25% proximity cut (min 5 / max 30). The civic FLOOR (above) lifts a
    -- thin-signal in-town rec staple to a competitive rank so it clears this cut instead of
    -- scoring ~0 — surfacing the town's own park/course WITHOUT force-including every park
    -- in the catchment (which floods a park-dense city). The cut still bounds the count.
    select id, blended, model_verdict, rank_score,
      (eligible_candidate and rank_in_intent <= least(30, greatest(5, round(pool * 0.25)))) as elig
    from ranked
  )
  update public.explore_items ei
    set blended_notability = f.blended,
        is_carousel_eligible = f.elig,
        model_verdict = f.model_verdict,
        carousel_rank_score = f.rank_score
  from final f where f.id = ei.id;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

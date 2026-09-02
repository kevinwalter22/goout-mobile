-- 182_proximity_aware_carousel_selection.sql
--
-- Distance-aware, intent-varying, LOCAL-FIRST carousel selection. The de-biased blend
-- (180) + notable-first order (181) rank by notability ALONE — no distance factor — so a
-- notable bar 15mi away beats a good local bar 2mi away, and a town's own local parks get
-- buried under famous-farther destinations (Croton Gorge, Rockefeller) that are notable but
-- not IN the town. That violates the principle: what a local who LIVES THERE would
-- recommend. "Grab a drink in Warwick" is not a bar half an hour away.
--
-- THE MODEL — proximity as a multiplicative, per-intent decay on notability:
--   carousel_rank_score = blended_notability * exp(-distance_from_center / decay_scale)
--   • close  → factor ~1 (full notability)         • far → factor decays toward 0
--   • decay_scale is PER-INTENT (config, tunable):
--       - GET A BITE / GRAB A DRINK  → TIGHT (small scale): everyday local acts. A 15mi
--         bite is strongly suppressed; in-town + immediately adjacent dominate.
--       - GET OUTSIDE / SEE SOMETHING / GO PLAY → WIDE (large scale): people drive to
--         parks/museums, so a notable destination 15-20mi out stays legitimate.
-- This is LOCAL-FIRST by construction, not a hard cap: local notable places win the slots;
-- a far place only surfaces when its (decayed) score still clears the pack — i.e. when the
-- town genuinely lacks closer options ("closest good beer is the next town over"). It ALSO
-- surfaces a town's own local parks (0 distance → no decay) that previously lost to
-- famous-farther ones. Keeps the de-biased notability + hallucination guard (180) and the
-- notable-first display tier (181) exactly as-is; distance is layered ON TOP.
--
-- blended_notability is deliberately LEFT as the pure notability magnitude (it is a shared
-- threshold — trim_region_sprawl 178/179 gate on blended>=4.5, scorecard 167 averages it).
-- The proximity-weighted value is a SEPARATE column, carousel_rank_score, used only for the
-- eligibility cut + carousel display order.
--
-- ROLLBACK: re-run 181's refresh_carousel_eligibility body; drop carousel_rank_score +
-- intent_proximity_config.

-- ── 1. per-intent distance tolerance (config, tunable without a code change) ──────────
create table if not exists public.intent_proximity_config (
  intent_slug       text primary key,
  decay_scale_miles numeric not null,
  note              text
);
comment on table public.intent_proximity_config is
  'Per-intent proximity decay scale (miles) for carousel_rank_score = blended * exp(-dist/scale). '
  'Small = TIGHT (food/drink, local everyday); large = WIDE (destinations you drive to). Tunable.';

insert into public.intent_proximity_config (intent_slug, decay_scale_miles, note) values
  ('get_a_bite',    6,  'TIGHT — everyday local act; a 15mi bite is not "eat here"'),
  ('grab_a_drink',  6,  'TIGHT — everyday local act; a 15mi bar is not "grab a drink here"'),
  ('get_outside',   30, 'WIDE — people drive to parks/trails/beaches'),
  ('see_something', 30, 'WIDE — people drive to museums/landmarks/attractions'),
  ('go_play',       30, 'WIDE — destinations (future carousel intent)')
on conflict (intent_slug) do update
  set decay_scale_miles = excluded.decay_scale_miles, note = excluded.note;

-- ── 2. proximity-weighted rank score column (selection + display; NOT a threshold) ───
alter table public.explore_items add column if not exists carousel_rank_score numeric;
comment on column public.explore_items.carousel_rank_score is
  'Proximity-weighted carousel score = blended_notability * exp(-dist_from_center/decay_scale). '
  'Written by refresh_carousel_eligibility. Drives the eligibility cut + carousel display '
  'order (under the notable-first tier). NOT a threshold — never gate sprawl/scorecard on it.';

-- ── 3. selection with local-first proximity decay ────────────────────────────────────
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
      coalesce(es.bestof_count,0) as bestof, coalesce(es.cross_source_count,0) as cross_src,
      -- distance from the town center (miles). Null-location items are region-assigned
      -- but un-geocoded → treat as local (0 → no distance penalty).
      case when ei.lat is null or ei.lng is null then 0
        else 3959 * acos(least(1, greatest(-1,
               cos(radians(r.center_lat)) * cos(radians(ei.lat)) *
               cos(radians(ei.lng) - radians(r.center_lng)) +
               sin(radians(r.center_lat)) * sin(radians(ei.lat))
             ))) end as dist_miles,
      coalesce(pc.decay_scale_miles, 30) as decay_scale
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
      (model_verdict = 'notable' and not (bestof >= 1 or (google_ok and google_notab >= 3.3))) as flagged_uncorroborated,
      round((3.0 * (case when model_verdict = 'notable' then model_conf else 0 end)
           + 3.0 * greatest(0, least(1, (google_notab - 3.8) / 1.0))
           + 0.5 * least(bestof,3) + 0.3 * least(cross_src,3)
           + 0.4 * google_notab)::numeric, 3) as blended
    from base
  ),
  scored as (
    -- LOCAL-FIRST: notability decayed by distance, decay rate per intent (food/drink tight,
    -- destinations wide). Close local places keep ~full notability; far ones are suppressed.
    select *,
      round((blended * exp(- dist_miles / nullif(decay_scale, 0)))::numeric, 3) as rank_score
    from flags
  ),
  elig as (
    select *,
      (not flagged_uncorroborated and (model_verdict = 'notable' or bestof >= 1 or google_ok)) as eligible_candidate
    from scored
  ),
  ranked as (
    -- The CUT now ranks by the proximity-weighted score → far bite/drink don't make the
    -- carousel; a town's own local spots (incl. local parks) get a fair shot.
    select *,
      case when eligible_candidate then
        row_number() over (partition by intent, eligible_candidate order by rank_score desc, title)
      end as rank_in_intent,
      count(*) filter (where eligible_candidate) over (partition by intent) as pool
    from elig
  ),
  final as (
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

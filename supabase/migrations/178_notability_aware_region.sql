-- 178_notability_aware_region.sql
--
-- Replaces the hard-radius region cut (177) with a REUSABLE, all-regions rule:
--   • within the PROXIMITY zone (drawn bbox, else proximity_radius_miles) →
--     included by proximity, as before;
--   • BEYOND proximity but within the region's outer catchment (radius_miles) →
--     included ONLY if the item clears a high notability bar (a genuine regional
--     destination a local would name — Storm King, Dia:Beacon, Minnewaska),
--     dropped if it's just sprawl (a random Paterson business).
--
-- Encodes how a local actually thinks: "Paterson isn't Warwick, but Storm King is,
-- even if it's a drive." Applies to EVERY region (Portland has spots an hour out,
-- Potsdam has beyond-radius state parks) so we stop re-solving this per region.
--
-- Model: radius_miles = OUTER catchment used by resolve_region (unchanged) for
-- ASSIGNMENT; proximity_radius_miles = INNER "always-in" zone. When proximity is
-- null the drawn bbox is the proximity zone (Portland). resolve_region is untouched
-- (still assigns within the catchment); a reusable trim then removes beyond-proximity
-- sprawl while keeping beyond-proximity notable destinations.
--
-- Supersedes 177's hard 18mi cut (this restores Warwick's catchment to 30 and
-- re-admits the notable-far destinations 177 nulled). Idempotent + re-runnable.
-- ROLLBACK: drop trim_region_sprawl + the cron; region.radius_miles unaffected.

-- ── 1. proximity radius column ───────────────────────────────────────────────
alter table public.region add column if not exists proximity_radius_miles numeric;

-- Warwick: catchment back to 30 (was tightened to 18 by 177), proximity 18.
update public.region set radius_miles = 30, proximity_radius_miles = 18 where slug = 'warwick-ny';
-- Potsdam: catchment stays 30, proximity 18.
update public.region set proximity_radius_miles = 18 where slug = 'potsdam-ny';
-- Portland: bbox is the proximity zone → leave proximity_radius_miles null;
-- radius_miles (35) is the notable-destination catchment beyond the bbox.

-- ── 2. re-assign items the 177 hard-cut nulled (they fall back inside the 30mi
--       catchment). resolve_region only assigns within a region, so national /
--       out-of-range items stay null. ────────────────────────────────────────
update public.explore_items
set region_id = public.resolve_region(lat, lng)
where region_id is null and lat is not null and lng is not null;

-- ── 3. reusable notability-aware trim ────────────────────────────────────────
-- Null region_id for items BEYOND the proximity zone that are NOT a notable regional
-- destination. "Notable destination" = blended_notability >= p_notable_bar (the blend
-- folds in the model's "is this a recognized destination" verdict, which — unlike a
-- raw Google rating — distinguishes a landmark like Storm King from a well-reviewed
-- corner restaurant) AND in a category you'd actually travel for. Food & Drink and
-- Nightlife are proximity conveniences, not drive-to destinations — and that's where
-- brand-name chains (Shake Shack, Ben & Jerry's) that the model scores highly but
-- chain-detection misses would otherwise leak in. So a genuine destination (a park,
-- museum, historic site, major anchor) survives at any distance within the catchment;
-- far sprawl, chains, and far food/nightlife drop. Runs over ALL regions.
-- (Membership only — curation/eligibility still decides what tops a carousel.)
create or replace function public.trim_region_sprawl(p_notable_bar numeric default 4.5)
returns integer language plpgsql
security definer set search_path = public as $$
declare n integer;
begin
  update public.explore_items ei
  set region_id = null
  from public.region r
  where ei.region_id = r.id
    and ei.lat is not null and ei.lng is not null
    and ei.deleted_at is null
    -- outside the proximity zone: NOT inside the drawn bbox ...
    and not (r.min_lat is not null
             and ei.lat between r.min_lat and r.max_lat
             and ei.lng between r.min_lng and r.max_lng)
    -- ... AND beyond the proximity radius (falls back to catchment when proximity null)
    and 3959 * acos(least(1, greatest(-1,
          cos(radians(r.center_lat)) * cos(radians(ei.lat)) *
          cos(radians(ei.lng) - radians(r.center_lng)) +
          sin(radians(r.center_lat)) * sin(radians(ei.lat))
        ))) > coalesce(r.proximity_radius_miles, r.radius_miles)
    -- ... AND not a notable, travel-worthy regional destination
    and (coalesce(ei.blended_notability, 0) < p_notable_bar
         OR ei.category in ('Food & Drink', 'Nightlife'));
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 4. apply now ─────────────────────────────────────────────────────────────
select public.trim_region_sprawl();

-- ── 5. durable: trim daily so new sprawl is removed while notable-far stays ───
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'trim-region-sprawl-daily') then
    perform cron.schedule('trim-region-sprawl-daily', '30 4 * * *', 'select public.trim_region_sprawl();');
  end if;
end $$;

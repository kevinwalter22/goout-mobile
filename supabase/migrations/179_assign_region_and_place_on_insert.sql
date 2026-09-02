-- 179_assign_region_and_place_on_insert.sql
--
-- FIX: a user-created event saves successfully (RLS fix, 176) but then VANISHES from
-- the feed. Root cause — a fresh insert never gets the two fields the feed + map
-- hard-filter on, so it's excluded the moment the region resolves / the feed refetches:
--   • region_id was NULL (useCreateEvent never set it) → excluded by the region hard
--     filter (exploreQuery region_id = active region; the RPC's p_region_id predicate);
--   • is_place was false (no item_intents row on a brand-new event) → excluded by the
--     MAP + LIST is_place gate (migration 171: exploreQuery.ts:457/510, ExploreMapView:382).
-- It "showed briefly then disappeared" because the first post-reload query ran before
-- the region resolved (unscoped → visible), then the region-scoped refetch dropped it.
--
-- Also: exempt user-created items from the notability-aware sprawl trim (178) so the
-- region change can never trim a user's own event out of its region.

-- ── 1. auto-assign region_id from coords on insert (all items), and mark user-created
--       items as places (first-party content is always feed/map-eligible). ──────────
create or replace function public.assign_region_and_place()
returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.region_id is null and new.lat is not null and new.lng is not null then
    new.region_id := public.resolve_region(new.lat, new.lng);
  end if;
  if new.created_by_user_id is not null then
    new.is_place := true;   -- a user's own event/place is always eligible for feed + map
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_region_and_place on public.explore_items;
create trigger trg_assign_region_and_place
  before insert on public.explore_items
  for each row execute function public.assign_region_and_place();

-- ── 2. backfill existing user-created items missing region_id / is_place ───────────
update public.explore_items
set region_id = coalesce(region_id, public.resolve_region(lat, lng)),
    is_place = true
where created_by_user_id is not null
  and (region_id is null or is_place = false)
  and lat is not null and lng is not null;

-- ── 3. never trim a user-created item out of its region (first-party content) ──────
--       (re-defines 178's trim with a created_by_user_id guard; otherwise unchanged.)
create or replace function public.trim_region_sprawl(p_notable_bar numeric default 4.5)
returns integer language plpgsql
security definer set search_path = public as $$
declare n integer;
begin
  update public.explore_items ei
  set region_id = null
  from public.region r
  where ei.region_id = r.id
    and ei.created_by_user_id is null            -- never trim first-party (user) items
    and ei.lat is not null and ei.lng is not null
    and ei.deleted_at is null
    and not (r.min_lat is not null
             and ei.lat between r.min_lat and r.max_lat
             and ei.lng between r.min_lng and r.max_lng)
    and 3959 * acos(least(1, greatest(-1,
          cos(radians(r.center_lat)) * cos(radians(ei.lat)) *
          cos(radians(ei.lng) - radians(r.center_lng)) +
          sin(radians(r.center_lat)) * sin(radians(ei.lat))
        ))) > coalesce(r.proximity_radius_miles, r.radius_miles)
    and (coalesce(ei.blended_notability, 0) < p_notable_bar
         OR ei.category in ('Food & Drink', 'Nightlife'));
  get diagnostics n = row_count;
  return n;
end $$;

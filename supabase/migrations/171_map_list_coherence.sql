-- 171_map_list_coherence.sql
--
-- Three-view coherence for the App Store submit (see docs/three_view_model.md):
--   MAP  = proximity  → real places near me, errands/chains excluded
--   CARD = curation   → notable places (is_carousel_eligible, the notability blend)
--   LIST = social     → what my network is doing (Phase 3); INTERIM = notability-ordered
-- MAP + LIST share ONE data set: real places (is_place), NOT the phone-book inventory.
--
-- 1. is_place — the shared MAP+LIST filter. Single source of truth = item_intents
--    (migration 163): its residue_sub denylist routes errands (gym/spa/salon/church/
--    thrift/bank/store…) AND chains (McDonald's/Tim Hortons/Walmart — they get no intent)
--    to no mapping. So "has >=1 item_intents row" == "real go-out place." is_place is
--    BROADER than is_carousel_eligible (which additionally requires the notability blend):
--    the map shows real places, not only the curated-notable set.
--
-- 2. Potsdam region tightening — its 45mi radius pulled in cross-border (Ontario) spots
--    and far Adirondack items an hour+ out. Cross-border is a COUNTRY problem (Ogdensburg
--    NY and Prescott ON are both ~26mi, opposite sides of the river), so radius alone can't
--    separate them → drop by address country. Far is a DISTANCE problem → radius 30mi.
--    Honestly sparse-but-local beats padded-into-Canada.
--
-- Idempotent + re-runnable. ROLLBACK: drop column is_place cascade; restore Potsdam
-- radius_miles=45 + clear the region_id nulls / suppression reasons set here.

-- ── 1a. is_place column + backfill ───────────────────────────────────────────
alter table public.explore_items
  add column if not exists is_place boolean not null default false;

update public.explore_items ei
set is_place = exists (select 1 from public.item_intents ii where ii.item_id = ei.id)
where ei.is_place is distinct from exists (select 1 from public.item_intents ii where ii.item_id = ei.id);

-- ── 1b. keep is_place in sync as item_intents changes (ingestion + refreshes) ─
create or replace function public.sync_is_place()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.explore_items ei
  set is_place = exists (select 1 from public.item_intents ii where ii.item_id = ei.id)
  where ei.id = coalesce(new.item_id, old.item_id);
  return null;
end $$;

drop trigger if exists trg_sync_is_place on public.item_intents;
create trigger trg_sync_is_place
  after insert or delete on public.item_intents
  for each row execute function public.sync_is_place();

-- ── 2a. tighten Potsdam radius ───────────────────────────────────────────────
update public.region set radius_miles = 30 where slug = 'potsdam-ny';

-- ── 2b. drop cross-border (Canada) items from Potsdam — durable via suppression
--        (a Euda region should never surface another country's places). ────────
update public.explore_items ei
set is_admin_suppressed = true,
    admin_suppressed_reason = 'region-scope: cross-border (not in-country for potsdam-ny)'
from public.region r
where ei.region_id = r.id and r.slug = 'potsdam-ny'
  and ei.address ilike '%canada%'
  and coalesce(ei.is_admin_suppressed, false) = false;

-- ── 2c. drop far items (> tightened radius) from the region — gentle (region_id
--        null keeps the item available for a future Adirondack region). ────────
update public.explore_items ei
set region_id = null
from public.region r
where ei.region_id = r.id and r.slug = 'potsdam-ny'
  and ei.lat is not null and ei.lng is not null
  and 3959 * acos(least(1, greatest(-1,
        cos(radians(r.center_lat)) * cos(radians(ei.lat)) *
        cos(radians(ei.lng) - radians(r.center_lng)) +
        sin(radians(r.center_lat)) * sin(radians(ei.lat))
      ))) > r.radius_miles;

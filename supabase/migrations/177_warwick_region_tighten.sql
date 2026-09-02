-- 177_warwick_region_tighten.sql
--
-- Warwick region was seeded (migration 150) at radius 30mi with NO drawn bbox.
-- A 30mi radius from Warwick NY (41.2557,-74.3601) sweeps in ~58% of the region's
-- items 20-30mi out: North Jersey (Paterson/Clifton/Paramus/Wayne/Hackensack) and
-- mid-Hudson (Beacon/Fishkill/Newburgh/Tarrytown/Cold Spring). Those aren't
-- "Warwick" — same problem migration 171 fixed for Potsdam (radius 45→30 + drop
-- far items), which was never applied to Warwick.
--
-- This mirrors 171's Potsdam treatment for Warwick, distance-only:
--   • radius 30 → 18mi. Keeps Warwick, Greenwood Lake, Florida, Chester, Goshen,
--     Monroe, Vernon NJ, Mahwah, Pomona, and most of Middletown; drops the NJ /
--     mid-Hudson sprawl. (No cross-border step — unlike Potsdam/Canada, Warwick's
--     spillover is same-country NJ, and local NJ towns like Vernon 5-10mi stay.)
--   • null region_id for in-region items now beyond the tightened radius — gentle,
--     keeps the item available for a future Hudson-Valley/NJ region. Null-coord
--     items are untouched (kept in Warwick via their string-fallback assignment).
--
-- Prod preview at 18mi (2026-08-28): KEEP 446 (310 is_place / 77 events),
-- DROP 828 (all 18-30mi NJ + mid-Hudson towns). Confirmed with Kevin before promote.
--
-- Idempotent + re-runnable. ROLLBACK: set radius_miles=30 for warwick-ny and
-- re-run 150's coordinate backfill (resolve_region) to reassign the dropped items.

-- ── 1. tighten Warwick radius ────────────────────────────────────────────────
update public.region set radius_miles = 18 where slug = 'warwick-ny';

-- ── 2. drop far items (> tightened radius) from the region — gentle (region_id
--        null keeps the item available for a future region). ──────────────────
update public.explore_items ei
set region_id = null
from public.region r
where ei.region_id = r.id and r.slug = 'warwick-ny'
  and ei.lat is not null and ei.lng is not null
  and 3959 * acos(least(1, greatest(-1,
        cos(radians(r.center_lat)) * cos(radians(ei.lat)) *
        cos(radians(ei.lng) - radians(r.center_lng)) +
        sin(radians(r.center_lat)) * sin(radians(ei.lat))
      ))) > r.radius_miles;

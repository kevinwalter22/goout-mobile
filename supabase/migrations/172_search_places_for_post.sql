-- 172_search_places_for_post.sql
--
-- Phase 3 · Act 1 · T1 — post-time place search (docs/phase3_post_first.md §5).
--
-- This is the two-surface catalog model's POSTING-SEARCH surface finally built: a broad,
-- non-region-scoped, non-curated place search for "what am I standing in front of?" —
-- fuzzy name match RANKED BY DISTANCE from the caller's GPS. Distinct from the curated
-- carousel surface (is_carousel_eligible); this one finds ANY real place, incl. non-carousel.
--
-- Distance cap = 30km on SEARCH RESULTS ONLY. Posting is NEVER distance-capped: if the
-- nearest match is >30km we simply don't suggest it and the user posts My Location.
--
-- Gates are minimal by design (per the spec): only deleted_at + is_admin_suppressed. NO
-- is_place / quality / review-status / region / time-window gates.
--
-- pg_trgm is already enabled (migration 040); this adds the missing trigram indexes so the
-- fuzzy match is index-backed. Idempotent + re-runnable.

-- Trigram indexes for fast fuzzy name search.
create index if not exists idx_explore_items_title_trgm
  on public.explore_items using gin (title gin_trgm_ops);
create index if not exists idx_explore_items_location_name_trgm
  on public.explore_items using gin (location_name gin_trgm_ops);

create or replace function public.search_places_for_post(
  p_query text,
  p_lat   double precision,
  p_lng   double precision,
  p_limit int default 12
) returns table (
  id uuid, title text, location_name text,
  lat double precision, lng double precision, distance_m double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.title, c.location_name, c.lat, c.lng, c.distance_m
  from (
    select ei.id, ei.title, ei.location_name, ei.lat, ei.lng,
      6371000 * acos(least(1, greatest(-1,
        cos(radians(p_lat)) * cos(radians(ei.lat)) *
        cos(radians(ei.lng) - radians(p_lng)) +
        sin(radians(p_lat)) * sin(radians(ei.lat))
      ))) as distance_m
    from public.explore_items ei
    where ei.deleted_at is null
      and coalesce(ei.is_admin_suppressed, false) = false   -- drop admin-removed spam only
      and ei.lat is not null and ei.lng is not null          -- needed for distance
      and (
        ei.title ilike '%' || p_query || '%'
        or ei.location_name ilike '%' || p_query || '%'
        -- word_similarity (not similarity): matches the query against the best-matching
        -- part of a long title, so a short typed/typo query ("tacoss") still finds
        -- "Tacos Por Favor Mexican Food". gin_trgm_ops supports it.
        or word_similarity(p_query, ei.title) > 0.5
      )
  ) c
  where c.distance_m <= 30000        -- SEARCH SUGGESTIONS capped at 30km; posting is never capped
  order by c.distance_m asc
  limit greatest(1, least(p_limit, 25));
$$;

grant execute on function public.search_places_for_post(text, double precision, double precision, int)
  to authenticated;

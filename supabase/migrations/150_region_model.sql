-- ============================================================================
-- 150_region_model.sql — Tier 2 Part B: first-class region/metro model
-- ============================================================================
-- Replaces the client-only distance gate with a server-enforced HARD metro
-- boundary. A user is scoped to exactly ONE region; cross-metro bleed becomes
-- impossible regardless of client state (GPS off, permission denied, etc.).
--
-- Design: docs/design/tier2_recurrence_region.md (approved). Decisions locked:
--   • bbox scoping, radius as fallback where no bbox is drawn (B1)
--   • adding a city = one region row (multi-city future, B5)
-- Region resolution ladder (live GPS → last-known → saved → picker) is client-side.
--
-- Rollback: DROP the p_region_id overloads back to the 149-era signatures;
--   ALTER TABLE explore_items DROP COLUMN region_id; DROP TABLE region.
-- ============================================================================

-- ── 1. region table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.region (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  center_lat    double precision NOT NULL,
  center_lng    double precision NOT NULL,
  radius_miles  numeric NOT NULL DEFAULT 35,   -- fallback when bbox is null
  min_lat double precision, max_lat double precision,
  min_lng double precision, max_lng double precision,
  timezone      text NOT NULL DEFAULT 'America/New_York',
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.region ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='region' AND policyname='region_read') THEN
    CREATE POLICY region_read ON public.region FOR SELECT TO authenticated, anon USING (true);
  END IF;
END $$;
GRANT SELECT ON public.region TO authenticated, anon;

-- Seed the three launch metros. Portland gets a drawn bbox (tight, coastal —
-- radius would waste half its area on ocean). Warwick/Potsdam use center+radius
-- until we draw their rectangles (B1: "radius as the fallback where we haven't
-- drawn one"). Tunable later without code changes.
INSERT INTO public.region (slug, name, center_lat, center_lng, radius_miles, min_lat, max_lat, min_lng, max_lng, display_order) VALUES
  ('portland-me', 'Portland, Maine',   43.6591, -70.2568, 35, 43.50, 43.90, -70.45, -70.00, 10),
  ('warwick-ny',  'Warwick, New York', 41.2557, -74.3601, 30, NULL, NULL, NULL, NULL, 20),
  ('potsdam-ny',  'Potsdam, New York', 44.6697, -74.9811, 45, NULL, NULL, NULL, NULL, 30)
ON CONFLICT (slug) DO NOTHING;

-- ── 2. region_id on explore_items ──────────────────────────────────────────
ALTER TABLE public.explore_items ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES public.region(id);
CREATE INDEX IF NOT EXISTS idx_explore_items_region ON public.explore_items (region_id) WHERE region_id IS NOT NULL;

-- ── 3. resolve_region(lat,lng): the point-in-region resolver ────────────────
-- Prefers a region whose bbox contains the point; else the nearest region whose
-- center is within radius_miles. NULL when the point is outside every active
-- region (national/unassigned — never shown in a metro feed).
CREATE OR REPLACE FUNCTION public.resolve_region(p_lat double precision, p_lng double precision)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM (
    SELECT id,
      (min_lat IS NOT NULL AND p_lat BETWEEN min_lat AND max_lat
        AND p_lng BETWEEN min_lng AND max_lng) AS in_bbox,
      3959 * acos(LEAST(1, GREATEST(-1,
        cos(radians(p_lat)) * cos(radians(center_lat)) * cos(radians(center_lng) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(center_lat))))) AS dist,
      radius_miles
    FROM public.region
    WHERE is_active
  ) c
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND (in_bbox OR dist <= radius_miles)
  ORDER BY in_bbox DESC, dist ASC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_region(double precision, double precision) TO authenticated, anon;

-- ── 4. backfill region_id ──────────────────────────────────────────────────
-- (a) by coordinates (authoritative)
UPDATE public.explore_items
SET region_id = public.resolve_region(lat, lng)
WHERE region_id IS NULL AND lat IS NOT NULL AND lng IS NOT NULL;

-- (b) string fallback for still-unassigned rows (null coords) — match the region
-- name against address/town/location_name. The town field is polluted with
-- street addresses upstream, so we scan all three text fields. Coordinates win
-- when they exist; this only fills gaps.
UPDATE public.explore_items e
SET region_id = r.id
FROM public.region r
WHERE e.region_id IS NULL
  AND (
    (r.slug = 'portland-me' AND concat_ws(' ', e.address, e.town, e.location_name) ~* '(portland|south portland|falmouth|westbrook|scarborough)')
    OR (r.slug = 'potsdam-ny' AND concat_ws(' ', e.address, e.town, e.location_name) ~* '(potsdam|canton|massena|ogdensburg|norwood|colton)')
    OR (r.slug = 'warwick-ny' AND concat_ws(' ', e.address, e.town, e.location_name) ~* '(warwick|middletown|goshen|florida, ny)')
  );

-- ── 5. filter_explore_items + count: add the hard region predicate ──────────
-- Adding a param changes the signature, so drop the 149-era functions and
-- recreate with p_region_id appended (default NULL = unscoped, back-compat).
DROP FUNCTION IF EXISTS public.filter_explore_items(date, date, text[], text, text, text[], integer, text, integer, integer);
DROP FUNCTION IF EXISTS public.count_filtered_explore_items(date, date, text[], text, text, text[], integer, text);

CREATE OR REPLACE FUNCTION public.filter_explore_items(
  p_range_start date DEFAULT NULL,
  p_range_end date DEFAULT NULL,
  p_categories text[] DEFAULT NULL,
  p_price_bucket text DEFAULT NULL,
  p_time_of_day text DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_min_confidence integer DEFAULT 40,
  p_season text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_region_id uuid DEFAULT NULL
)
RETURNS SETOF public.explore_items
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT e.*
  FROM public.explore_items e
  WHERE
    e.deleted_at IS NULL
    AND NOT e.is_admin_suppressed
    AND e.priority >= 0
    AND NOT e.is_duplicate
    AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
    AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved') OR e.created_by_user_id = auth.uid())
    -- HARD metro boundary: when a region is supplied, only that region's items.
    AND (p_region_id IS NULL OR e.region_id = p_region_id)
    AND (
      e.starts_at IS NULL
      OR e.starts_at >= NOW() - INTERVAL '3 hours'
    )
    AND (p_range_start IS NULL OR p_range_end IS NULL OR
      is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
    AND (p_categories IS NULL OR e.category = ANY(p_categories))
    AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
    AND (p_time_of_day IS NULL OR is_available_at_time(e.availability_json, p_time_of_day))
    AND (p_tags IS NULL OR e.tags && p_tags)
    AND (p_season IS NULL OR is_available_in_season(e.availability_json, p_season))
  ORDER BY
    CASE WHEN e.starts_at IS NOT NULL THEN 0 ELSE 1 END,
    e.starts_at ASC NULLS LAST,
    e.priority DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_filtered_explore_items(
  p_range_start date DEFAULT NULL,
  p_range_end date DEFAULT NULL,
  p_categories text[] DEFAULT NULL,
  p_price_bucket text DEFAULT NULL,
  p_time_of_day text DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_min_confidence integer DEFAULT 40,
  p_season text DEFAULT NULL,
  p_region_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM public.explore_items e
    WHERE
      e.deleted_at IS NULL
      AND NOT e.is_admin_suppressed
      AND e.priority >= 0
      AND NOT e.is_duplicate
      AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
      AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved') OR e.created_by_user_id = auth.uid())
      AND (p_region_id IS NULL OR e.region_id = p_region_id)
      AND (
        e.starts_at IS NULL
        OR e.starts_at >= NOW() - INTERVAL '3 hours'
      )
      AND (p_range_start IS NULL OR p_range_end IS NULL OR
        is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
      AND (p_categories IS NULL OR e.category = ANY(p_categories))
      AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
      AND (p_time_of_day IS NULL OR is_available_at_time(e.availability_json, p_time_of_day))
      AND (p_tags IS NULL OR e.tags && p_tags)
      AND (p_season IS NULL OR is_available_in_season(e.availability_json, p_season))
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.filter_explore_items(date, date, text[], text, text, text[], integer, text, integer, integer, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.count_filtered_explore_items(date, date, text[], text, text, text[], integer, text, uuid) TO authenticated, anon;

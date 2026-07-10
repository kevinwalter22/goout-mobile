-- ============================================================================
-- 152_event_series_collapse.sql — Tier 2 recurrence: collapse recurring events
-- ============================================================================
-- The feed shows a recurring event once PER OCCURRENCE: "Summer Sunsets Live!"
-- appears 14 times (one row per date), "PMA Films: Tuner" 6 times, etc. The
-- source (WordPress "The Events Calendar") exposes each occurrence as its own
-- event URL/date, and the collector ingests each as a distinct explore_item.
-- The dedupe_key intentionally includes the date (it dedupes the SAME event
-- across SOURCES, not a series across dates), so every occurrence is its own
-- card.
--
-- This groups occurrences into an event_series and COLLAPSES the browse feed to
-- ONE card per series (the soonest upcoming occurrence), while date-windowed
-- views still expand to the occurrences in range (Tier 2 decision A4). Purely
-- server-side — no client rebuild needed.
--
-- Rollback: DROP the p_* overloads back to migration 150's signatures;
--   ALTER TABLE explore_items DROP COLUMN series_id; DROP TABLE event_series.
-- ============================================================================

-- ── 1. event_series ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_series (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_key    text UNIQUE NOT NULL,      -- source + normalized title + venue
  source_id     uuid REFERENCES public.event_sources(id),
  title         text NOT NULL,
  location_name text,
  region_id     uuid REFERENCES public.region(id),
  category      text,
  occurrence_count integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='event_series' AND policyname='event_series_read') THEN
    CREATE POLICY event_series_read ON public.event_series FOR SELECT TO authenticated, anon USING (true);
  END IF;
END $$;
GRANT SELECT ON public.event_series TO authenticated, anon;

ALTER TABLE public.explore_items ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.event_series(id);
CREATE INDEX IF NOT EXISTS idx_explore_items_series ON public.explore_items (series_id) WHERE series_id IS NOT NULL;

-- ── 2. series key helper ────────────────────────────────────────────────────
-- Same title + venue (or, when venue is null, the source host) + source = one
-- series. Groups both date-suffixed URLs (…/summer-sunsets-live/2026-07-09/) and
-- numbered ones (…/pma-films-tuner-10/) because the title+venue is stable.
CREATE OR REPLACE FUNCTION public.compute_series_key(
  p_title text, p_location text, p_external_id text, p_source uuid
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(coalesce(p_title,''))) || '|'
      || lower(coalesce(nullif(btrim(p_location), ''),
                        split_part(regexp_replace(coalesce(p_external_id,''), '^(web:|https?://)', ''), '/', 1)))
      || '|' || coalesce(p_source::text, '');
$$;

-- ── 3. backfill: create a series per recurring group + link occurrences ──────
-- Only groups with >1 upcoming/undated occurrence become a series (one-offs stay
-- series_id = NULL and render normally).
WITH grp AS (
  SELECT public.compute_series_key(title, location_name, external_id, source_id) AS k,
         (array_agg(source_id))[1] source_id, min(title) title,
         (array_agg(location_name) FILTER (WHERE location_name IS NOT NULL))[1] location_name,
         (array_agg(region_id) FILTER (WHERE region_id IS NOT NULL))[1] region_id,
         min(category) category, count(*) n
  FROM public.explore_items
  WHERE kind='event' AND deleted_at IS NULL
  GROUP BY 1
  HAVING count(*) > 1
),
ins AS (
  INSERT INTO public.event_series (series_key, source_id, title, location_name, region_id, category, occurrence_count)
  SELECT k, source_id, title, location_name, region_id, category, n FROM grp
  ON CONFLICT (series_key) DO UPDATE SET occurrence_count = EXCLUDED.occurrence_count, updated_at = now()
  RETURNING id, series_key
)
UPDATE public.explore_items e
SET series_id = ins.id
FROM ins
WHERE e.kind='event' AND e.deleted_at IS NULL
  AND public.compute_series_key(e.title, e.location_name, e.external_id, e.source_id) = ins.series_key;

-- ── 3b. keep new crawled occurrences linked (durability) ────────────────────
-- A BEFORE INSERT/UPDATE trigger assigns series_id to every event so occurrences
-- ingested across separate crawls land in the same series (and collapse) without
-- a re-backfill. One-off events get a series of 1 (harmless: collapse is a no-op).
CREATE OR REPLACE FUNCTION public.assign_event_series()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE k text; sid uuid;
BEGIN
  IF NEW.kind <> 'event' OR NEW.title IS NULL THEN
    RETURN NEW;
  END IF;
  k := public.compute_series_key(NEW.title, NEW.location_name, NEW.external_id, NEW.source_id);
  INSERT INTO public.event_series (series_key, source_id, title, location_name, region_id, category)
    VALUES (k, NEW.source_id, NEW.title, NEW.location_name, NEW.region_id, NEW.category)
    ON CONFLICT (series_key) DO UPDATE SET updated_at = now()
    RETURNING id INTO sid;
  NEW.series_id := sid;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS explore_items_assign_series ON public.explore_items;
CREATE TRIGGER explore_items_assign_series
  BEFORE INSERT OR UPDATE OF title, location_name, external_id, source_id, kind ON public.explore_items
  FOR EACH ROW EXECUTE FUNCTION public.assign_event_series();

-- ── 4. filter_explore_items + count: collapse series in browse ──────────────
DROP FUNCTION IF EXISTS public.filter_explore_items(date, date, text[], text, text, text[], integer, text, integer, integer, uuid);
DROP FUNCTION IF EXISTS public.count_filtered_explore_items(date, date, text[], text, text, text[], integer, text, uuid);

CREATE OR REPLACE FUNCTION public.filter_explore_items(
  p_range_start date DEFAULT NULL, p_range_end date DEFAULT NULL,
  p_categories text[] DEFAULT NULL, p_price_bucket text DEFAULT NULL,
  p_time_of_day text DEFAULT NULL, p_tags text[] DEFAULT NULL,
  p_min_confidence integer DEFAULT 40, p_season text DEFAULT NULL,
  p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_region_id uuid DEFAULT NULL
)
RETURNS SETOF public.explore_items LANGUAGE plpgsql STABLE AS $function$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT e.* FROM public.explore_items e
    WHERE e.deleted_at IS NULL AND NOT e.is_admin_suppressed AND e.priority >= 0 AND NOT e.is_duplicate
      AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
      AND (e.review_status IS NULL OR e.review_status IN ('auto_approved','approved') OR e.created_by_user_id = auth.uid())
      AND (p_region_id IS NULL OR e.region_id = p_region_id)
      AND (e.starts_at IS NULL OR e.starts_at >= NOW() - INTERVAL '3 hours')
      AND (p_range_start IS NULL OR p_range_end IS NULL OR is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
      AND (p_categories IS NULL OR e.category = ANY(p_categories))
      AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
      AND (p_time_of_day IS NULL OR is_available_at_time(e.availability_json, p_time_of_day))
      AND (p_tags IS NULL OR e.tags && p_tags)
      AND (p_season IS NULL OR is_available_in_season(e.availability_json, p_season))
  ),
  -- Browse (no date range): collapse each series to its soonest upcoming
  -- occurrence. Date-windowed views keep every occurrence in range.
  collapsed AS (
    SELECT DISTINCT ON (COALESCE(b.series_id::text, b.id::text)) b.*
    FROM base b
    WHERE p_range_start IS NULL AND p_range_end IS NULL
    ORDER BY COALESCE(b.series_id::text, b.id::text), b.starts_at ASC NULLS LAST
  ),
  final AS (
    SELECT * FROM collapsed
    UNION ALL
    SELECT * FROM base WHERE NOT (p_range_start IS NULL AND p_range_end IS NULL)
  )
  SELECT (final).* FROM final
  ORDER BY CASE WHEN final.starts_at IS NOT NULL THEN 0 ELSE 1 END, final.starts_at ASC NULLS LAST, final.priority DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_filtered_explore_items(
  p_range_start date DEFAULT NULL, p_range_end date DEFAULT NULL,
  p_categories text[] DEFAULT NULL, p_price_bucket text DEFAULT NULL,
  p_time_of_day text DEFAULT NULL, p_tags text[] DEFAULT NULL,
  p_min_confidence integer DEFAULT 40, p_season text DEFAULT NULL, p_region_id uuid DEFAULT NULL
)
RETURNS bigint LANGUAGE plpgsql STABLE AS $function$
DECLARE v_count bigint;
BEGIN
  WITH base AS (
    SELECT e.id, e.series_id, e.starts_at FROM public.explore_items e
    WHERE e.deleted_at IS NULL AND NOT e.is_admin_suppressed AND e.priority >= 0 AND NOT e.is_duplicate
      AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
      AND (e.review_status IS NULL OR e.review_status IN ('auto_approved','approved') OR e.created_by_user_id = auth.uid())
      AND (p_region_id IS NULL OR e.region_id = p_region_id)
      AND (e.starts_at IS NULL OR e.starts_at >= NOW() - INTERVAL '3 hours')
      AND (p_range_start IS NULL OR p_range_end IS NULL OR is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
      AND (p_categories IS NULL OR e.category = ANY(p_categories))
      AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
      AND (p_time_of_day IS NULL OR is_available_at_time(e.availability_json, p_time_of_day))
      AND (p_tags IS NULL OR e.tags && p_tags)
      AND (p_season IS NULL OR is_available_in_season(e.availability_json, p_season))
  )
  SELECT CASE
    WHEN p_range_start IS NULL AND p_range_end IS NULL
      THEN (SELECT count(DISTINCT COALESCE(series_id::text, id::text)) FROM base)
      ELSE (SELECT count(*) FROM base)
  END INTO v_count;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.filter_explore_items(date, date, text[], text, text, text[], integer, text, integer, integer, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.count_filtered_explore_items(date, date, text[], text, text, text[], integer, text, uuid) TO authenticated, anon;

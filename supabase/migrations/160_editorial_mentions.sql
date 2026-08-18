-- ============================================================================
-- 160_editorial_mentions.sql — Editorial extraction + resolution + corroboration
-- ============================================================================
-- Signal 2 of 3 (see docs/intent_taxonomy.md; the notability hooks p_cross_source
-- / p_bestof added in migration 144 are what this table ultimately feeds — the
-- blend itself is a separate task, out of scope here).
--
-- FEIST-SAFE, non-negotiable (per Kevin): editorial_mentions stores ONLY the
-- fact a place appeared on a named list — {place, list, source, year, url}.
-- It never stores article prose, review text, or a full ranked order. Do not
-- add a "rank"/"list_position" column here — combined across a list's rows
-- that reconstructs the ranked list, which is exactly what we must not persist.
--
-- editorial_mentions  — one row per (list, place) extracted from a source.
--   Resolution happens in-place: resolved_item_id / resolution_status /
--   match_similarity are filled in by resolve_editorial_mentions() below.
--   Unmatched mentions are NOT deleted — they stay as resolution_status =
--   'unmatched' discovery candidates (catalog gaps / possible new spots).
--
-- editorial_signal    — one row per matched explore_items.id, aggregated
--   corroboration counts (# distinct lists, # distinct sources) + a coarse
--   still-operating flag. Recomputed by refresh_editorial_signal().
--
-- Rollback:
--   DROP FUNCTION IF EXISTS refresh_editorial_signal();
--   DROP FUNCTION IF EXISTS resolve_editorial_mentions(numeric);
--   DROP FUNCTION IF EXISTS normalize_place_name(text);
--   DROP TABLE IF EXISTS editorial_signal;
--   DROP TABLE IF EXISTS editorial_mentions;
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 1. Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.editorial_mentions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What the source called the place, and a normalized form for matching.
  place_name_raw    text NOT NULL,
  normalized_name   text NOT NULL,
  geo_hint          text,          -- free-text city/metro hint (e.g. 'Portland, ME'); not per-item extracted

  -- Provenance of the mention itself — link-out only, never prose.
  list_slug         text NOT NULL, -- e.g. 'press-herald-32-best-restaurants-2026'
  source_name       text NOT NULL, -- e.g. 'Portland Press Herald'
  source_url        text NOT NULL,
  year              int,
  region_id         uuid REFERENCES public.region(id) ON DELETE SET NULL,

  -- Resolution against the catalog (filled in by resolve_editorial_mentions()).
  resolved_item_id  uuid REFERENCES public.explore_items(id) ON DELETE SET NULL,
  resolution_status text NOT NULL DEFAULT 'pending'
                       CHECK (resolution_status IN ('pending', 'resolved', 'unmatched')),
  match_similarity  numeric,

  -- Extraction metadata only (model id, method) — never raw article content.
  provenance        jsonb,
  extracted_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (list_slug, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_editorial_mentions_normalized_name_trgm
  ON editorial_mentions USING gin (normalized_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_editorial_mentions_pending
  ON editorial_mentions (resolution_status) WHERE resolution_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_editorial_mentions_resolved_item
  ON editorial_mentions (resolved_item_id) WHERE resolved_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.editorial_signal (
  item_id            uuid PRIMARY KEY REFERENCES public.explore_items(id) ON DELETE CASCADE,
  bestof_count       int NOT NULL DEFAULT 0,   -- # distinct list_slug mentioning this item
  cross_source_count int NOT NULL DEFAULT 0,   -- # distinct source_name mentioning this item
  google_operating   boolean,                  -- coarse still-operating flag; NULL = unknown
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE editorial_mentions IS
  'Facts-only editorial corroboration mentions (place + list + source + year + link). Never stores article prose or a full ranked order. Migration 160.';
COMMENT ON TABLE editorial_signal IS
  'Per-item aggregated editorial corroboration counts, derived from editorial_mentions. Feeds the cross_source/bestof hooks in compute_notability() (migration 144) once wired by a later task. Migration 160.';

-- ============================================================================
-- 2. Normalization helper — mirrors compute_dedupe_key's title normalization
--    (migration 068) so mention names and catalog titles compare on equal
--    footing under pg_trgm similarity.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.normalize_place_name(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(COALESCE(p_name, '')), '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g'));
$$;

-- ============================================================================
-- 3. Entity resolution — mentions -> explore_items
-- ============================================================================
-- Reuses the pg_trgm similarity approach from mark_fuzzy_duplicates()
-- (migration 040). "Geo proximity" here means region-scoped: editorial lists
-- carry no coordinates, so a mention's region_id (set by the extractor from
-- the source's known metro) constrains candidates to that region rather than
-- a lat/lng radius. Only processes resolution_status = 'pending' rows, so
-- it's safe to call repeatedly as new mentions/catalog items arrive.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_editorial_mentions(p_min_similarity numeric DEFAULT 0.35)
RETURNS TABLE(matched_count integer, unmatched_count integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_matched integer;
  v_unmatched integer;
BEGIN
  WITH candidates AS (
    SELECT m.id AS mention_id, m.normalized_name, m.region_id
    FROM editorial_mentions m
    WHERE m.resolution_status = 'pending'
  ),
  best_match AS (
    SELECT c.mention_id, best.item_id, best.sim
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT ei.id AS item_id,
             similarity(c.normalized_name, normalize_place_name(ei.title)) AS sim
      FROM explore_items ei
      WHERE ei.kind = 'activity'
        AND ei.deleted_at IS NULL
        AND ei.is_duplicate = false
        AND (c.region_id IS NULL OR ei.region_id = c.region_id)
      ORDER BY similarity(c.normalized_name, normalize_place_name(ei.title)) DESC
      LIMIT 1
    ) best ON true
  ),
  updated AS (
    UPDATE editorial_mentions m
    SET resolved_item_id  = CASE WHEN COALESCE(bm.sim, 0) >= p_min_similarity THEN bm.item_id ELSE NULL END,
        resolution_status = CASE WHEN COALESCE(bm.sim, 0) >= p_min_similarity THEN 'resolved' ELSE 'unmatched' END,
        match_similarity  = bm.sim
    FROM best_match bm
    WHERE m.id = bm.mention_id
    RETURNING m.resolution_status
  )
  SELECT COUNT(*) FILTER (WHERE resolution_status = 'resolved'),
         COUNT(*) FILTER (WHERE resolution_status = 'unmatched')
  INTO v_matched, v_unmatched
  FROM updated;

  RETURN QUERY SELECT COALESCE(v_matched, 0), COALESCE(v_unmatched, 0);
END $$;

-- ============================================================================
-- 4. Corroboration aggregation — editorial_mentions -> editorial_signal
-- ============================================================================
-- google_operating: conservative "no reason to believe otherwise" flag —
-- false when the item has no third-party signal at all (notability
-- 'no_signal' band) or is soft-deleted / suppressed as closed; true otherwise.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_editorial_signal()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count integer;
BEGIN
  WITH agg AS (
    SELECT resolved_item_id AS item_id,
           COUNT(DISTINCT list_slug)   AS bestof_count,
           COUNT(DISTINCT source_name) AS cross_source_count
    FROM editorial_mentions
    WHERE resolved_item_id IS NOT NULL
    GROUP BY resolved_item_id
  ),
  scored AS (
    SELECT a.item_id, a.bestof_count, a.cross_source_count,
           (
             COALESCE(ei.notability_provenance ->> 'no_signal', 'false') <> 'true'
             AND ei.deleted_at IS NULL
             AND NOT (ei.is_admin_suppressed AND ei.admin_suppressed_reason ILIKE '%closed%')
           ) AS google_operating
    FROM agg a
    JOIN explore_items ei ON ei.id = a.item_id
  )
  INSERT INTO editorial_signal (item_id, bestof_count, cross_source_count, google_operating, updated_at)
  SELECT item_id, bestof_count, cross_source_count, google_operating, now()
  FROM scored
  ON CONFLICT (item_id) DO UPDATE
    SET bestof_count       = EXCLUDED.bestof_count,
        cross_source_count = EXCLUDED.cross_source_count,
        google_operating   = EXCLUDED.google_operating,
        updated_at         = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ============================================================================
-- 5. RLS — internal pipeline tables, service_role only (matches
--    event_ingest_raw / collector_targets pattern; not app-client-facing).
-- ============================================================================

ALTER TABLE editorial_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial_signal   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_editorial_mentions" ON editorial_mentions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_editorial_signal" ON editorial_signal
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 6. Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION normalize_place_name(text)         TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION resolve_editorial_mentions(numeric) TO service_role;
GRANT EXECUTE ON FUNCTION refresh_editorial_signal()          TO service_role;

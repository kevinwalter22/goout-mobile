-- ============================================================================
-- 153_curation_audit.sql — Quality Audit Loop: Level-1/Level-2 curation scorer
-- ============================================================================
-- Builds the "ruler" from data_quality_north_star.md §5 (§6 sequencing puts the
-- audit loop first). Two additive objects:
--
--   * curation_audit  — one snapshot row per day (scope='catalog'), holding
--     top-line rollups + the full per-(region,category) scorecard as JSONB. The
--     weekly auditor worker reads today vs. the prior row to report the
--     week-over-week delta (the whole point of a weekly auditor).
--
--   * compute_curation_scorecard() — deterministic Level-1 gate (completeness +
--     event freshness) and the Level-2 per-category scorecard, in pure SQL.
--
-- Deliberate scoping (honest, per the North Star's own open items):
--   * COVERAGE (Level-2) is NULL — it needs the Level-3 reference set, which is
--     not built yet (§10). Reporting null is correct, not a bug.
--   * NOTABILITY is only *proxied* here (confidence + hidden-gem). The real
--     "would a local recommend this" 1–5 judgment is done by the audit worker
--     on a bounded sample (§8), not deterministically in SQL.
--   * INTENT is proxied by `category` until the intent layer exists (§4/§10).
--
-- Tier 2: additive only — a new table + one SECURITY DEFINER *read-only*
-- function. No changes to existing tables, columns, constraints, or RLS.
-- Rollback:
--   DROP FUNCTION IF EXISTS public.compute_curation_scorecard();
--   DROP TABLE IF EXISTS public.curation_audit;
-- ============================================================================

-- ── 1. snapshot table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.curation_audit (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date             date NOT NULL,
  scope                     text NOT NULL DEFAULT 'catalog',
  total_items               integer,
  card_ready_items          integer,
  card_ready_pct            numeric(5,2),
  avg_completeness_pct      numeric(5,2),
  avg_event_freshness_pct   numeric(5,2),
  avg_notability_confidence numeric(5,2),
  scorecard                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, scope)
);

ALTER TABLE public.curation_audit ENABLE ROW LEVEL SECURITY;
-- Ops/monitoring table: service-role only. No policies granted (service_role
-- bypasses RLS); authenticated/anon get nothing, matching the other ops tables.

COMMENT ON TABLE public.curation_audit IS
  'Daily curation-quality snapshots (North Star Level-1/2). Written by the audit-curation-quality edge fn; read by the weekly auditor worker for week-over-week deltas.';

-- ── 2. scorecard function ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_curation_scorecard()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH base AS (
  SELECT
    e.id,
    e.kind,
    COALESCE(r.slug, 'unassigned')                    AS region_slug,
    COALESCE(r.name, 'Unassigned')                     AS region_name,
    COALESCE(NULLIF(e.category, ''), 'uncategorized')  AS category,
    (e.lat IS NOT NULL AND e.lng IS NOT NULL)          AS has_location,
    (e.hook_line IS NOT NULL AND length(e.hook_line) >= 10) AS has_hook,
    (e.image_url IS NOT NULL)                          AS has_image,
    (e.category IS NOT NULL)                           AS has_category,
    (e.kind = 'event')                                 AS is_event,
    (e.kind = 'event'
       AND e.starts_at IS NOT NULL
       AND e.starts_at >= now() - interval '3 hours')  AS event_upcoming,
    COALESCE(e.is_hidden_gem, false)                   AS hidden_gem,
    e.normalized_confidence
  FROM public.explore_items e
  LEFT JOIN public.region r ON r.id = e.region_id
  WHERE e.priority >= 0
    AND e.deleted_at IS NULL
    AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved'))
),
scored AS (
  SELECT
    *,
    (has_location AND has_hook AND has_image AND has_category) AS complete,
    (has_location AND has_hook AND has_image AND has_category
       AND (NOT is_event OR event_upcoming))                  AS card_ready
  FROM base
),
per_cat AS (
  SELECT
    region_slug, region_name, category,
    count(*)                                            AS total,
    count(*) FILTER (WHERE is_event)                    AS events_total,
    count(*) FILTER (WHERE complete)                    AS complete_n,
    count(*) FILTER (WHERE card_ready)                  AS card_ready_n,
    count(*) FILTER (WHERE is_event AND event_upcoming) AS events_upcoming_n,
    count(*) FILTER (WHERE hidden_gem)                  AS hidden_gem_n,
    round(avg(normalized_confidence)::numeric, 1)       AS avg_conf
  FROM scored
  GROUP BY region_slug, region_name, category
),
per_cat_scored AS (
  SELECT
    region_slug, region_name, category, total, events_total,
    complete_n, card_ready_n, events_upcoming_n, hidden_gem_n, avg_conf,
    round(100.0 * complete_n    / NULLIF(total, 0), 1)   AS completeness_pct,
    round(100.0 * card_ready_n  / NULLIF(total, 0), 1)   AS presentation_pct,
    round(100.0 * hidden_gem_n  / NULLIF(total, 0), 1)   AS pct_hidden_gem,
    CASE WHEN events_total > 0
         THEN round(100.0 * events_upcoming_n / events_total, 1)
         ELSE NULL END                                   AS event_freshness_pct
  FROM per_cat
),
per_cat_final AS (
  SELECT
    *,
    CASE WHEN events_total > 0
      THEN round( completeness_pct * 0.5
                + COALESCE(event_freshness_pct, 0) * 0.2
                + LEAST(COALESCE(avg_conf, 0), 100) * 0.3 )
      ELSE round( completeness_pct * 0.7
                + LEAST(COALESCE(avg_conf, 0), 100) * 0.3 )
    END AS scorecard_pct
  FROM per_cat_scored
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'notes', 'coverage_pct is NULL pending Level-3 reference sets (§10); intent proxied by category; notability proxied by confidence/hidden-gem — the worker samples notability qualitatively.',
  'catalog', (
    SELECT jsonb_build_object(
      'total_items',               COALESCE(sum(total), 0),
      'card_ready_items',          COALESCE(sum(card_ready_n), 0),
      'card_ready_pct',            round(100.0 * COALESCE(sum(card_ready_n), 0) / NULLIF(sum(total), 0), 1),
      'avg_completeness_pct',      round(avg(completeness_pct)::numeric, 1),
      'avg_event_freshness_pct',   round(avg(event_freshness_pct)::numeric, 1),
      'avg_notability_confidence', round(avg(avg_conf)::numeric, 1),
      'category_count',            count(*),
      'region_count',              count(DISTINCT region_slug)
    ) FROM per_cat_final
  ),
  'categories', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'region',              region_slug,
      'region_name',         region_name,
      'category',            category,
      'total',               total,
      'events_total',        events_total,
      'card_ready',          card_ready_n,
      'completeness_pct',    completeness_pct,
      'event_freshness_pct', event_freshness_pct,
      'presentation_pct',    presentation_pct,
      'pct_hidden_gem',      pct_hidden_gem,
      'avg_confidence',      avg_conf,
      'coverage_pct',        NULL,
      'scorecard_pct',       scorecard_pct
    ) ORDER BY scorecard_pct ASC NULLS FIRST, total DESC), '[]'::jsonb)
    FROM per_cat_final
  )
);
$$;

REVOKE ALL ON FUNCTION public.compute_curation_scorecard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_curation_scorecard() TO service_role;

COMMENT ON FUNCTION public.compute_curation_scorecard() IS
  'Deterministic North Star Level-1/2 scorecard (completeness + event freshness + notability proxy) per (region, category). Coverage is NULL pending Level-3 reference sets. Read-only.';

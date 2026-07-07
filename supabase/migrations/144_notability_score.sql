-- ============================================================================
-- 144_notability_score.sql — Composite PLACE notability score (build 1)
-- ============================================================================
-- Scores every catalog PLACE (kind='activity') 1.00–5.00 on "would a
-- knowledgeable local recommend this?" (North Star §5 Level-1 notability). The
-- score is the foundation the Quality Audit Loop gates against.
--
-- LEGAL / ToS (from docs/data_quality/sourcing_research_findings.md):
--   We persist ONLY a substantially-transformed composite score + provenance
--   BANDS (high/mid/low) — never the raw Google Content (rating, userRatingCount)
--   as a stored value, and never raw values alongside the score. The raw signals
--   are read transiently from event_ingest_raw.raw_json at scoring time and
--   discarded; the function blends ≥2 axes + our own logic and is non-reversible
--   to the inputs. A score that merely relabels Google's stars would NOT comply.
--
-- MODEL (two axes → two paths to "notable", chains penalized on both):
--   esteem      = credibility-weighted (Bayesian, m=25, C=4.4) rating, mapped
--                 [4.0,4.8]→[0,1]. "How well-regarded."
--   prominence  = log(reviews)/log(2500), clamped. "How known/established"
--                 (fame). For non-chains, fame ≈ recommendability in this domain.
--   + editorial (Google wrote an editorialSummary → weak notability hint)
--   + hidden_gem (beloved-but-under-radar: the second path to notable)
--   - chain (chains are inventory, not curation — strong penalty)
--   + cross_source / bestof : HOOKS for the next builds (default 0), so the
--     score is extensible without a schema change. Each capped at +0.10.
--   Weights calibrated against the live Portland catalog (609 places): famous
--   icons land 4.2–4.8 (Head Light, Eventide, Duckfat, Standard Baking, the
--   island ferry), chains 1.0–1.8, 5.0-with-1-review items ~2.0.
--
-- NOT WIRED INTO RANKING/FEED by this migration — score only. Wiring is a
-- separate change after Kevin confirms the calibration.
-- Rollback: DROP the functions + columns (see bottom).
-- ============================================================================

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS notability_score      NUMERIC(3,2),   -- [1.00, 5.00]
  ADD COLUMN IF NOT EXISTS notability_provenance JSONB,          -- bands, NOT raw values
  ADD COLUMN IF NOT EXISTS notability_scored_at  TIMESTAMPTZ;

-- Pure, immutable composite. Inputs are read transiently by the caller; only the
-- transformed score + band provenance are ever persisted.
CREATE OR REPLACE FUNCTION compute_notability(
  p_rating        NUMERIC,            -- nullable (no third-party signal)
  p_reviews       INTEGER,            -- nullable
  p_is_chain      BOOLEAN,
  p_is_hidden_gem BOOLEAN,
  p_has_editorial BOOLEAN,
  p_cross_source  INTEGER DEFAULT 0,  -- HOOK (built later): # independent corroborating sources
  p_bestof        INTEGER DEFAULT 0   -- HOOK (built later): # best-of/award list mentions
) RETURNS TABLE(score NUMERIC, provenance JSONB)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_bayes NUMERIC; v_esteem NUMERIC; v_prom NUMERIC; v_base NUMERIC;
  v_cross NUMERIC; v_best NUMERIC;
BEGIN
  -- Insufficient third-party signal → conservative default, flagged (never ranks
  -- high on no evidence; the audit gate can treat no_signal items specially).
  IF p_rating IS NULL OR p_reviews IS NULL THEN
    RETURN QUERY SELECT 2.00::NUMERIC,
      jsonb_build_object('v', 1, 'no_signal', true, 'chain', coalesce(p_is_chain,false));
    RETURN;
  END IF;

  v_bayes  := (p_reviews * p_rating + 25 * 4.4) / (p_reviews + 25);   -- credibility-weighted
  v_esteem := greatest(0, least(1, (v_bayes - 4.0) / 0.8));
  v_prom   := greatest(0, least(1, log(p_reviews + 1) / log(2500)));
  v_cross  := least(0.10, 0.05 * coalesce(p_cross_source, 0));
  v_best   := least(0.10, 0.05 * coalesce(p_bestof, 0));

  v_base := greatest(0, least(1,
      0.40 * v_esteem
    + 0.48 * v_prom
    + 0.07 * (CASE WHEN p_has_editorial  THEN 1 ELSE 0 END)
    + 0.18 * (CASE WHEN p_is_hidden_gem  THEN 1 ELSE 0 END)
    - 0.50 * (CASE WHEN p_is_chain       THEN 1 ELSE 0 END)
    + v_cross + v_best));

  RETURN QUERY SELECT
    round((1 + 4 * v_base)::numeric, 2),
    jsonb_build_object(
      'v', 1,
      'esteem_band',     CASE WHEN v_esteem >= 0.66 THEN 'high' WHEN v_esteem >= 0.33 THEN 'mid' ELSE 'low' END,
      'prominence_band', CASE WHEN v_prom   >= 0.66 THEN 'high' WHEN v_prom   >= 0.33 THEN 'mid' ELSE 'low' END,
      'hidden_gem',  coalesce(p_is_hidden_gem, false),
      'chain',       coalesce(p_is_chain, false),
      'editorial',   coalesce(p_has_editorial, false),
      'cross_source', coalesce(p_cross_source, 0),
      'bestof',       coalesce(p_bestof, 0),
      'no_signal',   false
    );
END $$;

-- Batch scorer: reads signals transiently (latest raw_json per item), persists
-- only the transformed score + provenance. p_ids NULL = all activities.
CREATE OR REPLACE FUNCTION rescore_notability(p_ids UUID[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  WITH sig AS (
    SELECT ei.id, ei.is_chain, ei.is_hidden_gem,
           (r.raw_json->>'rating')::numeric        AS rating,
           (r.raw_json->>'userRatingCount')::int   AS reviews,
           (r.raw_json ? 'editorialSummary')       AS has_ed
    FROM explore_items ei
    LEFT JOIN LATERAL (
      SELECT e.raw_json FROM event_ingest_raw e
      WHERE e.source_id = ei.source_id AND e.external_id = ei.external_id
      ORDER BY e.fetched_at DESC LIMIT 1
    ) r ON true
    WHERE ei.kind = 'activity' AND ei.is_duplicate = false AND ei.deleted_at IS NULL
      AND (p_ids IS NULL OR ei.id = ANY(p_ids))
  ), comp AS (
    SELECT s.id, c.score, c.provenance
    FROM sig s
    CROSS JOIN LATERAL compute_notability(
      s.rating, s.reviews, coalesce(s.is_chain,false),
      coalesce(s.is_hidden_gem,false), coalesce(s.has_ed,false)
    ) c
  )
  UPDATE explore_items ei
  SET notability_score = comp.score,
      notability_provenance = comp.provenance,
      notability_scored_at = now()
  FROM comp WHERE ei.id = comp.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

CREATE INDEX IF NOT EXISTS idx_explore_items_notability
  ON explore_items (notability_score DESC) WHERE notability_score IS NOT NULL;

GRANT EXECUTE ON FUNCTION compute_notability(NUMERIC,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,INTEGER,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION rescore_notability(UUID[]) TO service_role;

COMMENT ON COLUMN explore_items.notability_score IS
  'Composite 1.00-5.00 PLACE notability (migration 144). Transformed blend of credibility-weighted rating (esteem) + review-volume fame (prominence) + editorial/hidden-gem/chain, with cross-source/bestof hooks. NOT raw Google Content. Not wired to ranking yet.';

-- Rollback:
--   DROP INDEX IF EXISTS idx_explore_items_notability;
--   DROP FUNCTION IF EXISTS rescore_notability(UUID[]);
--   DROP FUNCTION IF EXISTS compute_notability(NUMERIC,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,INTEGER,INTEGER);
--   ALTER TABLE explore_items DROP COLUMN IF EXISTS notability_score,
--     DROP COLUMN IF EXISTS notability_provenance, DROP COLUMN IF EXISTS notability_scored_at;

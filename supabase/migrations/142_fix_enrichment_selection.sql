-- 142_fix_enrichment_selection.sql
--
-- Fix the re-enrichment selection bug (token-audit finding #1).
--
-- WHY: schedule-enrichment calls find_items_needing_enrichment(), but that RPC
-- never existed in prod — so it silently fell back to a direct query whose
-- `.or()` included `llm_enriched_at < now()-30d`. That clause matched ~the entire
-- catalog (~4,590 items) on every run, re-enqueuing already-good items in endless
-- ~$2/day enrichment "storms." The enrichment_version column (set to 2 by the
-- worker) was written but never read — the intended version gate was dead.
--
-- FIX: select only items that have NOT been enriched to the current version.
-- Once an item reaches CURRENT_ENRICHMENT_VERSION it is never re-enqueued (no
-- rolling-time re-sweep). New / older-version items get exactly one pass.
-- Deliberate catalog-wide re-enrichment is still possible the intended way:
-- bump CURRENT_ENRICHMENT_VERSION (here + in run-enrichment-queue) together.
--
-- Quality-neutral for the LLM EXTRACTOR (Phase 5.1, 84.4%/96.8%) — this touches
-- only the enrichment scheduler, a different pipeline.

-- Keep in lockstep with run-enrichment-queue's CURRENT_ENRICHMENT_VERSION.
CREATE OR REPLACE FUNCTION find_items_needing_enrichment(
  p_stale_cutoff TIMESTAMPTZ DEFAULT NULL,  -- accepted for call-site compat; unused (version gates instead)
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  normalized_confidence NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT ei.id, ei.title, ei.normalized_confidence
  FROM explore_items ei
  WHERE ei.priority >= 0
    AND ei.is_duplicate = false
    AND ei.deleted_at IS NULL
    -- Not already in flight.
    AND NOT EXISTS (
      SELECT 1 FROM enrichment_queue q
      WHERE q.explore_item_id = ei.id
        AND q.status IN ('queued', 'running')
    )
    -- The gate: only items not yet enriched to the current version. This is the
    -- whole fix — no rolling-time re-enrichment of already-current items.
    AND COALESCE(ei.enrichment_version, 0) < 2
  ORDER BY COALESCE(ei.enrichment_version, 0) ASC,
           ei.normalized_confidence ASC NULLS FIRST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION find_items_needing_enrichment(TIMESTAMPTZ, INTEGER) TO service_role;

COMMENT ON FUNCTION find_items_needing_enrichment IS
'Selects explore_items not yet enriched to CURRENT_ENRICHMENT_VERSION (2) and not already queued/running. Replaces the broken 30-day rolling re-sweep that caused enrichment cost storms (migration 142, token-audit #1). Bump the version literal here AND in run-enrichment-queue to trigger a deliberate catalog re-enrichment.';

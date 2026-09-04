-- 190_fix_enrichment_requeue_and_heal.sql
--
-- Part of the re-ingest-clobber fix (diagnosed 2026-09-04). The normalize upsert used to write
-- the adapter payload verbatim, so every re-ingest of an existing item nulled its curated
-- hook_line/description and replaced enriched tags with generic ones. The edge-function change
-- (normalize-raw-events) now strips those keys from the upsert so a re-ingest can no longer
-- clobber them. This migration fixes the two remaining pieces:
--
--   (A) The enrichment RE-QUEUE dead-end. `queue_for_enrichment` (migration 018) had
--       `... DO UPDATE ... WHERE status != 'done'`, so a genuinely-degraded, already-'done'
--       item could never be re-queued. Now that normalize only calls it when the RESULTING ROW
--       actually lacks a hook_line (not on every re-ingest), it's safe to let it reset a
--       'done'/'failed' row back to 'queued' — no re-enrichment storm (the 142 concern).
--
--   (B) One-time HEAL of items already degraded by the historical bug (enriched — llm_enriched_at
--       set — but hook_line now null/empty). Re-queue them and reset the enrichment version gate
--       so both enrichment paths (queue worker + find_items_needing_enrichment) regenerate their
--       hooks. This is a ONE-TIME backfill, not a recurring sweep.
--
-- ROLLBACK: restore queue_for_enrichment from migration 018 (the WHERE status != 'done' variant).
-- The heal is data-only and self-limiting (re-enriched items return to enrichment_version=2).

-- ── (A) Fix the re-queue dead-end ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION queue_for_enrichment(
  p_explore_item_id UUID,
  p_priority INTEGER DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO enrichment_queue (explore_item_id, priority)
  VALUES (p_explore_item_id, p_priority)
  ON CONFLICT (explore_item_id) DO UPDATE
  SET
    priority = GREATEST(enrichment_queue.priority, EXCLUDED.priority),
    -- Re-queue genuine needs: a 'done' or 'failed' item can be re-enriched. Callers now only
    -- invoke this when the item truly lacks a hook (see normalize-raw-events), so resetting
    -- 'done'->'queued' cannot cause a re-enrichment storm. Leave 'running' alone (in flight).
    status = CASE
      WHEN enrichment_queue.status = 'running' THEN enrichment_queue.status
      ELSE 'queued'::job_status
    END,
    attempts = CASE
      WHEN enrichment_queue.status IN ('done', 'failed') THEN 0
      ELSE enrichment_queue.attempts
    END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION queue_for_enrichment IS
'Queues an item for LLM enrichment. Re-queues a done/failed item (migration 190) — safe because callers only invoke it when the resulting row genuinely lacks a hook_line. Running jobs are left in flight.';

-- ── (B) One-time heal of already-degraded items ──────────────────────────────────────────────
-- Re-queue FIRST (identify by "was enriched but hook_line lost"), then reset the version gate.
INSERT INTO enrichment_queue (explore_item_id, priority, status)
SELECT ei.id, 40, 'queued'::job_status
  FROM explore_items ei
 WHERE ei.deleted_at IS NULL
   AND ei.llm_enriched_at IS NOT NULL
   AND (ei.hook_line IS NULL OR length(trim(ei.hook_line)) = 0)
   AND COALESCE(ei.is_duplicate, false) = false
ON CONFLICT (explore_item_id) DO UPDATE
  SET status   = 'queued'::job_status,
      attempts = 0,
      priority = GREATEST(enrichment_queue.priority, 40),
      updated_at = NOW();

UPDATE explore_items
   SET enrichment_version = 0,
       llm_enriched_at    = NULL,
       updated_at         = NOW()
 WHERE deleted_at IS NULL
   AND llm_enriched_at IS NOT NULL
   AND (hook_line IS NULL OR length(trim(hook_line)) = 0)
   AND COALESCE(is_duplicate, false) = false;

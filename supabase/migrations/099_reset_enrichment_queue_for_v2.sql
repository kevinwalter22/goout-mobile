-- Reset enrichment queue: re-queue items that were "done" but never got v2 enrichment.
-- The earlier worker runs marked them as done (skipped) without calling the v2 LLM.

UPDATE enrichment_queue eq
SET status = 'queued',
    attempts = 0,
    started_at = NULL,
    completed_at = NULL,
    last_error = NULL,
    updated_at = NOW()
FROM explore_items ei
WHERE eq.explore_item_id = ei.id
  AND eq.status = 'done'
  AND ei.enrichment_version < 2
  AND ei.deleted_at IS NULL;

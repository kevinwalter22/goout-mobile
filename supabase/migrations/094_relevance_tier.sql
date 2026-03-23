-- ============================================================================
-- Relevance Tier (094)
-- ============================================================================
-- Stored quality/relevance tier for explore items.
-- Used client-side to decide which items appear in card groups vs overflow.
--
-- Tiers:
--   3 = premium  (curated, high-quality venues, popular events)
--   2 = standard (API-sourced, passes quality gates)
--   1 = marginal (low quality or borderline relevant)
--   0 = suppressed (excluded from card groups, only in list/map if searched)
-- ============================================================================

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS relevance_tier SMALLINT NOT NULL DEFAULT 2;

CREATE INDEX IF NOT EXISTS idx_explore_items_relevance_tier
  ON explore_items(relevance_tier)
  WHERE relevance_tier >= 2;

-- Backfill: set tier based on source type and confidence
-- Premium (tier 3): Ticketmaster events, high-confidence items with images
UPDATE explore_items
SET relevance_tier = 3
WHERE deleted_at IS NULL
  AND NOT is_duplicate
  AND (
    -- Ticketmaster/PredictHQ events are curated
    source_id IN (
      SELECT id FROM event_sources
      WHERE type IN ('api_ticketmaster', 'api_predicthq')
    )
    -- Or high confidence items with good data
    OR (normalized_confidence >= 80 AND image_url IS NOT NULL)
  );

-- Marginal (tier 1): low confidence or missing key fields
UPDATE explore_items
SET relevance_tier = 1
WHERE deleted_at IS NULL
  AND NOT is_duplicate
  AND relevance_tier = 2
  AND (
    (normalized_confidence IS NOT NULL AND normalized_confidence < 55)
    OR (image_url IS NULL AND image_thumb_url IS NULL AND normalized_confidence < 65)
  );

-- Suppressed (tier 0): items that are technically active but very low quality
UPDATE explore_items
SET relevance_tier = 0
WHERE deleted_at IS NULL
  AND NOT is_duplicate
  AND relevance_tier <= 1
  AND normalized_confidence IS NOT NULL
  AND normalized_confidence < 42;

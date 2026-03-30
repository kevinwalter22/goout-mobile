-- ============================================================================
-- Fix PredictHQ Concert Category (122)
-- ============================================================================
-- PredictHQ concerts were mapped to "Nightlife" by the source adapter, making
-- them invisible when users filter by Music (which resolves to "Arts & Culture").
-- Concerts are cultural events; "Arts & Culture" is the correct canonical category.
--
-- Scope: explore_items where category = 'Nightlife' and tags contain concert/live_music
-- and the item originated from PredictHQ (sub_category in PHQ concert categories).
--
-- Rollback:
--   UPDATE explore_items
--   SET category = 'Nightlife'
--   WHERE sub_category = 'concerts'
--     AND (provenance->>'phq_category') = 'concerts';
-- ============================================================================

UPDATE explore_items
SET
  category = 'Arts & Culture',
  updated_at = NOW()
WHERE
  category = 'Nightlife'
  -- Only touch items that came from PredictHQ's "concerts" category
  AND (
    sub_category = 'concerts'
    OR (provenance->>'phq_category') = 'concerts'
  )
  -- Confirm they have music-signal tags (safety check)
  AND tags && ARRAY['concert', 'live_music']
  AND deleted_at IS NULL;

-- Summary
DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '122: Recategorized % PredictHQ concert items from Nightlife → Arts & Culture', v_updated;
END;
$$;

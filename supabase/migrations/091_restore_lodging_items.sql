-- ============================================================================
-- Restore Incorrectly Soft-Deleted Lodging Items (091)
-- ============================================================================
-- Migration 089 soft-deleted all items with sub_category = 'lodging', but some
-- of those are restaurants, bars, or other valid destinations that happen to
-- be inside a hotel/inn building. Google Places sometimes assigns the
-- 'lodging' primary type to such places.
--
-- This migration un-soft-deletes those items so they reappear in the feed.
-- ============================================================================

-- Restore all lodging-category items that were soft-deleted by 089
UPDATE explore_items SET deleted_at = NULL
WHERE deleted_at IS NOT NULL
  AND sub_category = 'lodging';

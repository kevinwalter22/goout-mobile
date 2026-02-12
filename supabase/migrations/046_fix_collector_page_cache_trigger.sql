-- ============================================================================
-- Fix: Remove incorrect trigger from collector_page_cache
-- ============================================================================
-- The collector_page_cache table uses last_checked_at / last_changed_at
-- instead of updated_at, so the generic update_updated_at_column trigger
-- doesn't work.
--
-- Rollback: (none needed - trigger was erroneous)
-- ============================================================================

-- Drop the incorrect trigger
DROP TRIGGER IF EXISTS trg_collector_page_cache_updated ON collector_page_cache;

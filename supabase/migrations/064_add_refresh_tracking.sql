-- ============================================================================
-- Refresh Tracking + Stale Demotion (Wave 5 Phase C)
-- ============================================================================
-- Adds ETag/Last-Modified caching to collector_page_cache for conditional
-- HTTP requests (304 Not Modified), and last_refreshed_at on explore_items
-- so stale web-collected events can be automatically demoted.
--
-- Rollback:
--   ALTER TABLE collector_page_cache
--     DROP COLUMN IF EXISTS etag,
--     DROP COLUMN IF EXISTS last_modified,
--     DROP COLUMN IF EXISTS consecutive_unchanged;
--   ALTER TABLE explore_items
--     DROP COLUMN IF EXISTS last_refreshed_at,
--     DROP COLUMN IF EXISTS stale_reason;
--   DROP FUNCTION IF EXISTS demote_stale_web_items(INTEGER);
-- ============================================================================

-- ============================================================================
-- 1. ETag / Last-Modified on collector_page_cache
-- ============================================================================

ALTER TABLE collector_page_cache
  ADD COLUMN IF NOT EXISTS etag TEXT,
  ADD COLUMN IF NOT EXISTS last_modified TEXT,
  ADD COLUMN IF NOT EXISTS consecutive_unchanged INTEGER DEFAULT 0;

-- ============================================================================
-- 2. Refresh tracking on explore_items
-- ============================================================================

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stale_reason TEXT;

-- ============================================================================
-- 3. Stale demotion function
-- ============================================================================
-- Demotes web-collected events whose source page hasn't been refreshed
-- in p_stale_days. Only targets past events (starts_at < now - 1 day)
-- that are still visible (priority >= 0). Sets priority = -1 so they
-- fall out of filter_explore_items.
-- ============================================================================

CREATE OR REPLACE FUNCTION demote_stale_web_items(p_stale_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE explore_items ei
  SET priority = -1,
      stale_reason = 'source_page_stale_' || p_stale_days || '_days'
  FROM event_sources es
  WHERE ei.source_id = es.id
    AND es.type IN ('web_collector', 'web_community_calendar')
    AND ei.priority >= 0
    AND ei.kind = 'event'
    AND ei.starts_at IS NOT NULL
    AND ei.starts_at < NOW() - INTERVAL '1 day'
    AND (ei.last_refreshed_at IS NULL
         OR ei.last_refreshed_at < NOW() - (p_stale_days || ' days')::INTERVAL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION demote_stale_web_items(INTEGER) TO service_role;

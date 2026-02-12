-- ============================================================================
-- Review Infrastructure + Blocklist (Wave 5 Phase D)
-- ============================================================================
-- Adds collector_blocklist table for domain/URL/title pattern blocking,
-- and RPCs for the admin quarantine review queue (approve/reject).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS get_quarantine_queue(INT,INT);
--   DROP FUNCTION IF EXISTS approve_quarantined_item(UUID);
--   DROP FUNCTION IF EXISTS reject_quarantined_item(UUID,TEXT);
--   DROP TABLE IF EXISTS collector_blocklist;
-- ============================================================================

-- ============================================================================
-- 1. Blocklist table
-- ============================================================================

CREATE TABLE IF NOT EXISTS collector_blocklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('domain', 'url_pattern', 'title_pattern')),
  pattern TEXT NOT NULL,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(pattern_type, pattern)
);

ALTER TABLE collector_blocklist ENABLE ROW LEVEL SECURITY;

-- Admins manage blocklist entries
CREATE POLICY "Admins manage blocklist"
  ON collector_blocklist FOR ALL
  USING (public.is_current_user_admin());

-- Service role can read blocklist (for edge functions)
CREATE POLICY "Service role reads blocklist"
  ON collector_blocklist FOR SELECT
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 2. Get quarantine queue for admin UI
-- ============================================================================

CREATE OR REPLACE FUNCTION get_quarantine_queue(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  title TEXT,
  description TEXT,
  category TEXT,
  location_name TEXT,
  town TEXT,
  starts_at TIMESTAMPTZ,
  source_url TEXT,
  normalized_confidence INT,
  provenance JSONB,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.description,
    e.category,
    e.location_name,
    e.town,
    e.starts_at,
    e.source_url,
    e.normalized_confidence,
    e.provenance,
    e.created_at
  FROM explore_items e
  WHERE e.review_status = 'quarantined'
  ORDER BY e.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- 3. Approve a quarantined item
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_quarantined_item(p_item_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE explore_items
  SET review_status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = NOW()
  WHERE id = p_item_id
    AND review_status = 'quarantined';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. Reject a quarantined item
-- ============================================================================

CREATE OR REPLACE FUNCTION reject_quarantined_item(
  p_item_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE explore_items
  SET review_status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = NOW(),
      priority = -1,
      stale_reason = COALESCE(p_reason, 'rejected_by_admin')
  WHERE id = p_item_id
    AND review_status = 'quarantined';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. Grants
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_quarantine_queue(INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_quarantined_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_quarantined_item(UUID, TEXT) TO authenticated;

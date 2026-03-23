-- ============================================================================
-- Admin Suppression & Quality Gating (095)
-- ============================================================================
-- Adds global (admin-level) suppression fields to explore_items, plus RPCs
-- for manual and bulk suppression, and an audit view for recurring items.
--
-- User-level suppression (explore_item_suppressions table, migration 093)
-- remains separate — this is for global admin/system suppression.
-- ============================================================================

-- 1. Add admin suppression fields
ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS is_admin_suppressed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS admin_suppressed_reason TEXT;

-- Index for fast filtering of non-suppressed items
CREATE INDEX IF NOT EXISTS idx_explore_items_admin_suppressed
  ON explore_items(is_admin_suppressed)
  WHERE is_admin_suppressed = TRUE;

-- ============================================================================
-- 2. RPC: Manually suppress a single item (admin only)
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_suppress_item(
  p_item_id UUID,
  p_reason TEXT DEFAULT 'manual'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE explore_items
  SET is_admin_suppressed = TRUE,
      admin_suppressed_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_suppress_item(UUID, TEXT) TO authenticated;

-- ============================================================================
-- 3. RPC: Unsuppress a single item (admin only)
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_unsuppress_item(
  p_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE explore_items
  SET is_admin_suppressed = FALSE,
      admin_suppressed_reason = NULL,
      updated_at = NOW()
  WHERE id = p_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_unsuppress_item(UUID) TO authenticated;

-- ============================================================================
-- 4. RPC: Bulk suppress by rule (admin only)
--    Suppresses active items matching a sub_category or title pattern.
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_bulk_suppress(
  p_sub_categories TEXT[] DEFAULT NULL,
  p_title_pattern TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT 'bulk_rule'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE explore_items
  SET is_admin_suppressed = TRUE,
      admin_suppressed_reason = p_reason,
      updated_at = NOW()
  WHERE deleted_at IS NULL
    AND is_admin_suppressed = FALSE
    AND (
      (p_sub_categories IS NOT NULL AND sub_category = ANY(p_sub_categories))
      OR
      (p_title_pattern IS NOT NULL AND title ~* p_title_pattern)
    );

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_suppress(TEXT[], TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 5. RPC: View items that would appear in many card groups (audit tool)
--    Returns items with the widest tag arrays + highest recommend potential.
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_recurring_item_audit(
  p_limit INT DEFAULT 50
)
RETURNS TABLE(
  id UUID,
  title TEXT,
  category TEXT,
  sub_category TEXT,
  tags TEXT[],
  tag_count INT,
  normalized_confidence INT,
  relevance_tier SMALLINT,
  is_admin_suppressed BOOLEAN,
  source_name TEXT,
  kind TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    ei.id,
    ei.title,
    ei.category,
    ei.sub_category,
    ei.tags,
    COALESCE(array_length(ei.tags, 1), 0) AS tag_count,
    ei.normalized_confidence,
    ei.relevance_tier,
    ei.is_admin_suppressed,
    es.name AS source_name,
    ei.kind::TEXT
  FROM explore_items ei
  LEFT JOIN event_sources es ON ei.source_id = es.id
  WHERE ei.deleted_at IS NULL
    AND NOT ei.is_duplicate
    AND ei.priority >= 0
  ORDER BY COALESCE(array_length(ei.tags, 1), 0) DESC, ei.normalized_confidence DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION admin_recurring_item_audit(INT) TO authenticated;

-- ============================================================================
-- 6. Auto-suppress known junk sub_categories that shouldn't appear in cards
--    This runs once at migration time; future items are caught by ingestion
--    filters (SKIP_PRIMARY_TYPES) and relevance_tier assignment.
-- ============================================================================
UPDATE explore_items
SET is_admin_suppressed = TRUE,
    admin_suppressed_reason = 'auto:irrelevant_category'
WHERE deleted_at IS NULL
  AND is_admin_suppressed = FALSE
  AND sub_category IN (
    'lodging', 'hotel', 'motel', 'extended stay hotel',
    'self storage', 'storage facility',
    'government office', 'city hall', 'courthouse',
    'apartment complex', 'apartment building',
    'office', 'corporate office',
    'car wash', 'car repair', 'car dealer', 'gas station',
    'electric vehicle charging station',
    'hair salon', 'beauty salon', 'nail salon',
    'laundry', 'dry cleaner',
    'pharmacy', 'drugstore',
    'veterinary care',
    'post office',
    'school', 'preschool', 'primary school', 'secondary school',
    'hardware store',
    'convenience store',
    'real estate agency',
    'cemetery', 'funeral home',
    'church', 'mosque', 'synagogue', 'temple',
    'clothing store', 'florist', 'pet store'
  );

-- Also suppress by title patterns for items that slipped through
UPDATE explore_items
SET is_admin_suppressed = TRUE,
    admin_suppressed_reason = 'auto:irrelevant_title'
WHERE deleted_at IS NULL
  AND is_admin_suppressed = FALSE
  AND (
    title ~* '\y(hotel|motel|hostel|resort|suites?|lodge)\y'
    OR title ~* '(self.storage|storage.unit|mini.storage)'
    OR title ~* '(apartment|condo.complex)'
    OR title ~* '(city.hall|courthouse|town.hall|dmv)'
    OR title ~* '(funeral|mortuary|cremation|cemetery)'
  );

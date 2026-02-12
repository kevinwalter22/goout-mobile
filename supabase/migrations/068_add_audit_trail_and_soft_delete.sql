-- ============================================================================
-- Migration 068: Admin Audit Trail + Soft Delete
-- ============================================================================
-- 1. admin_audit_log table records all admin actions with before/after snapshots
-- 2. deleted_at column on explore_items for soft deletes
-- 3. Trigger auto-logs admin edits to audit table
-- 4. filter_explore_items updated to exclude soft-deleted rows
-- 5. DELETE RLS tightened to admin-only (all deletes should be soft)
-- ============================================================================

-- ============================================================================
-- 1. Audit Log Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  item_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('edit', 'create', 'delete', 'restore')),
  before_snapshot JSONB,
  after_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_item ON admin_audit_log(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON admin_audit_log(admin_user_id, created_at DESC);

-- RLS: admins can read audit log, service_role can do everything
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit log"
  ON admin_audit_log FOR SELECT
  USING (public.is_current_user_admin());

CREATE POLICY "Service role can manage audit log"
  ON admin_audit_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Authenticated users can insert audit rows (trigger runs as SECURITY DEFINER)
CREATE POLICY "Authenticated can insert audit log"
  ON admin_audit_log FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================================
-- 2. Soft Delete Column
-- ============================================================================

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN explore_items.deleted_at
  IS 'Soft delete timestamp. Non-null = hidden from all queries. Admins can restore.';

-- Partial index for fast exclusion of soft-deleted rows
CREATE INDEX IF NOT EXISTS idx_explore_items_not_deleted
  ON explore_items (id) WHERE deleted_at IS NULL;

-- ============================================================================
-- 3. Auto-Audit Trigger for Admin Edits
-- ============================================================================
-- Fires AFTER UPDATE on explore_items. Logs a row when the acting user
-- is an admin AND is not the item creator (i.e., admin editing someone else's
-- content) OR when deleted_at changes (soft delete / restore).

CREATE OR REPLACE FUNCTION audit_explore_item_change()
RETURNS TRIGGER AS $$
DECLARE
  v_uid UUID;
  v_is_admin BOOLEAN;
  v_action TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    -- No auth context (service_role migration, etc.) — skip
    RETURN NEW;
  END IF;

  v_is_admin := public.is_current_user_admin();
  IF NOT v_is_admin THEN
    RETURN NEW;
  END IF;

  -- Determine action type
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_action := 'delete';
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    v_action := 'restore';
  ELSE
    v_action := 'edit';
  END IF;

  INSERT INTO admin_audit_log (admin_user_id, item_id, action, before_snapshot, after_snapshot)
  VALUES (
    v_uid,
    NEW.id,
    v_action,
    to_jsonb(OLD),
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_explore_item_change ON explore_items;
CREATE TRIGGER trg_audit_explore_item_change
  AFTER UPDATE ON explore_items
  FOR EACH ROW
  EXECUTE FUNCTION audit_explore_item_change();

-- ============================================================================
-- 4. Update filter functions to exclude soft-deleted rows
-- ============================================================================

CREATE OR REPLACE FUNCTION filter_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_min_confidence INTEGER DEFAULT 40,
  p_season TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS SETOF explore_items AS $$
BEGIN
  RETURN QUERY
  SELECT e.*
  FROM explore_items e
  WHERE
    -- Soft delete gate
    e.deleted_at IS NULL
    -- Exclude demoted/stale items
    AND e.priority >= 0
    -- Exclude duplicates
    AND NOT e.is_duplicate
    -- Quality gate
    AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
    -- Review status gate (exclude quarantined/rejected)
    AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved'))
    -- Hide past events (3-hour grace window)
    AND (
      e.starts_at IS NULL
      OR e.ends_at >= NOW()
      OR (e.ends_at IS NULL AND e.starts_at >= NOW() - INTERVAL '3 hours')
    )
    -- Date range filter
    AND (p_range_start IS NULL OR p_range_end IS NULL OR
      is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
    -- Category filter
    AND (p_categories IS NULL OR e.category = ANY(p_categories))
    -- Price bucket filter
    AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
    -- Time of day filter
    AND (p_time_of_day IS NULL OR
      is_available_at_time(e.availability_json, p_time_of_day))
    -- Tag filter
    AND (p_tags IS NULL OR e.tags && p_tags)
    -- Season filter
    AND (p_season IS NULL OR
      is_available_in_season(e.availability_json, p_season))
  ORDER BY
    CASE WHEN e.starts_at IS NOT NULL THEN 0 ELSE 1 END,
    e.starts_at ASC NULLS LAST,
    e.priority DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION count_filtered_explore_items(
  p_range_start DATE DEFAULT NULL,
  p_range_end DATE DEFAULT NULL,
  p_categories TEXT[] DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_min_confidence INTEGER DEFAULT 40,
  p_season TEXT DEFAULT NULL
)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)
    FROM explore_items e
    WHERE
      e.deleted_at IS NULL
      AND e.priority >= 0
      AND NOT e.is_duplicate
      AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= p_min_confidence)
      AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved'))
      AND (
        e.starts_at IS NULL
        OR e.ends_at >= NOW()
        OR (e.ends_at IS NULL AND e.starts_at >= NOW() - INTERVAL '3 hours')
      )
      AND (p_range_start IS NULL OR p_range_end IS NULL OR
        is_item_available_in_range(e.availability_json, e.starts_at, p_range_start, p_range_end))
      AND (p_categories IS NULL OR e.category = ANY(p_categories))
      AND (p_price_bucket IS NULL OR e.price_bucket::TEXT = p_price_bucket)
      AND (p_time_of_day IS NULL OR
        is_available_at_time(e.availability_json, p_time_of_day))
      AND (p_tags IS NULL OR e.tags && p_tags)
      AND (p_season IS NULL OR
        is_available_in_season(e.availability_json, p_season))
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 5. Tighten hard DELETE to admin-only
-- ============================================================================
-- All user-facing deletes should be soft (UPDATE deleted_at).
-- Hard DELETE is reserved for admin data cleanup.

DROP POLICY IF EXISTS "Users can delete own events or admins any" ON explore_items;

CREATE POLICY "Only admins can hard delete explore items"
  ON explore_items FOR DELETE
  USING (public.is_current_user_admin());

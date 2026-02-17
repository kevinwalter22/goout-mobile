-- ============================================================================
-- 070: Security launch blockers
--
-- Fixes three issues identified in the pre-launch security audit:
--   CRIT-2: approve/reject quarantined items callable by any authenticated user
--   HIGH-3: soft-deleted explore_items still readable via direct SELECT
--   MED-1:  category_fallback_images has no RLS
--
-- Rollback:
--   -- CRIT-2: re-create functions without admin guard (NOT recommended)
--   -- HIGH-3: DROP POLICY ... then re-create 056 policy
--   -- MED-1:  ALTER TABLE category_fallback_images DISABLE ROW LEVEL SECURITY;
-- ============================================================================


-- ============================================================================
-- CRIT-2: Guard admin-only review functions
-- ============================================================================
-- Both functions are SECURITY DEFINER (run as postgres) and GRANTED TO
-- authenticated.  Without an explicit admin check ANY logged-in user can
-- approve or reject quarantined content.
--
-- Fix: add IF NOT is_current_user_admin() guard at the top of each function.
-- We keep the GRANT TO authenticated so admins (who are authenticated) can
-- still call them — the guard inside the function body is the real gate.
-- ============================================================================

-- Revoke any accidental public grants first
REVOKE ALL ON FUNCTION approve_quarantined_item(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_quarantined_item(UUID, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION approve_quarantined_item(p_item_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  UPDATE explore_items
  SET review_status = 'approved',
      reviewed_by   = auth.uid(),
      reviewed_at   = NOW()
  WHERE id = p_item_id
    AND review_status = 'quarantined';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reject_quarantined_item(
  p_item_id UUID,
  p_reason  TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  UPDATE explore_items
  SET review_status = 'rejected',
      reviewed_by   = auth.uid(),
      reviewed_at   = NOW(),
      priority      = -1,
      stale_reason  = COALESCE(p_reason, 'rejected_by_admin')
  WHERE id = p_item_id
    AND review_status = 'quarantined';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-grant to authenticated (admin guard is inside the function body)
GRANT EXECUTE ON FUNCTION approve_quarantined_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_quarantined_item(UUID, TEXT) TO authenticated;


-- ============================================================================
-- HIGH-3: Soft-deleted explore_items must not be readable
-- ============================================================================
-- The SELECT policy from 056 has no deleted_at check.  filter_explore_items()
-- excludes them, but a direct .select().eq('id', ...) still returns rows
-- with deleted_at IS NOT NULL.
--
-- Fix: replace the policy with one that adds "deleted_at IS NULL".
-- Also add a separate admin-only policy so admins can still view deleted
-- items for moderation/audit.  service_role is unaffected (its ALL policy
-- from 017 already bypasses per-row checks).
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can read visible explore_items" ON explore_items;

-- Regular users: same visibility logic as 056, plus soft-delete gate
CREATE POLICY "Authenticated users can read visible explore_items"
  ON explore_items FOR SELECT
  USING (
    deleted_at IS NULL
    AND auth.role() = 'authenticated'
    AND (
      -- System events (no creator) visible to all authenticated users
      created_by_user_id IS NULL
      OR
      -- Creator can always see their own events
      created_by_user_id = auth.uid()
      OR
      -- Friends-only: accepted friends only
      (visibility = 'friends_only' AND EXISTS (
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND (
            (user_id = auth.uid() AND friend_id = explore_items.created_by_user_id)
            OR
            (friend_id = auth.uid() AND user_id = explore_items.created_by_user_id)
          )
      ))
      OR
      -- Public visibility
      visibility = 'public'
    )
  );

-- Admins can read ALL items including soft-deleted (for moderation/audit)
CREATE POLICY "Admins can read all explore_items including deleted"
  ON explore_items FOR SELECT
  USING (public.is_current_user_admin());


-- ============================================================================
-- MED-1: Enable RLS on category_fallback_images
-- ============================================================================
-- Table was created in 052 without RLS.  Any authenticated user can currently
-- INSERT/UPDATE/DELETE rows.
--
-- Fix: enable RLS, allow authenticated SELECT (needed by get_fallback_image()
-- which runs as INVOKER), restrict writes to service_role.
-- ============================================================================

ALTER TABLE category_fallback_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read fallback images"
  ON category_fallback_images FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages fallback images"
  ON category_fallback_images FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role updates fallback images"
  ON category_fallback_images FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role deletes fallback images"
  ON category_fallback_images FOR DELETE
  USING (auth.role() = 'service_role');

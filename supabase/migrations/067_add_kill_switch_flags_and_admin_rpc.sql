-- ============================================================================
-- Migration 067: Kill Switch Flags + Admin Toggle RPC
-- ============================================================================
-- Adds missing feature flags for contacts_sync, ingestion, type_affinity_learning.
-- Creates an admin-only RPC to toggle feature flags from the client.
-- ============================================================================

-- Seed missing flags (existing flags untouched via ON CONFLICT)
INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, config_json) VALUES
  ('contacts_sync', true, 100, '{}'),
  ('ingestion', true, 100, '{}'),
  ('type_affinity_learning', true, 100, '{}')
ON CONFLICT (flag_name) DO NOTHING;

-- ============================================================================
-- Admin-only RPC to toggle a feature flag
-- ============================================================================
-- Checks is_admin on the calling user's profile before allowing updates.
-- Returns the updated row so the client can confirm the change.

CREATE OR REPLACE FUNCTION toggle_feature_flag(
  p_flag_name TEXT,
  p_is_enabled BOOLEAN
)
RETURNS TABLE(flag_name TEXT, is_enabled BOOLEAN, updated_at TIMESTAMPTZ)
AS $$
BEGIN
  -- Verify caller is admin
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  UPDATE feature_flags
  SET
    is_enabled = p_is_enabled,
    updated_at = NOW()
  WHERE feature_flags.flag_name = p_flag_name
  RETURNING feature_flags.flag_name, feature_flags.is_enabled, feature_flags.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION toggle_feature_flag(TEXT, BOOLEAN) TO authenticated;

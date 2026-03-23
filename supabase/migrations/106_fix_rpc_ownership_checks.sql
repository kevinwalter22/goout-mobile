-- ============================================================================
-- Fix RPC Ownership Checks for Push Notification RPCs (106)
-- ============================================================================
-- Migration 074 already added assert_caller() guards to all pre-084 RPCs.
-- Migration 084 (push notifications) added 3 new SECURITY DEFINER RPCs that
-- were created after 074 and were missed.
--
-- This migration adds assert_caller(p_user_id) to those 3 functions using
-- the same pattern established in migration 074.
--
-- Risk without fix:
--   upsert_push_token    — attacker registers their device for victim's user_id
--                          and receives that user's push notifications.
--   remove_push_token    — attacker silently kills another user's push delivery.
--   update_notification_preferences — attacker disables another user's
--                                     notification settings.
--
-- Note: assert_caller() allows service-role callers (auth.uid() IS NULL) to
-- pass any user_id via NULL-safe SQL semantics — edge functions are unaffected.
-- ============================================================================

-- ============================================================================
-- 1. upsert_push_token
-- ============================================================================
CREATE OR REPLACE FUNCTION upsert_push_token(
  p_user_id  UUID,
  p_token    TEXT,
  p_platform TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM assert_caller(p_user_id);

  INSERT INTO push_tokens (user_id, token, platform)
  VALUES (p_user_id, p_token, p_platform)
  ON CONFLICT (user_id, token)
  DO UPDATE SET updated_at = NOW(), platform = p_platform;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_push_token(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 2. remove_push_token
-- ============================================================================
CREATE OR REPLACE FUNCTION remove_push_token(
  p_user_id UUID,
  p_token   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM assert_caller(p_user_id);

  DELETE FROM push_tokens
   WHERE user_id = p_user_id
     AND token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_push_token(UUID, TEXT) TO authenticated;

-- ============================================================================
-- 3. update_notification_preferences
-- ============================================================================
CREATE OR REPLACE FUNCTION update_notification_preferences(
  p_user_id         UUID,
  p_event_reminders BOOLEAN,
  p_friend_requests BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM assert_caller(p_user_id);

  UPDATE profiles
     SET notify_event_reminders = p_event_reminders,
         notify_friend_requests = p_friend_requests
   WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_notification_preferences(UUID, BOOLEAN, BOOLEAN) TO authenticated;

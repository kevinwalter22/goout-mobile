-- Migration 117: Social notification preferences (reactions + comments)
--
-- Adds per-user preference flags for post activity notifications and extends
-- the update_notification_preferences RPC to accept the new fields.

-- ── 1. New preference columns ─────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notify_post_reactions BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_post_comments  BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 2. Replace the update_notification_preferences RPC ───────────────────
-- Drop the old 3-argument signature first (PostgreSQL treats different param
-- lists as distinct functions and won't let us replace across signatures).

DROP FUNCTION IF EXISTS update_notification_preferences(UUID, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION update_notification_preferences(
  p_user_id          UUID,
  p_event_reminders  BOOLEAN,
  p_friend_requests  BOOLEAN,
  p_post_reactions   BOOLEAN DEFAULT TRUE,
  p_post_comments    BOOLEAN DEFAULT TRUE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM assert_caller(p_user_id);
  UPDATE profiles
     SET notify_event_reminders = p_event_reminders,
         notify_friend_requests  = p_friend_requests,
         notify_post_reactions   = p_post_reactions,
         notify_post_comments    = p_post_comments
   WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_notification_preferences(UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN)
  TO authenticated;

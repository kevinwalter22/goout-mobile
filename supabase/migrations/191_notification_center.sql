-- 191_notification_center.sql
--
-- Phase A of the notification build: a user-readable notifications table that backs the in-app
-- notification CENTER and powers deep-linking. Every push that goes out also writes a row here
-- (via create_notification), so the center is a real record and each row carries the deep-link
-- target. Distinct from notifications_sent (mig 084), which stays the service-only dedup ledger.
--
-- Also adds the friend-activity preference + the per-recipient bundling cursor used by the
-- flush-friend-activity edge fn (window + cooldown anti-spam).

-- ── Center table ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- recipient
  type          TEXT NOT NULL,          -- friend_request | friend_accepted | post_reaction | post_comment | event_reminder | friend_activity | nearby
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  target_route  TEXT,                   -- deep-link, e.g. /post/{id}, /user/{id}, /event/{id}, /(tabs)/notifications
  reference_id  UUID,                   -- the post / user / event this is about
  actor_id      UUID,                   -- who triggered it (for the row avatar)
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users read ONLY their own notifications. Writes (insert / mark-read) go through the
-- SECURITY DEFINER RPCs below, so users can't insert or tamper with other fields.
DROP POLICY IF EXISTS "read own notifications" ON notifications;
CREATE POLICY "read own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);

-- ── Write helper (service / edge functions) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id      UUID,
  p_type         TEXT,
  p_title        TEXT,
  p_body         TEXT,
  p_target_route TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_actor_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (user_id, type, title, body, target_route, reference_id, actor_id)
  VALUES (p_user_id, p_type, p_title, p_body, p_target_route, p_reference_id, p_actor_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_notification(UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO service_role;

-- ── Mark read (caller's own rows only) ───────────────────────────────────────────────────────
-- p_ids NULL = mark ALL of the caller's notifications read; otherwise only the given ids.
CREATE OR REPLACE FUNCTION mark_notifications_read(p_ids UUID[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE notifications
     SET read_at = now()
   WHERE user_id = auth.uid()
     AND read_at IS NULL
     AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_notifications_read(UUID[]) TO authenticated;

-- ── Friend-activity preference + bundling cursor ─────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notify_friend_activity BOOLEAN NOT NULL DEFAULT TRUE,
  -- Per-recipient bundling cursor: the flush fn only bundles friend posts newer than this, and
  -- only re-sends once the cooldown has elapsed since it. Stamped = now() on each bundle sent.
  ADD COLUMN IF NOT EXISTS last_friend_activity_at TIMESTAMPTZ;

COMMENT ON TABLE notifications IS
'User-readable notification center (Phase A). One row per delivered notification; carries the deep-link target. Written by create_notification alongside each push. RLS: read-own; writes via SECURITY DEFINER RPCs. notifications_sent (mig 084) remains the separate service-only dedup ledger.';

-- ── Extend the prefs RPC with notify_friend_activity ─────────────────────────────────────────
-- Drop the prior 5-arg version so the 6-arg (default) doesn't create an ambiguous overload.
DROP FUNCTION IF EXISTS update_notification_preferences(UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION update_notification_preferences(
  p_user_id         UUID,
  p_event_reminders BOOLEAN,
  p_friend_requests BOOLEAN,
  p_post_reactions  BOOLEAN,
  p_post_comments   BOOLEAN,
  p_friend_activity BOOLEAN DEFAULT TRUE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
     SET notify_event_reminders = p_event_reminders,
         notify_friend_requests = p_friend_requests,
         notify_post_reactions  = p_post_reactions,
         notify_post_comments   = p_post_comments,
         notify_friend_activity = p_friend_activity
   WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_notification_preferences(UUID, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

-- ============================================================
-- 084: Push Notifications
--
-- Push token storage, notification preferences, and
-- deduplication for event reminders + friend requests.
-- ============================================================

-- ── Push Tokens ─────────────────────────────────────────────
CREATE TABLE push_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, token)
);

CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);

-- ── Notification Preferences on Profiles ────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notify_event_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_friend_requests BOOLEAN NOT NULL DEFAULT TRUE;

-- ── Deduplication Table ─────────────────────────────────────
CREATE TABLE notifications_sent (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  reference_id      UUID,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, notification_type, reference_id)
);

CREATE INDEX idx_notifications_sent_lookup
  ON notifications_sent(user_id, notification_type, reference_id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_sent ENABLE ROW LEVEL SECURITY;

-- Users can see and manage their own push tokens
CREATE POLICY "Users see own tokens"
  ON push_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own tokens"
  ON push_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own tokens"
  ON push_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- notifications_sent: no direct user access (managed by SECURITY DEFINER RPCs / edge functions)
CREATE POLICY "Service only"
  ON notifications_sent FOR ALL
  USING (false);

-- ── RPC: upsert_push_token ─────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_push_token(
  p_user_id  UUID,
  p_token    TEXT,
  p_platform TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO push_tokens (user_id, token, platform)
  VALUES (p_user_id, p_token, p_platform)
  ON CONFLICT (user_id, token)
  DO UPDATE SET updated_at = now(), platform = p_platform;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_push_token(UUID, TEXT, TEXT) TO authenticated;

-- ── RPC: remove_push_token ──────────────────────────────────
CREATE OR REPLACE FUNCTION remove_push_token(
  p_user_id UUID,
  p_token   TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM push_tokens
   WHERE user_id = p_user_id
     AND token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_push_token(UUID, TEXT) TO authenticated;

-- ── RPC: update_notification_preferences ────────────────────
CREATE OR REPLACE FUNCTION update_notification_preferences(
  p_user_id          UUID,
  p_event_reminders  BOOLEAN,
  p_friend_requests  BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
     SET notify_event_reminders = p_event_reminders,
         notify_friend_requests = p_friend_requests
   WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_notification_preferences(UUID, BOOLEAN, BOOLEAN) TO authenticated;

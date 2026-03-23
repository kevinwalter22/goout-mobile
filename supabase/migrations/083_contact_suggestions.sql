-- ============================================================
-- 083: Contact Suggestions
--
-- Persistent storage for contact-based friend suggestions.
-- Raw contacts never reach the server — only user-id pairs
-- derived from hash matching are stored here.
-- ============================================================

-- ── Table ────────────────────────────────────────────────────
CREATE TABLE contact_suggestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suggested_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, suggested_user_id)
);

CREATE INDEX idx_contact_suggestions_user
  ON contact_suggestions(user_id) WHERE dismissed = FALSE;

-- ── Profile column ───────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS contacts_synced_at TIMESTAMPTZ;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE contact_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own suggestions"
  ON contact_suggestions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users dismiss own suggestions"
  ON contact_suggestions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No direct INSERT/DELETE by users — handled by SECURITY DEFINER RPCs.

-- ── RPC: sync_contact_suggestions ────────────────────────────
-- Called by the client after hashing contacts on-device.
-- Matches hashed phones against profiles.phone_hash, inserts
-- suggestion rows, and updates the sync timestamp.
CREATE OR REPLACE FUNCTION sync_contact_suggestions(
  p_user_id       UUID,
  p_hashed_phones TEXT[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert suggestions for any phone-hash match, skipping
  -- self, existing friends, and pending requests.
  INSERT INTO contact_suggestions (user_id, suggested_user_id)
  SELECT p_user_id, p.id
  FROM profiles p
  WHERE p.phone_hash = ANY(p_hashed_phones)
    AND p.id != p_user_id
    -- Exclude accepted friends (both directions)
    AND p.id NOT IN (
      SELECT friend_id FROM friendships
       WHERE user_id = p_user_id AND status = 'accepted'
      UNION ALL
      SELECT user_id FROM friendships
       WHERE friend_id = p_user_id AND status = 'accepted'
    )
    -- Exclude pending requests (both directions)
    AND p.id NOT IN (
      SELECT friend_id FROM friendships
       WHERE user_id = p_user_id AND status = 'pending'
      UNION ALL
      SELECT user_id FROM friendships
       WHERE friend_id = p_user_id AND status = 'pending'
    )
  ON CONFLICT (user_id, suggested_user_id) DO NOTHING;

  -- Record when the sync happened
  UPDATE profiles
     SET contacts_synced_at = now()
   WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_contact_suggestions(UUID, TEXT[]) TO authenticated;

-- ── RPC: get_contact_suggestions ─────────────────────────────
-- Returns non-dismissed suggestions, excluding anyone who has
-- since become a friend or has a pending request.
CREATE OR REPLACE FUNCTION get_contact_suggestions(p_user_id UUID)
RETURNS TABLE(user_id UUID, username TEXT, avatar_url TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT p.id AS user_id, p.username, p.avatar_url
  FROM contact_suggestions cs
  JOIN profiles p ON p.id = cs.suggested_user_id
  WHERE cs.user_id = p_user_id
    AND cs.dismissed = FALSE
    -- Exclude anyone who is now a friend or has a pending request
    AND cs.suggested_user_id NOT IN (
      SELECT friend_id FROM friendships
       WHERE user_id = p_user_id AND status IN ('accepted', 'pending')
      UNION ALL
      SELECT user_id FROM friendships
       WHERE friend_id = p_user_id AND status IN ('accepted', 'pending')
    )
  ORDER BY cs.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_contact_suggestions(UUID) TO authenticated;

-- ── RPC: clear_contact_suggestions ───────────────────────────
-- Deletes all suggestions for the user and resets the sync timestamp.
CREATE OR REPLACE FUNCTION clear_contact_suggestions(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM contact_suggestions WHERE user_id = p_user_id;
  UPDATE profiles SET contacts_synced_at = NULL WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_contact_suggestions(UUID) TO authenticated;

-- ── RPC: dismiss_contact_suggestion ──────────────────────────
-- Marks a single suggestion as dismissed (e.g. after sending a
-- friend request or tapping "dismiss").
CREATE OR REPLACE FUNCTION dismiss_contact_suggestion(
  p_user_id          UUID,
  p_suggested_user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE contact_suggestions
     SET dismissed = TRUE
   WHERE user_id = p_user_id
     AND suggested_user_id = p_suggested_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION dismiss_contact_suggestion(UUID, UUID) TO authenticated;

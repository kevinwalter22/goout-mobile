-- Migration 061: Phone number + contact matching (privacy-safe)
-- Adds phone_number, phone_hash to profiles and RPCs for save + match

-- Ensure pgcrypto is available (ships with Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Schema changes
-- ============================================================================

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS phone_hash TEXT,
ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Unique constraint on phone_number (partial — only non-null)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_number_unique
  ON profiles (phone_number) WHERE phone_number IS NOT NULL;

-- Index on phone_hash for fast contact matching
CREATE INDEX IF NOT EXISTS profiles_phone_hash_idx
  ON profiles (phone_hash) WHERE phone_hash IS NOT NULL;

-- ============================================================================
-- RPC: save_phone_number
-- Validates E.164, computes hash, updates profile
-- Pass empty string to remove phone number
-- ============================================================================

CREATE OR REPLACE FUNCTION save_phone_number(
  p_user_id UUID,
  p_phone_number TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_clean TEXT;
  v_hash TEXT;
BEGIN
  -- Handle removal
  IF p_phone_number IS NULL OR trim(p_phone_number) = '' THEN
    UPDATE profiles
    SET phone_number = NULL,
        phone_hash = NULL,
        phone_verified_at = NULL
    WHERE id = p_user_id;
    RETURN;
  END IF;

  v_clean := trim(p_phone_number);

  -- Validate E.164 format: starts with +, 8-15 digits total
  IF v_clean !~ '^\+[0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Invalid phone number format. Use E.164 format (e.g. +14155551234)';
  END IF;

  -- Compute SHA-256 hash with salt (must match client-side salt)
  v_hash := encode(digest(v_clean || 'euda_phone_salt_2024', 'sha256'), 'hex');

  UPDATE profiles
  SET phone_number = v_clean,
      phone_hash = v_hash,
      phone_verified_at = NOW()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION save_phone_number(UUID, TEXT) TO authenticated;

-- ============================================================================
-- RPC: match_contacts
-- Takes array of hashed phone numbers, returns matching users
-- Excludes: self, existing friends, pending requests
-- ============================================================================

CREATE OR REPLACE FUNCTION match_contacts(
  p_user_id UUID,
  p_hashed_phones TEXT[]
)
RETURNS TABLE(user_id UUID, username TEXT, avatar_url TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH my_friends AS (
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS friend_id
    FROM friendships f
    WHERE f.status = 'accepted'
      AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
  ),
  pending_excluded AS (
    SELECT
      CASE WHEN f.user_id = p_user_id THEN f.friend_id ELSE f.user_id END AS excluded_id
    FROM friendships f
    WHERE f.status = 'pending'
      AND (f.user_id = p_user_id OR f.friend_id = p_user_id)
  ),
  excluded AS (
    SELECT p_user_id AS id
    UNION
    SELECT friend_id AS id FROM my_friends
    UNION
    SELECT excluded_id AS id FROM pending_excluded
  )
  SELECT p.id AS user_id, p.username, p.avatar_url
  FROM profiles p
  WHERE p.phone_hash = ANY(p_hashed_phones)
    AND p.id NOT IN (SELECT e.id FROM excluded e)
  ORDER BY p.username ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION match_contacts(UUID, TEXT[]) TO authenticated;

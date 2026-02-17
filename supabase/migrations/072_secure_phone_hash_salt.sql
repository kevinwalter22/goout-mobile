-- Migration 072: Move phone hash salt from function body to a secure config table
--
-- Fixes HIGH-2: hardcoded salt 'euda_phone_salt_2024' is visible in pg_proc.prosrc.
-- After this migration, SELECT prosrc FROM pg_proc WHERE proname = 'save_phone_number'
-- shows a table lookup instead of the literal salt value.
--
-- The salt VALUE is unchanged — existing phone_hash rows remain valid.
--
-- Approach: app_secrets table with RLS enabled and NO policies.
-- This means:
--   - Authenticated users CANNOT read it (RLS blocks all access)
--   - SECURITY DEFINER functions (running as postgres) bypass RLS and CAN read it
--   - service_role can read it (bypasses RLS)

-- ============================================================================
-- 1. Create app_secrets table — locked down via RLS with no policies
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_secrets (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies → authenticated users see nothing.
-- Revoke direct access from anon and authenticated roles for defense in depth.
REVOKE ALL ON app_secrets FROM anon, authenticated;

-- Insert the phone hash salt
INSERT INTO app_secrets (key, value)
VALUES ('phone_hash_salt', 'euda_phone_salt_2024')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. Recreate save_phone_number() — reads salt from app_secrets table
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
  v_salt TEXT;
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

  -- Read salt from secure config table (never hardcoded in function body)
  SELECT value INTO v_salt FROM app_secrets WHERE key = 'phone_hash_salt';
  IF v_salt IS NULL OR v_salt = '' THEN
    RAISE EXCEPTION 'Phone hash salt not configured. Insert into app_secrets (key, value) VALUES (''phone_hash_salt'', ''<salt>'');';
  END IF;

  -- Compute SHA-256 hash with salt (must match client-side hashing)
  v_hash := encode(digest(v_clean || v_salt, 'sha256'), 'hex');

  UPDATE profiles
  SET phone_number = v_clean,
      phone_hash = v_hash,
      phone_verified_at = NOW()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION save_phone_number(UUID, TEXT) TO authenticated;

-- ============================================================================
-- 3. Verify: salt is NOT in function source
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'save_phone_number'
      AND prosrc LIKE '%euda_phone_salt%'
  ) THEN
    RAISE EXCEPTION 'SECURITY CHECK FAILED: salt literal still visible in save_phone_number prosrc';
  END IF;
END;
$$;

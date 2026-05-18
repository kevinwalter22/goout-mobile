-- ============================================================================
-- Auth Event Log (125)
-- ============================================================================
-- Diagnostic log for the signup/signin funnel. Designed to answer
-- "where is this user getting stuck?" — the existing security_events
-- table bans PII, but here we deliberately store email so that we can
-- correlate dropped funnels with specific users.
--
-- Events logged:
--   signup_attempt        — client called supabase.auth.signUp(...)
--   signup_succeeded      — Supabase returned no error
--   signup_failed         — Supabase returned an error (rate-limit, dup email, etc.)
--   signin_attempt        — client called supabase.auth.signInWithPassword(...)
--   signin_succeeded      — sign-in returned no error
--   signin_failed         — sign-in returned an error (bad creds, not confirmed)
--   confirmation_arrived  — user landed back in the app/auth/callback screen
--   confirmation_failed   — callback screen could not establish a session
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE auth_event_type AS ENUM (
    'signup_attempt',
    'signup_succeeded',
    'signup_failed',
    'signin_attempt',
    'signin_succeeded',
    'signin_failed',
    'confirmation_arrived',
    'confirmation_failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS auth_event_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      auth_event_type NOT NULL,
  -- email is stored deliberately for funnel diagnostics. Lowercased on insert.
  email           TEXT,
  -- user_id may be null for failed signups (no user row exists yet)
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- structured error details from Supabase responses
  error_code      TEXT,
  error_message   TEXT,
  -- free-form: platform, app_version, callback_type, etc.
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_event_log_type_time
  ON auth_event_log(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_event_log_email_time
  ON auth_event_log(LOWER(email), created_at DESC)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_event_log_user_time
  ON auth_event_log(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE auth_event_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read. Authenticated users can never directly SELECT —
-- they go through the SECURITY DEFINER RPC to write.
CREATE POLICY "Admins read auth log"
  ON auth_event_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE
  ));

-- No direct INSERT/UPDATE/DELETE — RPC only.

-- ── RPC: log_auth_event ─────────────────────────────────────────────────
-- Fire-and-forget logger. Safe to call before a user exists (signup_attempt).
-- Email is lowercased to make lookup consistent.
CREATE OR REPLACE FUNCTION log_auth_event(
  p_event_type    TEXT,
  p_email         TEXT DEFAULT NULL,
  p_user_id       UUID DEFAULT NULL,
  p_error_code    TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_metadata      JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO auth_event_log (
    event_type, email, user_id, error_code, error_message, metadata
  ) VALUES (
    p_event_type::auth_event_type,
    NULLIF(LOWER(TRIM(p_email)), ''),
    p_user_id,
    NULLIF(TRIM(p_error_code), ''),
    NULLIF(TRIM(p_error_message), ''),
    COALESCE(p_metadata, '{}'::jsonb)
  );
EXCEPTION WHEN OTHERS THEN
  -- Logging must never break the auth flow. Swallow any error
  -- (bad enum value, etc.) silently.
  NULL;
END;
$$;

-- Grant to anon so unauthenticated signups can log attempts.
-- Inserts go through SECURITY DEFINER so no RLS bypass risk.
GRANT EXECUTE ON FUNCTION log_auth_event(TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO anon, authenticated;

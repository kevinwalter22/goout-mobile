-- Migration 114: check_username_available
--
-- Exposes a case-insensitive username availability check to anon users
-- so the signup screen can validate before calling supabase.auth.signUp.
--
-- Without this check, a username collision causes the handle_new_user
-- DB trigger to fail, which GoTrue surfaces as the generic
-- "Database error saving new user" error — confusing to testers.
--
-- Case-insensitive (lower()) so "Kevin" and "kevin" are treated as taken.

CREATE OR REPLACE FUNCTION check_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM profiles WHERE lower(username) = lower(p_username)
  );
$$;

-- Grant to anon so the unauthenticated signup screen can call it.
GRANT EXECUTE ON FUNCTION check_username_available(TEXT) TO anon, authenticated;

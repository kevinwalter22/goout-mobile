-- ============================================================================
-- 151_client_error_log.sql — diagnostic client-error capture
-- ============================================================================
-- A table the mobile client writes uncaught JS errors to, so we can read the
-- ACTUAL crash (message + stack + component stack + phase) server-side when a
-- device crash can't be seen any other way (Sentry token is write-only; the
-- on-screen error boundary hasn't been reaching the installed build).
--
-- Clients may INSERT (even unauthenticated — the crash can happen on the login
-- screen) but may NOT SELECT: only the service role / operator reads this.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_error_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  phase           text,
  message         text,
  stack           text,
  component_stack text,
  app_env         text,
  platform        text,
  app_version     text,
  user_id         uuid,
  extra           jsonb
);

ALTER TABLE public.client_error_log ENABLE ROW LEVEL SECURITY;

-- INSERT-only for clients (anon + authenticated). No SELECT policy → clients
-- cannot read it back; the operator reads via the service role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='client_error_log' AND policyname='client_error_insert') THEN
    CREATE POLICY client_error_insert ON public.client_error_log
      FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
END $$;

GRANT INSERT ON public.client_error_log TO anon, authenticated;

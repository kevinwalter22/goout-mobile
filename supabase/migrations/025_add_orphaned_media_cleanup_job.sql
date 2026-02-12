-- Migration 025: Add Orphaned Media Cleanup Scheduled Job
-- P0 Fix: Clean up orphaned storage files when upload succeeds but DB insert fails

-- Note: pg_cron must be enabled in Supabase Dashboard (Database > Extensions)
-- This migration creates the cron job to call the cleanup Edge Function hourly

-- Enable pg_cron extension if not already enabled
-- (This may fail if not available - that's OK, can be enabled via dashboard)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a function that calls the Edge Function
-- This uses pg_net to make HTTP calls (built into Supabase)
CREATE OR REPLACE FUNCTION invoke_cleanup_orphaned_media()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  edge_function_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Get the project URL from current database settings
  -- In Supabase, the Edge Function URL follows a pattern:
  -- https://<project-ref>.supabase.co/functions/v1/cleanup-orphaned-media
  edge_function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/cleanup-orphaned-media';
  service_role_key := current_setting('app.settings.service_role_key', true);

  -- If settings aren't configured, log and return
  IF edge_function_url IS NULL OR edge_function_url = '/functions/v1/cleanup-orphaned-media' THEN
    RAISE LOG 'Orphaned media cleanup: Edge function URL not configured';
    RETURN;
  END IF;

  -- Make HTTP POST request to the Edge Function
  -- Using pg_net extension (available in Supabase)
  PERFORM net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := '{}'::jsonb
  );

  RAISE LOG 'Orphaned media cleanup: Triggered Edge Function';
END;
$$;

-- Schedule the cleanup job to run every hour
-- Uses pg_cron syntax: 'minute hour day month weekday'
-- '0 * * * *' = at minute 0 of every hour
SELECT cron.schedule(
  'cleanup-orphaned-media',  -- job name
  '0 * * * *',               -- every hour at minute 0
  $$SELECT invoke_cleanup_orphaned_media()$$
);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- MANUAL SETUP REQUIRED:
-- 1. Enable pg_cron extension in Supabase Dashboard (Database > Extensions)
-- 2. Enable pg_net extension in Supabase Dashboard (Database > Extensions)
-- 3. Set custom settings in Supabase Dashboard (Database > Settings > Custom Config):
--    app.settings.supabase_url = 'https://<your-project>.supabase.co'
--    app.settings.service_role_key = '<your-service-role-key>'
--
-- ALTERNATIVE: If pg_cron is not available, you can use:
-- - Supabase's built-in scheduled functions (via project dashboard)
-- - An external cron service (GitHub Actions, Vercel Cron, etc.)
-- - Manual invocation via curl:
--   curl -X POST 'https://<project>.supabase.co/functions/v1/cleanup-orphaned-media' \
--     -H 'Authorization: Bearer <service_role_key>'

COMMENT ON FUNCTION invoke_cleanup_orphaned_media IS
'Triggers the cleanup-orphaned-media Edge Function to delete storage files with no matching post record. Called hourly by pg_cron.';

-- 000_legacy_baseline.sql
--
-- These tables predate migration tracking. They were created by hand in the
-- Supabase dashboard in the project's earliest days, so NO later migration
-- CREATEs them. A from-zero replay (e.g. building the staging project) failed
-- at 002_create_event_rsvps, which has a foreign key to `events`.
--
-- Reconstructed from production via catalog introspection (06/14/2026).
-- `CREATE TABLE IF NOT EXISTS` makes this a safe no-op on production, which
-- already has both tables. Migration 004 adds events.latitude/longitude with
-- its own IF NOT EXISTS, so including those columns here does not conflict.
--
-- This file fixes the replayability gap permanently: the migration set can now
-- rebuild the full schema from scratch. See PROJECT_STATE.md (06/14/2026).

CREATE TABLE IF NOT EXISTS public.events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  venue_name  text,
  address     text,
  city        text,
  lat         double precision,
  lng         double precision,
  category    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  latitude    double precision,
  longitude   double precision
);

CREATE TABLE IF NOT EXISTS public.app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

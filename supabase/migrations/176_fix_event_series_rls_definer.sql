-- 176_fix_event_series_rls_definer.sql
--
-- FIX: user-created events fail with
--   "new row violates row-level security policy for table event_series"
--
-- Root cause: migration 152 added a BEFORE INSERT/UPDATE trigger
-- (explore_items_assign_series → assign_event_series) that inserts a row into
-- event_series for EVERY event (kind='event'), so a series-of-1 is created even
-- for a one-off "Once" event. But event_series has RLS enabled with only a
-- SELECT policy + SELECT grant (152:34-40) — no INSERT policy, no INSERT grant.
-- assign_event_series() was SECURITY INVOKER (the default), so its event_series
-- insert runs as the end user and is rejected by RLS. Crawler/ingestion inserts
-- never hit this because they use the service_role key (bypasses RLS).
--
-- Fix: make assign_event_series() SECURITY DEFINER (runs as the owner, which
-- bypasses RLS on event_series) + pin search_path (definer-safety). The function
-- body is unchanged — it only writes a series row derived from the NEW event row,
-- so definer rights don't widen what a user can write; they just let the
-- automatic, trigger-driven cascade complete. Users still cannot write
-- event_series directly (no INSERT policy/grant added).
--
-- Idempotent (CREATE OR REPLACE). ROLLBACK: re-run 152's assign_event_series()
-- definition (without SECURITY DEFINER) to restore the invoker-context behavior.

CREATE OR REPLACE FUNCTION public.assign_event_series()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE k text; sid uuid;
BEGIN
  IF NEW.kind <> 'event' OR NEW.title IS NULL THEN
    RETURN NEW;
  END IF;
  k := public.compute_series_key(NEW.title, NEW.location_name, NEW.external_id, NEW.source_id);
  INSERT INTO public.event_series (series_key, source_id, title, location_name, region_id, category)
    VALUES (k, NEW.source_id, NEW.title, NEW.location_name, NEW.region_id, NEW.category)
    ON CONFLICT (series_key) DO UPDATE SET updated_at = now()
    RETURNING id INTO sid;
  NEW.series_id := sid;
  RETURN NEW;
END;
$$;

-- Trigger already points at this function (152:104-107); redefining the function
-- is sufficient. Reasserted here idempotently for clarity / clean re-runs.
DROP TRIGGER IF EXISTS explore_items_assign_series ON public.explore_items;
CREATE TRIGGER explore_items_assign_series
  BEFORE INSERT OR UPDATE OF title, location_name, external_id, source_id, kind ON public.explore_items
  FOR EACH ROW EXECUTE FUNCTION public.assign_event_series();

-- ============================================================================
-- Fix get_items_needing_images leaks (135)
-- ============================================================================
-- Two bugs in the RPC migration 053 introduced:
--
--   1. No `deleted_at IS NULL` gate — soft-deleted rows keep returning from
--      the queue. The 20 civic-content rows we soft-deleted yesterday still
--      surfaced through every drain pass, wasted a Google Places API call
--      each, and polluted `pipeline_health_log` with their errors.
--
--   2. No source-type gate. cache-place-photos can only fetch images via the
--      Google Places Photo API — for any other source type (Web Collector,
--      Eventbrite, etc.), the external_id isn't a `places/...` resource and
--      the API 404s. Those rows occupy queue slots that should go to real
--      Places venues. lookup-venue-images is the right tool for non-Places
--      rows, but it isn't on a cron and isn't part of this fix.
--
-- After this:
--   * Soft-deleted rows disappear from the queue immediately.
--   * Only Google-Places-backed rows are returned by the default call.
--   * The p_source_type parameter still works for explicit overrides (e.g.,
--     a future lookup-venue-images drain).
-- ============================================================================

CREATE OR REPLACE FUNCTION get_items_needing_images(
  p_limit INT DEFAULT 50,
  p_source_type TEXT DEFAULT 'api_google_places'
)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  title TEXT,
  source_type TEXT,
  location_name TEXT,
  town TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    ei.id,
    ei.external_id,
    ei.title,
    es.type::TEXT AS source_type,
    ei.location_name,
    ei.town,
    ei.lat,
    ei.lng
  FROM explore_items ei
  JOIN event_sources es ON ei.source_id = es.id
  WHERE ei.image_url IS NULL
    AND ei.image_search_attempted_at IS NULL
    AND ei.priority >= 0
    AND ei.deleted_at IS NULL
    AND (p_source_type IS NULL OR es.type = p_source_type::event_source_type)
  ORDER BY ei.priority DESC, ei.created_at DESC
  LIMIT p_limit;
$$;

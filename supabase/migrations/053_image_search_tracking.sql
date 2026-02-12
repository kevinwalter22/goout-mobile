-- ============================================================================
-- Image Search Tracking & Multi-Source Support (053)
-- ============================================================================
-- Adds:
-- 1. image_search_attempted_at column to prevent re-searching
-- 2. Updated get_items_needing_images() for ALL source types
-- 3. mark_image_search_attempted() function
-- 4. Updated get_image_coverage_stats() with new metrics
-- ============================================================================

-- 1. Track items where image search was attempted but no image found
ALTER TABLE explore_items
ADD COLUMN IF NOT EXISTS image_search_attempted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN explore_items.image_search_attempted_at
  IS 'When image search was last attempted. Non-null + image_url IS NULL = no image available.';

-- 2. Index for items needing image search (any source type)
CREATE INDEX IF NOT EXISTS idx_explore_items_needs_image_any_source
ON explore_items (priority DESC, created_at DESC)
WHERE image_url IS NULL
  AND image_search_attempted_at IS NULL
  AND priority >= 0;

-- 3. Replace get_items_needing_images to support ALL source types
-- Must DROP first because return type is changing (adding new columns)
DROP FUNCTION IF EXISTS get_items_needing_images(INT);
DROP FUNCTION IF EXISTS get_items_needing_images(INT, TEXT);

-- Now returns location data needed for venue lookup
CREATE OR REPLACE FUNCTION get_items_needing_images(
  p_limit INT DEFAULT 50,
  p_source_type TEXT DEFAULT NULL
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
    es.type AS source_type,
    ei.location_name,
    ei.town,
    ei.lat,
    ei.lng
  FROM explore_items ei
  JOIN event_sources es ON ei.source_id = es.id
  WHERE ei.image_url IS NULL
    AND ei.image_search_attempted_at IS NULL
    AND ei.priority >= 0
    AND (p_source_type IS NULL OR es.type = p_source_type::event_source_type)
  ORDER BY ei.priority DESC, ei.created_at DESC
  LIMIT p_limit;
$$;

-- 4. Function to mark an item as "searched but no image found"
CREATE OR REPLACE FUNCTION mark_image_search_attempted(p_item_id UUID)
RETURNS VOID
LANGUAGE SQL
AS $$
  UPDATE explore_items
  SET image_search_attempted_at = NOW()
  WHERE id = p_item_id
    AND image_url IS NULL;
$$;

-- 5. Update update_source_image to also set image_search_attempted_at
CREATE OR REPLACE FUNCTION update_source_image(
  p_item_id UUID,
  p_image_url TEXT,
  p_thumb_url TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'unknown'
)
RETURNS VOID
LANGUAGE SQL
AS $$
  UPDATE explore_items
  SET
    image_url = p_image_url,
    image_thumb_url = COALESCE(p_thumb_url, p_image_url),
    image_cached_at = NOW(),
    image_source = p_source,
    image_search_attempted_at = NOW()
  WHERE id = p_item_id;
$$;

-- 6. Updated coverage stats with new metrics
-- Must DROP first because return type is changing (adding new columns)
DROP FUNCTION IF EXISTS get_image_coverage_stats();

CREATE OR REPLACE FUNCTION get_image_coverage_stats()
RETURNS TABLE (
  total_items BIGINT,
  items_with_cached_images BIGINT,
  items_without_images BIGINT,
  items_searched_no_result BIGINT,
  items_never_searched BIGINT,
  coverage_percentage NUMERIC,
  items_needing_refresh BIGINT,
  google_places_items BIGINT,
  google_places_with_images BIGINT,
  ticketmaster_items BIGINT,
  ticketmaster_with_images BIGINT,
  curated_items BIGINT,
  curated_with_images BIGINT,
  web_collector_items BIGINT,
  web_collector_with_images BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  WITH stats AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE image_url IS NOT NULL) AS with_images,
      COUNT(*) FILTER (WHERE image_url IS NULL) AS without_images,
      COUNT(*) FILTER (WHERE image_url IS NULL AND image_search_attempted_at IS NOT NULL) AS searched_no_result,
      COUNT(*) FILTER (WHERE image_url IS NULL AND image_search_attempted_at IS NULL) AS never_searched,
      COUNT(*) FILTER (WHERE needs_image_refresh(image_cached_at, 30)) AS needs_refresh
    FROM explore_items
    WHERE priority >= 0
  ),
  source_stats AS (
    SELECT
      es.type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE ei.image_url IS NOT NULL) AS with_images
    FROM explore_items ei
    JOIN event_sources es ON ei.source_id = es.id
    WHERE ei.priority >= 0
    GROUP BY es.type
  )
  SELECT
    s.total,
    s.with_images,
    s.without_images,
    s.searched_no_result,
    s.never_searched,
    ROUND(100.0 * s.with_images / NULLIF(s.total, 0), 1),
    s.needs_refresh,
    COALESCE((SELECT total FROM source_stats WHERE type = 'api_google_places'), 0),
    COALESCE((SELECT with_images FROM source_stats WHERE type = 'api_google_places'), 0),
    COALESCE((SELECT total FROM source_stats WHERE type = 'api_ticketmaster'), 0),
    COALESCE((SELECT with_images FROM source_stats WHERE type = 'api_ticketmaster'), 0),
    COALESCE((SELECT total FROM source_stats WHERE type = 'curated_csv'), 0),
    COALESCE((SELECT with_images FROM source_stats WHERE type = 'curated_csv'), 0),
    COALESCE((SELECT total FROM source_stats WHERE type IN ('web_collector', 'web_community_calendar')), 0),
    COALESCE((SELECT with_images FROM source_stats WHERE type IN ('web_collector', 'web_community_calendar')), 0)
  FROM stats s;
$$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Run: SELECT * FROM get_image_coverage_stats();
-- Run: SELECT * FROM get_items_needing_images(10);
-- Run: SELECT * FROM get_items_needing_images(10, 'curated_csv');
-- ============================================================================

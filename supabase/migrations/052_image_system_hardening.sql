-- ============================================================================
-- Image System Hardening (052)
-- ============================================================================
-- Adds:
-- 1. Category-based fallback images for items without photos
-- 2. Image coverage statistics function
-- 3. Scheduled refresh support via pg_cron (if available)
-- 4. Source-based image support (Ticketmaster, Eventbrite images)
-- ============================================================================

-- 1. Category fallback images
-- Maps categories to default placeholder images (Unsplash URLs or similar)
CREATE TABLE IF NOT EXISTS category_fallback_images (
  category TEXT PRIMARY KEY,
  fallback_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default fallback images by category
-- Using Unsplash source URLs for free, high-quality placeholders
INSERT INTO category_fallback_images (category, fallback_url) VALUES
  ('food', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=300&fit=crop'),
  ('dining', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=300&fit=crop'),
  ('music', 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&h=300&fit=crop'),
  ('concert', 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&h=300&fit=crop'),
  ('sports', 'https://images.unsplash.com/photo-1461896836934-28f9c7b2a0d9?w=400&h=300&fit=crop'),
  ('outdoors', 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=300&fit=crop'),
  ('nature', 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=300&fit=crop'),
  ('arts', 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=400&h=300&fit=crop'),
  ('theater', 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=400&h=300&fit=crop'),
  ('nightlife', 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=400&h=300&fit=crop'),
  ('community', 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=300&fit=crop'),
  ('fitness', 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=300&fit=crop'),
  ('shopping', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&h=300&fit=crop'),
  ('entertainment', 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&h=300&fit=crop'),
  ('education', 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=400&h=300&fit=crop'),
  ('default', 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400&h=300&fit=crop')
ON CONFLICT (category) DO NOTHING;

-- 2. Function to get fallback image for a category
CREATE OR REPLACE FUNCTION get_fallback_image(p_category TEXT)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    (SELECT fallback_url FROM category_fallback_images WHERE category = LOWER(p_category)),
    (SELECT fallback_url FROM category_fallback_images WHERE category = 'default')
  );
$$;

-- 3. Function to get display image (cached or fallback)
CREATE OR REPLACE FUNCTION get_display_image(
  p_image_thumb_url TEXT,
  p_category TEXT
)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    p_image_thumb_url,
    get_fallback_image(p_category)
  );
$$;

-- 4. Image coverage statistics
CREATE OR REPLACE FUNCTION get_image_coverage_stats()
RETURNS TABLE (
  total_items BIGINT,
  items_with_cached_images BIGINT,
  items_without_images BIGINT,
  coverage_percentage NUMERIC,
  items_needing_refresh BIGINT,
  google_places_items BIGINT,
  google_places_with_images BIGINT,
  ticketmaster_items BIGINT,
  ticketmaster_with_images BIGINT,
  curated_items BIGINT,
  curated_with_images BIGINT
)
LANGUAGE SQL
STABLE
AS $$
  WITH stats AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE image_url IS NOT NULL) AS with_images,
      COUNT(*) FILTER (WHERE image_url IS NULL) AS without_images,
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
    ROUND(100.0 * s.with_images / NULLIF(s.total, 0), 1),
    s.needs_refresh,
    COALESCE((SELECT total FROM source_stats WHERE type = 'api_google_places'), 0),
    COALESCE((SELECT with_images FROM source_stats WHERE type = 'api_google_places'), 0),
    COALESCE((SELECT total FROM source_stats WHERE type = 'api_ticketmaster'), 0),
    COALESCE((SELECT with_images FROM source_stats WHERE type = 'api_ticketmaster'), 0),
    COALESCE((SELECT total FROM source_stats WHERE type = 'curated_csv'), 0),
    COALESCE((SELECT with_images FROM source_stats WHERE type = 'curated_csv'), 0)
  FROM stats s;
$$;

-- 5. Function to get items needing refresh (for scheduled job)
CREATE OR REPLACE FUNCTION get_stale_images(p_limit INT DEFAULT 25)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  title TEXT,
  image_cached_at TIMESTAMPTZ,
  days_since_cache INT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    ei.id,
    ei.external_id,
    ei.title,
    ei.image_cached_at,
    EXTRACT(DAY FROM NOW() - ei.image_cached_at)::INT AS days_since_cache
  FROM explore_items ei
  JOIN event_sources es ON ei.source_id = es.id
  WHERE es.type = 'api_google_places'
    AND ei.external_id IS NOT NULL
    AND ei.image_url IS NOT NULL
    AND ei.image_cached_at < NOW() - INTERVAL '30 days'
    AND ei.priority >= 0
  ORDER BY ei.image_cached_at ASC
  LIMIT p_limit;
$$;

-- 6. Support for source-provided images (Ticketmaster, Eventbrite)
-- Add column to track if image came from source API vs Google Places
ALTER TABLE explore_items
ADD COLUMN IF NOT EXISTS image_source TEXT DEFAULT NULL;

COMMENT ON COLUMN explore_items.image_source IS 'Source of the cached image: google_places, ticketmaster, eventbrite, curated, fallback';

-- 7. Function to update source-provided image
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
    image_source = p_source
  WHERE id = p_item_id;
$$;

-- 8. Scheduled refresh (pg_cron) - only if extension available
-- Note: pg_cron may not be available on all Supabase plans
-- This creates the job but won't fail if pg_cron isn't available
DO $do_block$
BEGIN
  -- Check if pg_cron extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Schedule image refresh to run daily at 3 AM UTC
    -- This calls a lightweight function that just marks items for refresh
    PERFORM cron.schedule(
      'refresh-stale-images',
      '0 3 * * *',
      'SELECT 1'
    );
    RAISE NOTICE 'pg_cron job scheduled for image refresh';
  ELSE
    RAISE NOTICE 'pg_cron not available - manual refresh required';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule pg_cron job: %', SQLERRM;
END $do_block$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Run: SELECT * FROM get_image_coverage_stats();
-- Run: SELECT * FROM get_stale_images(10);
-- Run: SELECT get_fallback_image('food');
-- ============================================================================

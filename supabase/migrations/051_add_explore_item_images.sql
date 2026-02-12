-- ============================================================================
-- Add Image Support to Explore Items (051)
-- ============================================================================
-- Adds image_url field to explore_items for displaying photos on cards/detail.
-- Images are cached in Supabase Storage to avoid repeated Google API calls.
--
-- Strategy:
-- 1. Store the cached image URL (from our storage, not Google)
-- 2. Track when image was cached for refresh logic
-- 3. Create storage bucket with public read access
-- ============================================================================

-- 1. Add image columns to explore_items
ALTER TABLE explore_items
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS image_thumb_url TEXT,
ADD COLUMN IF NOT EXISTS image_cached_at TIMESTAMPTZ;

-- Index for finding items needing image fetch
CREATE INDEX IF NOT EXISTS idx_explore_items_needs_image
ON explore_items (source_id, external_id)
WHERE image_url IS NULL AND external_id IS NOT NULL;

-- 2. Create storage bucket for explore images
-- Note: This needs to be run via Supabase dashboard or CLI as storage bucket
-- creation isn't supported in migrations. Including here for documentation.
--
-- Bucket: explore-images
-- Public: Yes (for fast CDN access without auth)
-- Max file size: 5MB
-- Allowed mime types: image/jpeg, image/png, image/webp

-- 3. Create function to check if item needs image refresh
CREATE OR REPLACE FUNCTION needs_image_refresh(
  p_image_cached_at TIMESTAMPTZ,
  p_refresh_days INT DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT p_image_cached_at IS NULL
    OR p_image_cached_at < NOW() - (p_refresh_days || ' days')::INTERVAL;
$$;

-- 4. Create function to get items needing image fetch
-- Returns items from Google Places that need images
CREATE OR REPLACE FUNCTION get_items_needing_images(
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  external_id TEXT,
  title TEXT,
  source_type TEXT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    ei.id,
    ei.external_id,
    ei.title,
    es.type AS source_type
  FROM explore_items ei
  JOIN event_sources es ON ei.source_id = es.id
  WHERE es.type = 'api_google_places'
    AND ei.external_id IS NOT NULL
    AND ei.priority >= 0  -- Not demoted
    AND needs_image_refresh(ei.image_cached_at, 30)
  ORDER BY ei.priority DESC, ei.created_at DESC
  LIMIT p_limit;
$$;

-- 5. Function to update image URLs after caching
CREATE OR REPLACE FUNCTION update_item_image(
  p_item_id UUID,
  p_image_url TEXT,
  p_thumb_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE SQL
AS $$
  UPDATE explore_items
  SET
    image_url = p_image_url,
    image_thumb_url = COALESCE(p_thumb_url, p_image_url),
    image_cached_at = NOW()
  WHERE id = p_item_id;
$$;

-- ============================================================================
-- STORAGE BUCKET SETUP (Run manually in Supabase dashboard)
-- ============================================================================
--
-- 1. Go to Storage in Supabase dashboard
-- 2. Create bucket: "explore-images"
-- 3. Make it PUBLIC (toggle on)
-- 4. Set file size limit: 5MB
-- 5. Allowed MIME types: image/jpeg, image/png, image/webp
--
-- Or via SQL (may not work in all environments):
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'explore-images',
--   'explore-images',
--   true,
--   5242880,  -- 5MB
--   ARRAY['image/jpeg', 'image/png', 'image/webp']
-- )
-- ON CONFLICT (id) DO NOTHING;
--
-- RLS Policy for public read:
-- CREATE POLICY "Public read access"
-- ON storage.objects FOR SELECT
-- USING (bucket_id = 'explore-images');
--
-- RLS Policy for service role write:
-- CREATE POLICY "Service role can upload"
-- ON storage.objects FOR INSERT
-- WITH CHECK (bucket_id = 'explore-images');
-- ============================================================================

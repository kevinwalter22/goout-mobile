-- ============================================================================
-- Place Details Cache (Task 5)
-- ============================================================================
-- Lazy-loaded Google Places Details stored on first user view.
-- Avoids paying for Place Details API for every ingested item.
--
-- Rollback:
--   DROP TABLE IF EXISTS place_details_cache;
--   DROP FUNCTION IF EXISTS get_cached_place_details(UUID);
-- ============================================================================

CREATE TABLE IF NOT EXISTS place_details_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explore_item_id UUID NOT NULL REFERENCES explore_items(id) ON DELETE CASCADE,
  external_place_id TEXT NOT NULL, -- Google Place ID (places/ChIJ...)

  -- Extracted detail fields
  website_uri TEXT,
  phone_number TEXT,
  google_maps_uri TEXT,
  photos JSONB DEFAULT '[]'::JSONB,       -- [{name, width, height, uri}]
  reviews JSONB DEFAULT '[]'::JSONB,       -- [{author, rating, text, time}]
  opening_hours JSONB,                     -- Full regularOpeningHours object
  editorial_summary TEXT,
  rating NUMERIC(2,1),
  user_rating_count INTEGER,

  -- Cache metadata
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(explore_item_id)
);

CREATE INDEX IF NOT EXISTS idx_place_details_cache_item
  ON place_details_cache(explore_item_id);

CREATE INDEX IF NOT EXISTS idx_place_details_cache_expires
  ON place_details_cache(expires_at);

ALTER TABLE place_details_cache ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read cached details
DROP POLICY IF EXISTS "Authenticated users can read place details" ON place_details_cache;
CREATE POLICY "Authenticated users can read place details"
  ON place_details_cache FOR SELECT
  USING (auth.role() = 'authenticated');

-- Service role can manage (insert/update from edge function)
DROP POLICY IF EXISTS "Service role can manage place_details_cache" ON place_details_cache;
CREATE POLICY "Service role can manage place_details_cache"
  ON place_details_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Auto-update timestamp
DROP TRIGGER IF EXISTS update_place_details_cache_updated_at ON place_details_cache;
CREATE TRIGGER update_place_details_cache_updated_at
  BEFORE UPDATE ON place_details_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- get_cached_place_details: returns cached details or NULL
-- ============================================================================

CREATE OR REPLACE FUNCTION get_cached_place_details(p_explore_item_id UUID)
RETURNS TABLE(
  website_uri TEXT,
  phone_number TEXT,
  google_maps_uri TEXT,
  photos JSONB,
  reviews JSONB,
  opening_hours JSONB,
  editorial_summary TEXT,
  rating NUMERIC,
  user_rating_count INTEGER,
  fetched_at TIMESTAMPTZ,
  is_expired BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.website_uri,
    c.phone_number,
    c.google_maps_uri,
    c.photos,
    c.reviews,
    c.opening_hours,
    c.editorial_summary,
    c.rating,
    c.user_rating_count,
    c.fetched_at,
    (c.expires_at < NOW()) AS is_expired
  FROM place_details_cache c
  WHERE c.explore_item_id = p_explore_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_cached_place_details(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_cached_place_details(UUID) TO service_role;

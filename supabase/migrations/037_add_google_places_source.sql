-- ============================================================================
-- Add Google Places Source + Fetch Partition (Wave 3, Phase 1)
-- ============================================================================
-- Registers Google Places API (New) as an event source for evergreen
-- activity ingestion (restaurants, cafes, parks, gyms, museums, etc.).
--
-- The enum value 'api_google_places' already exists in event_source_type
-- (migration 017). This migration only adds the source row and partition.
--
-- Rollback:
--   DELETE FROM fetch_partitions
--     WHERE source_id IN (SELECT id FROM event_sources WHERE type = 'api_google_places');
--   DELETE FROM event_sources WHERE type = 'api_google_places';
-- ============================================================================

-- 1. Insert Google Places source
INSERT INTO event_sources (name, type, is_enabled, config_json)
VALUES (
  'Google Places',
  'api_google_places',
  true,
  '{
    "api_version": "v1",
    "endpoint": "places:searchNearby",
    "default_radius_meters": 50000,
    "default_included_types": [
      "restaurant", "cafe", "bar", "bakery",
      "gym", "spa",
      "park", "campground",
      "museum", "library", "art_gallery",
      "movie_theater", "bowling_alley",
      "night_club",
      "shopping_mall", "book_store",
      "tourist_attraction"
    ],
    "field_mask": "places.id,places.displayName,places.types,places.formattedAddress,places.location,places.priceLevel,places.rating,places.userRatingCount,places.regularOpeningHours,places.websiteUri,places.editorialSummary,places.primaryType,places.primaryTypeDisplayName,places.googleMapsUri"
  }'::JSONB
)
ON CONFLICT DO NOTHING;

-- 2. Insert fetch partition for Potsdam area activities
INSERT INTO fetch_partitions (
  source_id,
  partition_label,
  config_json,
  priority,
  fetch_interval_minutes
)
SELECT
  id,
  'potsdam-activities',
  '{
    "lat": 44.6697,
    "lng": -74.9814,
    "radius_meters": 50000,
    "included_types": [
      "restaurant", "cafe", "bar", "bakery",
      "gym", "spa",
      "park", "campground",
      "museum", "library", "art_gallery",
      "movie_theater", "bowling_alley",
      "night_club",
      "shopping_mall", "book_store",
      "tourist_attraction"
    ]
  }'::JSONB,
  5,      -- Lower priority than Ticketmaster events (10)
  720     -- 12 hours — places don't change often
FROM event_sources
WHERE type = 'api_google_places'
ON CONFLICT (source_id, partition_label) DO NOTHING;

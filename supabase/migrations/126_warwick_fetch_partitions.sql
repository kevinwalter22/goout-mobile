-- ============================================================================
-- Warwick, NY Fetch Partitions (126)
-- ============================================================================
-- Adds geographic partitions for Warwick, NY (zip 10990) and surrounding
-- Hudson Valley / Orange County / NJ-border towns. Mirrors the partition
-- pattern established for Potsdam in migrations 035, 037, 087.
--
-- Center: Warwick village (41.2545, -74.3590)
-- Coverage target: Warwick, Middletown, Monroe, Goshen, Greenwood Lake,
-- Chester, Florida NY, Sugar Loaf, Vernon NJ, plus Hudson Valley extension
-- (Bethel Woods, Newburgh) and NJ border (Sussex County).
--
-- Partition shapes (see commit message for full reasoning):
--   - Ticketmaster: 40 mi. Captures Hudson Valley venue corridor +
--     NJ border without dragging in Manhattan/Brooklyn — those belong to
--     a future NYC partition. Overlap with NYC partition is limited to a
--     thin Yonkers ring, handled by dedupe_key at storage time.
--   - Google Places: 50 km (API max). Single call covers full geography;
--     density doesn't justify sub-partitioning.
--   - PredictHQ: 50 km. Mirrors Potsdam shape. Monthly budget bumped from
--     500 -> 1000 at the bottom of this migration to cover both geographies.
--
-- Eventbrite: skipped (disabled globally in migration 036).
--
-- STAGING NOTE: all three partitions are inserted with is_enabled = FALSE.
-- Flip them on atomically after Phase 4 (collector targets) is reviewed:
--   UPDATE fetch_partitions
--      SET is_enabled = TRUE
--    WHERE partition_label IN ('warwick-40mi', 'warwick-activities', 'warwick-events');
--
-- Rollback:
--   DELETE FROM fetch_partitions
--     WHERE partition_label IN ('warwick-40mi', 'warwick-activities', 'warwick-events');
--   UPDATE api_usage_counters
--      SET requests_limit = 500
--    WHERE service = 'predicthq'
--      AND period_start = date_trunc('month', CURRENT_DATE)::DATE;
-- ============================================================================

-- ── Ticketmaster: warwick-40mi (STAGED — is_enabled FALSE) ──────────────
INSERT INTO fetch_partitions (
  source_id, partition_label, config_json, priority, fetch_interval_minutes, is_enabled
)
SELECT
  id,
  'warwick-40mi',
  '{
    "lat": 41.2545,
    "lng": -74.3590,
    "radius": 40,
    "days_ahead": 90
  }'::JSONB,
  10,
  360,  -- 6 hours, matches Potsdam ticketmaster cadence
  FALSE  -- staged for atomic flip after Phase 4 review
FROM event_sources
WHERE name = 'Ticketmaster'
ON CONFLICT (source_id, partition_label) DO NOTHING;

-- ── Google Places: warwick-activities (STAGED — is_enabled FALSE) ───────
INSERT INTO fetch_partitions (
  source_id, partition_label, config_json, priority, fetch_interval_minutes, is_enabled
)
SELECT
  id,
  'warwick-activities',
  '{
    "lat": 41.2545,
    "lng": -74.3590,
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
  5,
  720,  -- 12 hours, matches Potsdam google_places cadence
  FALSE
FROM event_sources
WHERE type = 'api_google_places'
ON CONFLICT (source_id, partition_label) DO NOTHING;

-- ── PredictHQ: warwick-events (STAGED — is_enabled FALSE) ───────────────
INSERT INTO fetch_partitions (
  source_id, partition_label, config_json, priority, fetch_interval_minutes, is_enabled
)
SELECT
  id,
  'warwick-events',
  '{
    "lat": 41.2545,
    "lng": -74.3590,
    "radius_km": 50,
    "categories": ["community", "concerts", "conferences", "expos", "festivals", "performing-arts", "sports"],
    "days_ahead": 90,
    "min_rank": 20
  }'::JSONB,
  8,
  720,  -- 12 hours, matches Potsdam predicthq cadence
  FALSE
FROM event_sources
WHERE type = 'api_predicthq'
ON CONFLICT (source_id, partition_label) DO NOTHING;

-- ── PredictHQ monthly budget: 500 -> 1000 ───────────────────────────────
-- Bumped proactively to cover Potsdam + Warwick on the same shared cap.
-- 1000/month is well within PredictHQ's actual free-tier ceiling.
-- UPSERT pattern handles both: current month row exists -> UPDATE limit;
-- doesn't exist yet -> INSERT with new limit.
INSERT INTO api_usage_counters (service, period_start, requests_used, requests_limit)
VALUES ('predicthq', date_trunc('month', CURRENT_DATE)::DATE, 0, 1000)
ON CONFLICT (service, period_start) DO UPDATE
  SET requests_limit = 1000;

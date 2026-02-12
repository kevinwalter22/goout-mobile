-- ============================================================================
-- Fix Item Kind Categorization (050)
-- ============================================================================
-- Corrects miscategorized items in explore_items:
-- - Items with starts_at (specific date/time) should be kind='event'
-- - Items from Google Places should be kind='activity' (places/evergreen)
-- - Items from Ticketmaster should be kind='event' (ticketed events)
-- - Recurring events (weekly wing night, etc.) are still events
--
-- Rules:
-- 1. Google Places source → always 'activity' (these are places, not events)
-- 2. Ticketmaster source → always 'event' (ticketed events)
-- 3. Has starts_at date → 'event' (scheduled occurrence)
-- 4. Event-like title patterns → 'event' if other signals present
-- ============================================================================

-- 1. Fix Google Places items that were incorrectly marked as events
-- (This shouldn't happen with current adapters, but just in case)
UPDATE explore_items
SET kind = 'activity'
WHERE source_id IN (
  SELECT id FROM event_sources WHERE type = 'api_google_places'
)
AND kind = 'event'
AND starts_at IS NULL;

-- 2. Fix Ticketmaster items that were incorrectly marked as activities
UPDATE explore_items
SET kind = 'event'
WHERE source_id IN (
  SELECT id FROM event_sources WHERE type = 'api_ticketmaster'
)
AND kind = 'activity';

-- 3. Fix items with specific start dates that are marked as activities
-- These should be events since they occur at a specific time
UPDATE explore_items
SET kind = 'event'
WHERE starts_at IS NOT NULL
AND kind = 'activity'
-- Exclude Google Places (they're evergreen activities even if they have operating hours)
AND source_id NOT IN (
  SELECT id FROM event_sources WHERE type = 'api_google_places'
);

-- 4. Fix event-like items based on title patterns
-- These are clearly events even if starts_at is somehow null
UPDATE explore_items
SET kind = 'event'
WHERE kind = 'activity'
AND (
  -- Sports events
  LOWER(title) ~ '(hockey|basketball|football|soccer|baseball|volleyball|game|match|tournament|vs\.?|versus)'
  -- Festivals and celebrations
  OR LOWER(title) ~ '(fest|festival|summerfest|winterfest|celebration|parade|fireworks)'
  -- Dated events
  OR LOWER(title) ~ '(first night|new year|solstice|equinox|memorial day|labor day|thanksgiving|christmas|easter|halloween)'
  -- Performances and shows
  OR LOWER(title) ~ '(concert|performance|show|recital|gala|benefit|fundraiser)'
  -- Recurring events (still events, just recurring)
  OR LOWER(title) ~ '(wing night|trivia night|karaoke night|open mic|ladies night|happy hour)'
)
-- Exclude Google Places - they might have similar names but are places
AND source_id NOT IN (
  SELECT id FROM event_sources WHERE type = 'api_google_places'
);

-- 5. Specific fixes for known items mentioned by user
-- (In case they weren't caught by patterns above)
UPDATE explore_items
SET kind = 'event'
WHERE kind = 'activity'
AND (
  LOWER(title) LIKE '%clarkson%st. lawrence%'
  OR LOWER(title) LIKE '%clarkson%st lawrence%'
  OR LOWER(title) LIKE '%potsdam summerfest%'
  OR LOWER(title) LIKE '%winter solstice fire%'
  OR LOWER(title) LIKE '%first night potsdam%'
);

-- Log the changes
DO $$
DECLARE
  event_count INT;
  activity_count INT;
BEGIN
  SELECT COUNT(*) INTO event_count FROM explore_items WHERE kind = 'event';
  SELECT COUNT(*) INTO activity_count FROM explore_items WHERE kind = 'activity';

  RAISE NOTICE 'After migration: % events, % activities', event_count, activity_count;
END $$;

-- ============================================================================
-- VERIFICATION QUERIES (run manually to verify)
-- ============================================================================
--
-- -- Check for any remaining activities with starts_at
-- SELECT title, kind, starts_at, source_id
-- FROM explore_items
-- WHERE kind = 'activity' AND starts_at IS NOT NULL
-- LIMIT 20;
--
-- -- Check event-like titles still marked as activities
-- SELECT title, kind, source_id
-- FROM explore_items
-- WHERE kind = 'activity'
-- AND (
--   LOWER(title) ~ '(game|fest|night|concert|show)'
-- )
-- LIMIT 20;
--
-- -- Count by kind and source
-- SELECT es.type, ei.kind, COUNT(*)
-- FROM explore_items ei
-- JOIN event_sources es ON ei.source_id = es.id
-- GROUP BY es.type, ei.kind
-- ORDER BY es.type, ei.kind;
-- ============================================================================

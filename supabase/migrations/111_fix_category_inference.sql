-- Migration 111: Fix category inference priority ordering
--
-- Root cause: infer_category_from_tags() (migration 048) checked food-related
-- tags FIRST, so any event with tags like 'bar' or 'drinks' (e.g., a board game
-- night at a brewery) got classified as "Food & Drink" regardless of activity type.
--
-- Fix: Activity-type signals are checked BEFORE venue-type signals.
--      'bar' is removed from the food trigger (it's a venue tag, not activity).
--      Re-queue likely-miscategorized Food & Drink events for re-enrichment.

-- ============================================================================
-- 1. Fix infer_category_from_tags() priority ordering
-- ============================================================================

CREATE OR REPLACE FUNCTION infer_category_from_tags(p_tags TEXT[])
RETURNS TEXT AS $$
BEGIN
  IF p_tags IS NULL OR array_length(p_tags, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  -- Activity-type signals FIRST (strongest category indicators).
  -- These identify WHAT the event IS, not WHERE it is hosted.

  -- Arts & Culture (explicit performance/culture activity tags)
  IF p_tags && ARRAY['museum', 'theater', 'live_music', 'concert', 'cultural', 'educational', 'festival', 'market', 'fair'] THEN
    RETURN 'arts';
  END IF;

  -- Fitness & Wellness
  IF p_tags && ARRAY['fitness', 'wellness', 'swimming'] THEN
    RETURN 'fitness';
  END IF;

  -- Outdoor & Nature
  IF p_tags && ARRAY['outdoors', 'nature', 'parks', 'hiking', 'trail', 'camping', 'scenic'] THEN
    RETURN 'outdoor';
  END IF;

  -- Winter Activities
  IF p_tags && ARRAY['skiing', 'snowboarding', 'ice_skating', 'winter_activity'] THEN
    RETURN 'winter';
  END IF;

  -- Recreation & Sports
  IF p_tags && ARRAY['sports', 'recreation', 'adventure'] THEN
    RETURN 'recreation';
  END IF;

  -- Nightlife (venue as destination — clubs, late-night bars)
  IF p_tags && ARRAY['nightlife'] THEN
    RETURN 'nightlife';
  END IF;

  -- Social (catches board game nights, meetups, group events not tagged with arts)
  IF p_tags && ARRAY['social', 'group_activity', 'family_friendly'] THEN
    RETURN 'arts';
  END IF;

  -- Venue-type signals LAST.
  -- Only fires if no activity-type keyword matched above.
  -- 'bar' intentionally excluded: it is a venue tag, not an activity.
  IF p_tags && ARRAY['food', 'dining', 'coffee', 'drinks', 'brewery'] THEN
    RETURN 'food';
  END IF;

  -- Shopping
  IF p_tags && ARRAY['shopping'] THEN
    RETURN 'community';
  END IF;

  -- Community fallback
  IF p_tags && ARRAY['local_favorite'] THEN
    RETURN 'community';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION infer_category_from_tags IS
'Infers category from tags array using priority-ordered matching.
Activity-type signals (arts, fitness, outdoor) take priority over
venue-type signals (food, bar, drinks) to prevent venue-type bleed.
Updated in migration 111.';

-- ============================================================================
-- 2. Re-queue likely-miscategorized "Food & Drink" events for re-enrichment
--
-- These are events currently showing as Food & Drink whose titles strongly
-- suggest a non-food activity (gaming, trivia, comedy, fitness, arts).
-- Re-enrichment with the improved LLM prompt will correct their categories.
-- ============================================================================

INSERT INTO enrichment_queue (explore_item_id, priority)
SELECT
  id,
  90
FROM explore_items
WHERE category = 'Food & Drink'
  AND kind = 'event'
  AND deleted_at IS NULL
  AND title ~* '(board.?game|trivia|bingo|karaoke|escape.?room|pub.?quiz|comedy.?show|comedy.?night|stand.?up|improv|open.?mic|game.?night|paint.?(and|&|n).?sip|pottery.?class|craft.?night|yoga.?class|yoga.?session|pilates|fitness.?class|run.?club|running.?club|cycling.?class|spin.?class)'
  AND NOT EXISTS (
    SELECT 1 FROM enrichment_queue eq
    WHERE eq.explore_item_id = explore_items.id
      AND eq.completed_at IS NULL
  )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Venue Collection Infrastructure (Elite Local Discovery — Phase 0)
-- ============================================================================
-- Establishes the data model for automated venue website discovery and
-- recurring schedule tracking. No changes to existing pipeline logic.
--
-- New tables:
--   venue_website_candidates   — staging queue for venue evaluation pipeline
--   venue_event_schedules      — canonical recurring schedule entity per venue
--
-- Column additions:
--   explore_items              — freshness tracking + schedule link
--   collector_targets          — discovery provenance + trust tier + LLM gate
--
-- New function:
--   score_venue_for_events()   — seeds venue_website_candidates from Google
--                                Places activities already in explore_items
--
-- Rollback:
--   DROP TABLE IF EXISTS venue_website_candidates CASCADE;
--   DROP TABLE IF EXISTS venue_event_schedules CASCADE;
--   DROP FUNCTION IF EXISTS score_venue_for_events(INTEGER);
--   ALTER TABLE explore_items
--     DROP COLUMN IF EXISTS last_source_confirmed_at,
--     DROP COLUMN IF EXISTS source_confidence_decay_at,
--     DROP COLUMN IF EXISTS venue_schedule_id;
--   ALTER TABLE collector_targets
--     DROP COLUMN IF EXISTS auto_discovered,
--     DROP COLUMN IF EXISTS discovery_source,
--     DROP COLUMN IF EXISTS discovery_venue_item_id,
--     DROP COLUMN IF EXISTS last_verified_events_at,
--     DROP COLUMN IF EXISTS source_trust_tier,
--     DROP COLUMN IF EXISTS last_llm_extraction_at,
--     DROP COLUMN IF EXISTS event_yield_7d;
-- ============================================================================

-- ============================================================================
-- 1. venue_event_schedules
--    Canonical recurring schedule entity — one row per recurring event pattern
--    at a venue (e.g. "Trivia Night, Tuesdays 7pm"). Created here so that
--    explore_items.venue_schedule_id can reference it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS venue_event_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Venue link (FK to the Google Places activity item, nullable)
  venue_explore_item_id UUID REFERENCES explore_items(id) ON DELETE SET NULL,
  collector_target_id UUID REFERENCES collector_targets(id) ON DELETE SET NULL,

  -- Schedule definition
  title TEXT NOT NULL,                -- "Trivia Night", "Wing Night"
  day_of_week SMALLINT                -- 0=Sunday … 6=Saturday
    CHECK (day_of_week >= 0 AND day_of_week <= 6),
  time_of_day TIME,                   -- 19:00:00
  duration_minutes INTEGER CHECK (duration_minutes > 0),

  -- Recurrence
  rrule TEXT,                         -- RFC 5545 RRULE string (e.g. FREQ=WEEKLY;BYDAY=TU)
  recurrence_text TEXT,               -- Human-readable: "Every Tuesday at 7pm"

  -- Content
  category TEXT,
  tags TEXT[],
  price_text TEXT,
  price_bucket TEXT CHECK (price_bucket IN ('free', '$', '$$', '$$$', 'unknown')),
  description TEXT,

  -- Provenance
  source_url TEXT,
  source_type TEXT CHECK (source_type IN (
    'ics', 'jsonld', 'rss', 'html_dom', 'ai_inferred', 'owner_submitted', 'manual'
  )),
  confidence INTEGER NOT NULL DEFAULT 50
    CHECK (confidence >= 0 AND confidence <= 100),

  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ,
  verified_by TEXT CHECK (verified_by IN ('auto', 'admin', 'owner')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venue_event_schedules_venue
  ON venue_event_schedules (venue_explore_item_id)
  WHERE venue_explore_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venue_event_schedules_target
  ON venue_event_schedules (collector_target_id)
  WHERE collector_target_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venue_event_schedules_active
  ON venue_event_schedules (day_of_week, time_of_day)
  WHERE is_active = true;

CREATE OR REPLACE TRIGGER trg_venue_event_schedules_updated
  BEFORE UPDATE ON venue_event_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 2. explore_items — freshness tracking + schedule link
-- ============================================================================

ALTER TABLE explore_items
  -- When was the source URL last confirmed still live by the web collector?
  ADD COLUMN IF NOT EXISTS last_source_confirmed_at TIMESTAMPTZ,
  -- Pre-computed date after which confidence should be decayed (set by normalizer)
  ADD COLUMN IF NOT EXISTS source_confidence_decay_at TIMESTAMPTZ,
  -- Optional link to a canonical recurring schedule this item was generated from
  ADD COLUMN IF NOT EXISTS venue_schedule_id UUID REFERENCES venue_event_schedules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_explore_items_freshness
  ON explore_items (last_source_confirmed_at ASC NULLS FIRST)
  WHERE kind = 'event' AND source_url IS NOT NULL AND priority >= 0;

-- ============================================================================
-- 3. collector_targets — discovery provenance, trust tier, LLM gate
-- ============================================================================

ALTER TABLE collector_targets
  -- Was this target auto-discovered (vs manually seeded)?
  ADD COLUMN IF NOT EXISTS auto_discovered BOOLEAN NOT NULL DEFAULT false,
  -- How was it discovered: 'google_places', 'manual', 'user_submission'
  ADD COLUMN IF NOT EXISTS discovery_source TEXT,
  -- The explore_items row that led to this target being created
  ADD COLUMN IF NOT EXISTS discovery_venue_item_id UUID REFERENCES explore_items(id) ON DELETE SET NULL,
  -- Last time the target was confirmed to be yielding live events
  ADD COLUMN IF NOT EXISTS last_verified_events_at TIMESTAMPTZ,
  -- Trust tier: platinum > gold > silver > bronze
  ADD COLUMN IF NOT EXISTS source_trust_tier TEXT NOT NULL DEFAULT 'silver',
  -- Gate for LLM extraction: don't re-run within 7 days
  ADD COLUMN IF NOT EXISTS last_llm_extraction_at TIMESTAMPTZ,
  -- Events yielded in the last 7 days (updated by ingest-web-collector)
  ADD COLUMN IF NOT EXISTS event_yield_7d INTEGER NOT NULL DEFAULT 0;

-- Add check constraint separately (DO block handles duplicate constraint gracefully)
DO $$ BEGIN
  ALTER TABLE collector_targets
    ADD CONSTRAINT chk_source_trust_tier
    CHECK (source_trust_tier IN ('platinum', 'gold', 'silver', 'bronze'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN collector_targets.source_trust_tier IS
  'Trust tier: platinum=API sources, gold=campus/municipal/org, silver=venue JSON-LD/ICS, bronze=HTML DOM/LLM';

CREATE INDEX IF NOT EXISTS idx_collector_targets_trust_tier
  ON collector_targets (source_trust_tier, is_enabled);

-- ============================================================================
-- 4. venue_website_candidates
--    Staging pipeline for venue website evaluation. Populated by
--    score_venue_for_events() and consumed by evaluate-venue-websites function.
-- ============================================================================

CREATE TABLE IF NOT EXISTS venue_website_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source — the Google Places activity in explore_items
  explore_item_id UUID REFERENCES explore_items(id) ON DELETE SET NULL,
  google_place_id TEXT,               -- external_id from explore_items (Google Place ID)

  -- Venue info (denormalized so the evaluation function is self-contained)
  place_name TEXT NOT NULL,
  place_type TEXT,                    -- sub_category from explore_items (Google primaryType)
  website_url TEXT NOT NULL,          -- source_url from explore_items
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  address TEXT,
  town TEXT,

  -- Scoring
  event_score INTEGER NOT NULL DEFAULT 0 CHECK (event_score >= 0 AND event_score <= 100),
  score_signals JSONB,                -- {type_score, hours_score, place_type, has_nightlife_tags}

  -- Pipeline state
  discovery_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    discovery_status IN (
      'pending',          -- Not yet evaluated
      'evaluating',       -- evaluate-venue-websites is processing this row
      'has_events',       -- Events/calendar page detected → collector_target created
      'no_events',        -- No event signals found on website
      'error',            -- Evaluation failed (fetch error, robots.txt blocked, etc.)
      'added_as_target',  -- collector_target created and is_enabled = true
      'blocked'           -- Blocked by domain blocklist or manually excluded
    )
  ),

  -- Evaluation results (populated by evaluate-venue-websites)
  evaluation_result JSONB,            -- {pages_checked, strategies_found, fetch_errors}
  detected_strategy TEXT CHECK (
    detected_strategy IN ('jsonld', 'ics', 'rss', 'html_dom', NULL)
  ),
  detected_event_urls TEXT[],         -- Specific URLs with event content: ['/events', '/calendar.ics']
  event_signal_keywords TEXT[],       -- Keywords found: ["trivia", "live music"]

  -- Outcome link
  collector_target_id UUID REFERENCES collector_targets(id) ON DELETE SET NULL,
  blocked_reason TEXT,

  -- Timestamps
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (website_url)
);

COMMENT ON TABLE venue_website_candidates IS
  'Staging queue for venue website evaluation. score_venue_for_events() populates from Google Places data; evaluate-venue-websites function evaluates and promotes to collector_targets.';

CREATE INDEX IF NOT EXISTS idx_vwc_pending_score
  ON venue_website_candidates (event_score DESC)
  WHERE discovery_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_vwc_status
  ON venue_website_candidates (discovery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vwc_place_name
  ON venue_website_candidates (place_name);

-- ============================================================================
-- 5. RLS policies
-- ============================================================================

ALTER TABLE venue_event_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_website_candidates ENABLE ROW LEVEL SECURITY;

-- Only service_role (edge functions) can read/write these tables
CREATE POLICY "service_role_venue_event_schedules" ON venue_event_schedules
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_venue_website_candidates" ON venue_website_candidates
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 6. score_venue_for_events()
--    Seeds venue_website_candidates from Google Places activity items that
--    already have a website URL. Run once after migration, then periodically
--    as new Google Places data arrives.
--
--    Scoring:
--      type_score  (0-90): based on Google Places primaryType (sub_category)
--      hours_score (0-15): bonus for late-night opening hours
--      Total capped at 100.
--
--    Items scoring below p_min_score are silently skipped.
--    Items whose website_url already exists in venue_website_candidates or
--    whose domain is already a collector_target base_url are also skipped.
--
-- Usage:
--   SELECT score_venue_for_events();       -- default min score 30
--   SELECT score_venue_for_events(50);     -- only high-confidence venues
-- ============================================================================

CREATE OR REPLACE FUNCTION score_venue_for_events(
  p_min_score INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted  INTEGER := 0;
  rec         RECORD;
  v_type_score  INTEGER;
  v_hours_score INTEGER;
  v_event_score INTEGER;
  v_domain      TEXT;
BEGIN
  FOR rec IN
    SELECT
      ei.id            AS explore_item_id,
      ei.external_id   AS google_place_id,
      ei.title         AS place_name,
      ei.sub_category  AS place_type,
      ei.source_url    AS website_url,
      ei.lat,
      ei.lng,
      ei.address,
      ei.town,
      ei.tags,
      ei.schedule_text
    FROM explore_items ei
    JOIN event_sources es ON es.id = ei.source_id AND es.type = 'api_google_places'
    WHERE
      ei.kind = 'activity'
      AND ei.source_url IS NOT NULL
      AND ei.deleted_at IS NULL
      AND ei.priority >= 0
      -- Skip if already in the candidates table (UNIQUE constraint handles race conditions,
      -- but skipping here avoids unnecessary loop iterations)
      AND NOT EXISTS (
        SELECT 1 FROM venue_website_candidates vwc
        WHERE vwc.website_url = ei.source_url
      )
  LOOP
    -- ── Extract domain for collector_targets dedup check ──────────────────
    -- e.g. https://www.example.com/foo → example.com
    v_domain := substring(rec.website_url FROM '^https?://(?:www\.)?([^/?#]+)');

    -- Skip if the domain is already being crawled as a collector_target
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM collector_targets ct
      WHERE ct.base_url ILIKE '%' || v_domain || '%'
    );

    -- ── Score by venue type (Google Places primaryType = sub_category) ────
    v_type_score := CASE rec.place_type
      WHEN 'night_club'               THEN 90
      WHEN 'bar'                      THEN 80
      WHEN 'performing_arts_theater'  THEN 85
      WHEN 'bowling_alley'            THEN 75
      WHEN 'community_center'         THEN 65
      WHEN 'amusement_park'           THEN 60
      WHEN 'museum'                   THEN 55
      WHEN 'library'                  THEN 50
      WHEN 'aquarium'                 THEN 50
      WHEN 'tourist_attraction'       THEN 40
      WHEN 'restaurant'               THEN 45
      WHEN 'cafe'                     THEN 35
      ELSE                                 20
    END;

    -- Boost if tags signal nightlife or live events (catches types not in CASE above)
    IF rec.tags IS NOT NULL AND rec.tags && ARRAY['nightlife', 'live_event', 'bar', 'drinks']::TEXT[] THEN
      v_type_score := GREATEST(v_type_score, 70);
    END IF;

    -- ── Score by late-night opening hours (proxy for event/nightlife venue) ─
    v_hours_score := 0;
    IF rec.schedule_text IS NOT NULL THEN
      IF rec.schedule_text ILIKE '%12:00 AM%'
         OR rec.schedule_text ILIKE '%1:00 AM%'
         OR rec.schedule_text ILIKE '%2:00 AM%' THEN
        v_hours_score := 15;
      ELSIF rec.schedule_text ILIKE '%11:00 PM%' THEN
        v_hours_score := 12;
      ELSIF rec.schedule_text ILIKE '%10:00 PM%' THEN
        v_hours_score := 8;
      END IF;
    END IF;

    v_event_score := LEAST(v_type_score + v_hours_score, 100);

    CONTINUE WHEN v_event_score < p_min_score;

    -- ── Insert candidate ──────────────────────────────────────────────────
    INSERT INTO venue_website_candidates (
      explore_item_id,
      google_place_id,
      place_name,
      place_type,
      website_url,
      lat,
      lng,
      address,
      town,
      event_score,
      score_signals
    ) VALUES (
      rec.explore_item_id,
      rec.google_place_id,
      rec.place_name,
      rec.place_type,
      rec.website_url,
      rec.lat,
      rec.lng,
      rec.address,
      rec.town,
      v_event_score,
      jsonb_build_object(
        'type_score',          v_type_score,
        'hours_score',         v_hours_score,
        'place_type',          rec.place_type,
        'has_nightlife_tags',  (rec.tags IS NOT NULL AND rec.tags && ARRAY['nightlife', 'live_event', 'bar', 'drinks']::TEXT[])
      )
    )
    ON CONFLICT (website_url) DO NOTHING;

    -- Only count rows that were actually inserted (not skipped by conflict)
    IF FOUND THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'score_venue_for_events: inserted % new candidates (min_score=%)', v_inserted, p_min_score;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION score_venue_for_events(INTEGER) TO service_role;

-- ============================================================================
-- 7. Seed venue_website_candidates from existing Google Places data
--    Uses default min_score=30 to cast a wide net on first run.
--    The evaluate-venue-websites function (Phase 1) will do the real filtering.
-- ============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT score_venue_for_events(30) INTO v_count;
  RAISE NOTICE '118 bootstrap: seeded % venue candidates from existing Google Places data', v_count;
END;
$$;

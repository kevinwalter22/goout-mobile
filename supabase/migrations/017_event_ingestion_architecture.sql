-- ============================================================================
-- Event Ingestion Architecture
-- ============================================================================
-- This migration creates a professional event ingestion system with:
-- - event_sources: Registry of data sources (APIs, CSVs, etc.)
-- - event_ingest_raw: Raw ingested data before normalization
-- - explore_items: Canonical table queried by the app
-- - event_normalization_jobs: Job queue for processing raw data
-- ============================================================================

-- ============================================================================
-- ENUMS (using DO block for IF NOT EXISTS support)
-- ============================================================================

DO $do_block$ BEGIN
  CREATE TYPE event_source_type AS ENUM (
    'curated_csv',
    'api_ticketmaster',
    'api_predicthq',
    'api_eventbrite',
    'api_yelp',
    'api_google_places',
    'manual'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do_block$;

DO $do_block$ BEGIN
  CREATE TYPE ingest_status AS ENUM (
    'new',
    'normalized',
    'failed',
    'skipped'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do_block$;

DO $do_block$ BEGIN
  CREATE TYPE explore_item_kind AS ENUM (
    'event',
    'activity'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do_block$;

DO $do_block$ BEGIN
  CREATE TYPE price_bucket AS ENUM (
    'free',
    '$',
    '$$',
    '$$$',
    'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do_block$;

DO $do_block$ BEGIN
  CREATE TYPE effort_level AS ENUM (
    'low',
    'medium',
    'high',
    'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do_block$;

DO $do_block$ BEGIN
  CREATE TYPE job_status AS ENUM (
    'queued',
    'running',
    'done',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do_block$;

-- ============================================================================
-- TABLE: event_sources
-- Registry of all data sources for event ingestion
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  type event_source_type NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  config_json JSONB DEFAULT '{}',
  -- Metadata
  last_fetch_at TIMESTAMPTZ,
  fetch_interval_minutes INTEGER DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comment
COMMENT ON TABLE event_sources IS 'Registry of data sources for event ingestion (APIs, CSVs, etc.)';

-- ============================================================================
-- TABLE: event_ingest_raw
-- Raw ingested data before normalization
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_ingest_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES event_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_json JSONB NOT NULL,
  raw_hash TEXT NOT NULL, -- SHA256 hash for deduplication
  status ingest_status NOT NULL DEFAULT 'new',
  last_error TEXT,
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Unique constraint per source
  UNIQUE(source_id, external_id)
);

-- Add comment
COMMENT ON TABLE event_ingest_raw IS 'Raw ingested event data before normalization processing';

-- ============================================================================
-- TABLE: explore_items
-- Canonical table queried by the app - normalized event/activity data
-- ============================================================================

CREATE TABLE IF NOT EXISTS explore_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES event_sources(id) ON DELETE SET NULL,
  external_id TEXT,
  kind explore_item_kind NOT NULL DEFAULT 'event',

  -- Core content
  title TEXT NOT NULL,
  description TEXT,
  hook_line TEXT, -- Short catchy description for cards

  -- Categorization
  category TEXT,
  sub_category TEXT,

  -- Location
  location_name TEXT, -- Venue or place name
  address TEXT,
  town TEXT,
  lat FLOAT8,
  lng FLOAT8,

  -- Timing (nullable for activities/recurring events)
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,

  -- Flexible schedule fields for non-standard timing
  schedule_text TEXT, -- e.g., "Every Saturday 9am-12pm"
  time_text TEXT, -- e.g., "Morning", "Evening"
  recurrence TEXT, -- e.g., "weekly", "monthly", "daily"
  season TEXT, -- e.g., "summer", "winter", "year-round"

  -- Pricing and effort
  price_bucket price_bucket NOT NULL DEFAULT 'unknown',
  effort effort_level NOT NULL DEFAULT 'unknown',

  -- Gamification
  xp_value INTEGER,
  priority INTEGER DEFAULT 0, -- For sorting/featuring

  -- Flags
  is_anchor BOOLEAN NOT NULL DEFAULT false, -- Major events
  is_hidden_gem BOOLEAN NOT NULL DEFAULT false, -- Local favorites

  -- Source reference
  source_url TEXT,

  -- Quality score from normalization
  normalized_confidence INTEGER CHECK (normalized_confidence >= 0 AND normalized_confidence <= 100),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint per source
  UNIQUE(source_id, external_id)
);

-- Add comment
COMMENT ON TABLE explore_items IS 'Canonical explore items table - normalized events and activities queried by the app';

-- ============================================================================
-- TABLE: event_normalization_jobs
-- Job queue for processing raw ingested data
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_normalization_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_id UUID NOT NULL REFERENCES event_ingest_raw(id) ON DELETE CASCADE,
  status job_status NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  -- Processing metadata
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Only one job per raw record
  UNIQUE(raw_id)
);

-- Add comment
COMMENT ON TABLE event_normalization_jobs IS 'Job queue for normalizing raw ingested event data';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- event_sources indexes
CREATE INDEX IF NOT EXISTS idx_event_sources_type ON event_sources(type);
CREATE INDEX IF NOT EXISTS idx_event_sources_enabled ON event_sources(is_enabled) WHERE is_enabled = true;

-- event_ingest_raw indexes
CREATE INDEX IF NOT EXISTS idx_event_ingest_raw_source_id ON event_ingest_raw(source_id);
CREATE INDEX IF NOT EXISTS idx_event_ingest_raw_status ON event_ingest_raw(status);
CREATE INDEX IF NOT EXISTS idx_event_ingest_raw_fetched_at ON event_ingest_raw(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_ingest_raw_hash ON event_ingest_raw(raw_hash);

-- explore_items indexes (optimized for common app queries)
CREATE INDEX IF NOT EXISTS idx_explore_items_starts_at ON explore_items(starts_at) WHERE starts_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_explore_items_town ON explore_items(town);
CREATE INDEX IF NOT EXISTS idx_explore_items_category ON explore_items(category);
CREATE INDEX IF NOT EXISTS idx_explore_items_kind ON explore_items(kind);
CREATE INDEX IF NOT EXISTS idx_explore_items_lat_lng ON explore_items(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_explore_items_priority ON explore_items(priority DESC);
CREATE INDEX IF NOT EXISTS idx_explore_items_is_anchor ON explore_items(is_anchor) WHERE is_anchor = true;
CREATE INDEX IF NOT EXISTS idx_explore_items_source_id ON explore_items(source_id);

-- Composite index for common queries (upcoming events in a town)
CREATE INDEX IF NOT EXISTS idx_explore_items_town_starts_at ON explore_items(town, starts_at)
  WHERE starts_at IS NOT NULL;

-- event_normalization_jobs indexes
CREATE INDEX IF NOT EXISTS idx_normalization_jobs_status ON event_normalization_jobs(status);
CREATE INDEX IF NOT EXISTS idx_normalization_jobs_queued ON event_normalization_jobs(created_at)
  WHERE status = 'queued';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE event_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_ingest_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE explore_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_normalization_jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES: event_sources
-- Only service role can read/write (admin only)
-- ============================================================================

DROP POLICY IF EXISTS "Service role can manage event_sources" ON event_sources;
CREATE POLICY "Service role can manage event_sources"
  ON event_sources FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- RLS POLICIES: event_ingest_raw
-- Only service role can read/write (backend processing only)
-- ============================================================================

DROP POLICY IF EXISTS "Service role can manage event_ingest_raw" ON event_ingest_raw;
CREATE POLICY "Service role can manage event_ingest_raw"
  ON event_ingest_raw FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- RLS POLICIES: explore_items
-- Authenticated users can read, only service role can write
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can read explore_items" ON explore_items;
CREATE POLICY "Authenticated users can read explore_items"
  ON explore_items FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role can manage explore_items" ON explore_items;
CREATE POLICY "Service role can manage explore_items"
  ON explore_items FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- RLS POLICIES: event_normalization_jobs
-- Only service role can read/write (backend processing only)
-- ============================================================================

DROP POLICY IF EXISTS "Service role can manage event_normalization_jobs" ON event_normalization_jobs;
CREATE POLICY "Service role can manage event_normalization_jobs"
  ON event_normalization_jobs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- TRIGGERS: Auto-update updated_at
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for each table
DROP TRIGGER IF EXISTS update_event_sources_updated_at ON event_sources;
CREATE TRIGGER update_event_sources_updated_at
  BEFORE UPDATE ON event_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_ingest_raw_updated_at ON event_ingest_raw;
CREATE TRIGGER update_event_ingest_raw_updated_at
  BEFORE UPDATE ON event_ingest_raw
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_explore_items_updated_at ON explore_items;
CREATE TRIGGER update_explore_items_updated_at
  BEFORE UPDATE ON explore_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_normalization_jobs_updated_at ON event_normalization_jobs;
CREATE TRIGGER update_event_normalization_jobs_updated_at
  BEFORE UPDATE ON event_normalization_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to create a normalization job when raw data is inserted
CREATE OR REPLACE FUNCTION create_normalization_job()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO event_normalization_jobs (raw_id, status)
  VALUES (NEW.id, 'queued')
  ON CONFLICT (raw_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-create normalization job on raw insert
DROP TRIGGER IF EXISTS auto_create_normalization_job ON event_ingest_raw;
CREATE TRIGGER auto_create_normalization_job
  AFTER INSERT ON event_ingest_raw
  FOR EACH ROW EXECUTE FUNCTION create_normalization_job();

-- Function to claim next normalization job (atomic)
CREATE OR REPLACE FUNCTION claim_normalization_job()
RETURNS TABLE(
  job_id UUID,
  raw_id UUID,
  source_id UUID,
  external_id TEXT,
  raw_json JSONB
) AS $$
DECLARE
  v_job_id UUID;
  v_raw_id UUID;
BEGIN
  -- Atomically claim the next queued job
  UPDATE event_normalization_jobs
  SET status = 'running',
      started_at = NOW(),
      attempts = attempts + 1,
      updated_at = NOW()
  WHERE id = (
    SELECT id FROM event_normalization_jobs
    WHERE status = 'queued'
      AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, event_normalization_jobs.raw_id INTO v_job_id, v_raw_id;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  -- Return job details with raw data
  RETURN QUERY
  SELECT
    v_job_id,
    r.id,
    r.source_id,
    r.external_id,
    r.raw_json
  FROM event_ingest_raw r
  WHERE r.id = v_raw_id;
END;
$$ LANGUAGE plpgsql;

-- Function to complete a normalization job
CREATE OR REPLACE FUNCTION complete_normalization_job(
  p_job_id UUID,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE event_normalization_jobs
  SET
    status = CASE WHEN p_success THEN 'done' ELSE 'failed' END,
    completed_at = NOW(),
    last_error = p_error,
    updated_at = NOW()
  WHERE id = p_job_id;

  -- Also update the raw record status
  UPDATE event_ingest_raw
  SET
    status = CASE WHEN p_success THEN 'normalized' ELSE 'failed' END,
    last_error = p_error,
    updated_at = NOW()
  WHERE id = (SELECT raw_id FROM event_normalization_jobs WHERE id = p_job_id);
END;
$$ LANGUAGE plpgsql;

-- Grant execute on functions to service role
GRANT EXECUTE ON FUNCTION claim_normalization_job() TO service_role;
GRANT EXECUTE ON FUNCTION complete_normalization_job(UUID, BOOLEAN, TEXT) TO service_role;

-- ============================================================================
-- SEED: Default event sources
-- ============================================================================

INSERT INTO event_sources (name, type, is_enabled, config_json) VALUES
  ('Manual Curation', 'manual', true, '{"description": "Manually curated events and activities"}'),
  ('Local CSV Import', 'curated_csv', true, '{"description": "CSV imports for local events"}')
ON CONFLICT (name) DO NOTHING;

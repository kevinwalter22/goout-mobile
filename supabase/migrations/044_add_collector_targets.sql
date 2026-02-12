-- ============================================================================
-- Collector Targets Configuration (W4-1)
-- ============================================================================
-- First-class configuration model for web collectors with:
-- - Per-target enable/disable without deployment
-- - Discovery URLs and allowed paths
-- - Parsing strategy selection
-- - Rate limiting and circuit breaker state
-- - Robots.txt caching
--
-- NON-NEGOTIABLE RULES ENFORCED:
-- - NO scraping social media (Facebook/Instagram/TikTok)
-- - Respect robots.txt (cached per target)
-- - Allowlist-only: every target must be explicitly configured
-- - Circuit breakers auto-disable on repeated errors
--
-- Rollback:
--   DROP TABLE IF EXISTS collector_targets;
--   DROP TABLE IF EXISTS collector_page_cache;
--   DROP TYPE IF EXISTS parsing_strategy;
--   DROP TYPE IF EXISTS circuit_breaker_state;
--   DROP FUNCTION IF EXISTS get_enabled_collector_targets();
--   DROP FUNCTION IF EXISTS trip_circuit_breaker(UUID, TEXT);
--   DROP FUNCTION IF EXISTS reset_circuit_breaker(UUID);
-- ============================================================================

-- ============================================================================
-- 1. Enums for parsing strategy and circuit breaker state
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE parsing_strategy AS ENUM (
    'jsonld',       -- JSON-LD schema.org Event extraction (highest quality)
    'ics',          -- ICS/iCal feed parsing
    'rss',          -- RSS/Atom feed parsing
    'html_dom',     -- HTML DOM extraction with site-specific selectors
    'hybrid'        -- Try JSON-LD first, fall back to DOM
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE circuit_breaker_state AS ENUM (
    'closed',       -- Normal operation, requests allowed
    'open',         -- Tripped, requests blocked
    'half_open'     -- Testing if service recovered
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. Collector Targets table
-- ============================================================================

CREATE TABLE IF NOT EXISTS collector_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name TEXT NOT NULL UNIQUE,              -- Display name (e.g., "Clarkson Events")
  base_url TEXT NOT NULL,                 -- Base URL (e.g., "https://www.clarkson.edu")

  -- Discovery configuration
  discovery_urls TEXT[] NOT NULL DEFAULT '{}',  -- Pages to crawl (e.g., ["/events", "/calendar"])
  allowed_paths TEXT[] NOT NULL DEFAULT '{}',   -- Path prefixes allowed (e.g., ["/events/", "/calendar/"])

  -- Scheduling
  crawl_frequency_minutes INTEGER NOT NULL DEFAULT 360,  -- How often to crawl (default 6 hours)
  max_pages_per_run INTEGER NOT NULL DEFAULT 20,         -- Max pages to fetch per run

  -- Rate limiting
  rate_limit_rpm INTEGER NOT NULL DEFAULT 10,            -- Requests per minute limit
  request_delay_ms INTEGER NOT NULL DEFAULT 2000,        -- Delay between requests (ms)

  -- Parsing
  parsing_strategy parsing_strategy NOT NULL DEFAULT 'hybrid',
  dom_selectors JSONB DEFAULT '{}',       -- Site-specific CSS selectors for html_dom strategy

  -- Contact & User Agent
  contact_email TEXT NOT NULL DEFAULT 'bot@euda.app',
  user_agent TEXT GENERATED ALWAYS AS (
    'EudaBot/1.0 (+https://euda.app/bot; ' || contact_email || ')'
  ) STORED,

  -- State
  is_enabled BOOLEAN NOT NULL DEFAULT false,  -- Default disabled until explicitly enabled
  circuit_breaker circuit_breaker_state NOT NULL DEFAULT 'closed',
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  max_consecutive_errors INTEGER NOT NULL DEFAULT 3,     -- Threshold to trip circuit breaker

  -- Robots.txt cache
  robots_txt_cache TEXT,
  robots_txt_fetched_at TIMESTAMPTZ,
  robots_txt_allows_crawl BOOLEAN,

  -- Metrics
  last_run_at TIMESTAMPTZ,
  last_run_pages_fetched INTEGER DEFAULT 0,
  last_run_items_found INTEGER DEFAULT 0,
  last_run_errors INTEGER DEFAULT 0,
  total_items_collected INTEGER DEFAULT 0,

  -- Link to event_sources for normalization pipeline
  source_id UUID REFERENCES event_sources(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. Collector Page Cache table (for change detection)
-- ============================================================================

CREATE TABLE IF NOT EXISTS collector_page_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL REFERENCES collector_targets(id) ON DELETE CASCADE,

  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,                    -- SHA256 of URL for fast lookup

  -- Content cache
  content_hash TEXT NOT NULL,                -- SHA256 of content for change detection
  content_type TEXT,                         -- HTTP Content-Type header
  raw_html TEXT,                             -- Cached HTML (compressed in future)

  -- Metadata
  http_status INTEGER,
  headers_json JSONB,

  -- Extraction results (cached)
  extracted_candidates JSONB,                -- Array of extracted event candidates
  extraction_strategy parsing_strategy,      -- Which strategy succeeded
  extraction_errors TEXT[],                  -- Any parsing errors

  -- Timestamps
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(target_id, url_hash)
);

-- ============================================================================
-- 4. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_collector_targets_enabled
  ON collector_targets (is_enabled, circuit_breaker)
  WHERE is_enabled = TRUE AND circuit_breaker = 'closed';

CREATE INDEX IF NOT EXISTS idx_collector_targets_next_run
  ON collector_targets (last_run_at ASC NULLS FIRST)
  WHERE is_enabled = TRUE AND circuit_breaker = 'closed';

CREATE INDEX IF NOT EXISTS idx_collector_page_cache_target
  ON collector_page_cache (target_id);

CREATE INDEX IF NOT EXISTS idx_collector_page_cache_url
  ON collector_page_cache (url_hash);

CREATE INDEX IF NOT EXISTS idx_collector_page_cache_changed
  ON collector_page_cache (last_changed_at DESC);

-- ============================================================================
-- 5. Auto-update timestamps
-- ============================================================================

CREATE OR REPLACE TRIGGER trg_collector_targets_updated
  BEFORE UPDATE ON collector_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_collector_page_cache_updated
  BEFORE UPDATE ON collector_page_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. Functions for managing collector targets
-- ============================================================================

-- Get all enabled targets that are ready to run
CREATE OR REPLACE FUNCTION get_enabled_collector_targets()
RETURNS TABLE(
  target_id UUID,
  name TEXT,
  base_url TEXT,
  discovery_urls TEXT[],
  allowed_paths TEXT[],
  parsing_strategy parsing_strategy,
  dom_selectors JSONB,
  user_agent TEXT,
  rate_limit_rpm INTEGER,
  request_delay_ms INTEGER,
  max_pages_per_run INTEGER,
  minutes_since_last_run FLOAT8,
  crawl_frequency_minutes INTEGER,
  source_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ct.id AS target_id,
    ct.name,
    ct.base_url,
    ct.discovery_urls,
    ct.allowed_paths,
    ct.parsing_strategy,
    ct.dom_selectors,
    ct.user_agent,
    ct.rate_limit_rpm,
    ct.request_delay_ms,
    ct.max_pages_per_run,
    CASE
      WHEN ct.last_run_at IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (NOW() - ct.last_run_at)) / 60.0)::FLOAT8
      ELSE NULL
    END AS minutes_since_last_run,
    ct.crawl_frequency_minutes,
    ct.source_id
  FROM collector_targets ct
  WHERE ct.is_enabled = TRUE
    AND ct.circuit_breaker = 'closed'
    -- Only run if overdue (or never run)
    AND (
      ct.last_run_at IS NULL
      OR (NOW() - ct.last_run_at) > (ct.crawl_frequency_minutes * INTERVAL '1 minute')
    )
  ORDER BY
    ct.last_run_at ASC NULLS FIRST
  FOR UPDATE OF ct SKIP LOCKED;
END;
$$ LANGUAGE plpgsql;

-- Trip the circuit breaker for a target
CREATE OR REPLACE FUNCTION trip_circuit_breaker(
  p_target_id UUID,
  p_reason TEXT DEFAULT 'Consecutive errors exceeded threshold'
)
RETURNS VOID AS $$
BEGIN
  UPDATE collector_targets
  SET
    circuit_breaker = 'open',
    updated_at = NOW()
  WHERE id = p_target_id;

  -- Log the circuit breaker trip
  INSERT INTO pipeline_health_log (stage, source_name, status, details_json)
  SELECT
    'circuit_breaker',
    ct.name,
    'error',
    jsonb_build_object(
      'action', 'tripped',
      'reason', p_reason,
      'consecutive_errors', ct.consecutive_errors,
      'target_id', p_target_id::TEXT
    )
  FROM collector_targets ct
  WHERE ct.id = p_target_id;
END;
$$ LANGUAGE plpgsql;

-- Reset the circuit breaker (manual recovery)
CREATE OR REPLACE FUNCTION reset_circuit_breaker(p_target_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE collector_targets
  SET
    circuit_breaker = 'closed',
    consecutive_errors = 0,
    updated_at = NOW()
  WHERE id = p_target_id;

  -- Log the reset
  INSERT INTO pipeline_health_log (stage, source_name, status, details_json)
  SELECT
    'circuit_breaker',
    ct.name,
    'ok',
    jsonb_build_object(
      'action', 'reset',
      'target_id', p_target_id::TEXT
    )
  FROM collector_targets ct
  WHERE ct.id = p_target_id;
END;
$$ LANGUAGE plpgsql;

-- Update target after a run
CREATE OR REPLACE FUNCTION complete_collector_run(
  p_target_id UUID,
  p_pages_fetched INTEGER,
  p_items_found INTEGER,
  p_errors INTEGER,
  p_circuit_trip BOOLEAN DEFAULT FALSE
)
RETURNS VOID AS $$
BEGIN
  UPDATE collector_targets
  SET
    last_run_at = NOW(),
    last_run_pages_fetched = p_pages_fetched,
    last_run_items_found = p_items_found,
    last_run_errors = p_errors,
    total_items_collected = total_items_collected + p_items_found,
    consecutive_errors = CASE
      WHEN p_errors > 0 THEN consecutive_errors + 1
      ELSE 0
    END,
    circuit_breaker = CASE
      WHEN p_circuit_trip THEN 'open'::circuit_breaker_state
      ELSE circuit_breaker
    END
  WHERE id = p_target_id;
END;
$$ LANGUAGE plpgsql;

-- Check/update robots.txt cache
CREATE OR REPLACE FUNCTION update_robots_cache(
  p_target_id UUID,
  p_robots_txt TEXT,
  p_allows_crawl BOOLEAN
)
RETURNS VOID AS $$
BEGIN
  UPDATE collector_targets
  SET
    robots_txt_cache = p_robots_txt,
    robots_txt_fetched_at = NOW(),
    robots_txt_allows_crawl = p_allows_crawl
  WHERE id = p_target_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. RLS Policies
-- ============================================================================

ALTER TABLE collector_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE collector_page_cache ENABLE ROW LEVEL SECURITY;

-- Service role only (admin operations)
CREATE POLICY "service_role_collector_targets" ON collector_targets
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_collector_page_cache" ON collector_page_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 8. Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_enabled_collector_targets() TO service_role;
GRANT EXECUTE ON FUNCTION trip_circuit_breaker(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION reset_circuit_breaker(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION complete_collector_run(UUID, INTEGER, INTEGER, INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION update_robots_cache(UUID, TEXT, BOOLEAN) TO service_role;

-- ============================================================================
-- 9. Add web_collector source type enum value if not exists
-- ============================================================================

-- Note: web_community_calendar already exists from migration 038
-- Add a generic web_collector type for any web-collected source
DO $$ BEGIN
  ALTER TYPE event_source_type ADD VALUE IF NOT EXISTS 'web_collector';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- IMPORTANT: Seed data is in 045_seed_web_collector_targets.sql
-- PostgreSQL requires new enum values to be committed before use in DML.
-- ============================================================================

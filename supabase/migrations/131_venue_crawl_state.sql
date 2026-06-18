-- ============================================================================
-- Phase 5.3 — Venue Crawl State + Synthetic Source Row (131)
-- ============================================================================
-- Schema for the Google Places venue-discovery bridge. Two pieces:
--
--   1. venue_crawl_state — one row per (explore_item, distinct website_url)
--      that tracks crawl cadence, yield, error/empty backoff, and per-venue
--      LLM spending. The Phase 5.3 design doc §A defines the columns;
--      see also docs/llm_extraction_design.md §D for the backoff schedule.
--
--   2. Synthetic event_sources row — 'Auto-Discovered Venue' with
--      type='web_collector' so the existing web_collector source-adapter
--      handles normalization. Separate from the existing 'Web Collector'
--      row for observability (lets us compare yield curated-vs-auto in
--      pipeline_health / event_ingest_raw queries).
--
-- Rollback:
--   DELETE FROM event_sources WHERE name = 'Auto-Discovered Venue';
--   DROP INDEX IF EXISTS idx_venue_crawl_state_eligible;
--   DROP INDEX IF EXISTS idx_venue_crawl_state_explore_item;
--   DROP TABLE IF EXISTS venue_crawl_state CASCADE;
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. venue_crawl_state
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS venue_crawl_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Venue link. ON DELETE CASCADE: if the explore_item disappears (manual
  -- admin delete or future GC), drop its crawl state too — no orphaned rows.
  explore_item_id UUID NOT NULL REFERENCES explore_items(id) ON DELETE CASCADE,

  website_url TEXT NOT NULL,

  -- Crawl scheduling
  last_crawled_at TIMESTAMPTZ,
  next_eligible_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Yield tracking
  events_found_count INTEGER NOT NULL DEFAULT 0,         -- cumulative across all runs
  last_run_events_found INTEGER NOT NULL DEFAULT 0,
  last_event_yield_at TIMESTAMPTZ,                       -- last time a run produced >= 1 event

  -- Backoff drivers
  consecutive_empty_runs INTEGER NOT NULL DEFAULT 0,     -- resets on yield
  consecutive_errors INTEGER NOT NULL DEFAULT 0,         -- resets on success

  -- Diagnostics
  last_error TEXT,

  -- Lifecycle:
  --   pending       — freshly enqueued, never crawled
  --   active        — crawled at least once, on the normal cadence
  --   backing_off   — yielded zero events 6+ runs in a row, on extended cadence
  --   disabled      — terminal: 12+ empty runs, OR 5+ consecutive errors, OR
  --                   llm_cost_cents_total > VENUE_COST_CAP_CENTS (default 100)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'backing_off', 'disabled')),

  -- Per-venue LLM spending cap (cents, cumulative lifetime).
  -- Reaching VENUE_COST_CAP_CENTS (default 100 = $1) flips status to 'disabled'.
  llm_cost_cents_total INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A venue can have multiple URLs we track separately (rare: marketing
  -- site + ticketing site), but each (item, URL) pair is unique.
  UNIQUE (explore_item_id, website_url)
);

COMMENT ON TABLE venue_crawl_state IS
  'Phase 5.3 venue-discovery bridge: tracks per-venue crawl cadence, yield, '
  'and backoff for the auto-discovered Google Places venue path. Populated '
  'by discover-venues-to-crawl, consumed by ingest-venue-website.';

-- Hot-path index: discover/consume both filter on next_eligible_at + status.
-- Partial index excludes terminal 'disabled' rows — they never get re-checked.
CREATE INDEX IF NOT EXISTS idx_venue_crawl_state_eligible
  ON venue_crawl_state (next_eligible_at)
  WHERE status IN ('pending', 'active', 'backing_off');

-- Reverse lookup when re-enqueueing: discover-venues-to-crawl uses this to
-- skip explore_items that already have a venue_crawl_state row.
CREATE INDEX IF NOT EXISTS idx_venue_crawl_state_explore_item
  ON venue_crawl_state (explore_item_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION venue_crawl_state_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_venue_crawl_state_updated_at ON venue_crawl_state;
CREATE TRIGGER trg_venue_crawl_state_updated_at
  BEFORE UPDATE ON venue_crawl_state
  FOR EACH ROW EXECUTE FUNCTION venue_crawl_state_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- 2. Synthetic event_sources row for auto-discovered venues
-- ────────────────────────────────────────────────────────────────────────
-- Uses type='web_collector' so the existing source-adapter handles
-- normalization. The name distinguishes auto-discovered rows from
-- curated collector_targets rows in observability queries.

INSERT INTO event_sources (name, type, is_enabled)
VALUES ('Auto-Discovered Venue', 'web_collector', TRUE)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────────
-- venue_crawl_state is a service-role-only operational table; no client
-- needs to read or write it directly. Enable RLS with no policies so
-- only service_role bypass works.

ALTER TABLE venue_crawl_state ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────
-- VERIFICATION HELPER
-- ────────────────────────────────────────────────────────────────────────
-- After applying:
--   SELECT COUNT(*) FROM venue_crawl_state;
--   -- → 0 (no rows yet; discover-venues-to-crawl populates)
--
--   SELECT id, name, type, is_enabled
--     FROM event_sources WHERE name = 'Auto-Discovered Venue';
--   -- → 1 row, type=web_collector, is_enabled=true
-- ────────────────────────────────────────────────────────────────────────

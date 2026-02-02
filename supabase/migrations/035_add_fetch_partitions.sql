-- ============================================================================
-- Fetch Rotation & Partitioning
-- ============================================================================
-- Adds fetch_partitions table for geo/time partitioning of API fetches.
-- Enables rotation across sources and geographic regions to stay within
-- rate limits and spread coverage evenly.
--
-- Each source can have multiple partitions (e.g., different geo regions).
-- The fetch coordinator picks the partition with the oldest last_fetched_at.
--
-- Rollback:
--   DROP TABLE IF EXISTS fetch_partitions;
--   DROP FUNCTION IF EXISTS next_fetch_partition();
--   DROP FUNCTION IF EXISTS complete_fetch_partition(UUID, BOOLEAN, TEXT);
-- ============================================================================

-- ============================================================================
-- 1. Fetch partitions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS fetch_partitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID NOT NULL REFERENCES event_sources(id) ON DELETE CASCADE,
  partition_label TEXT NOT NULL,         -- e.g. 'potsdam-50mi', 'syracuse-30mi'
  config_json     JSONB NOT NULL,        -- Override config: {lat, lng, radius, ...}
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  priority        INTEGER NOT NULL DEFAULT 0,   -- Higher = fetch first
  last_fetched_at TIMESTAMPTZ,
  last_result     JSONB,                 -- Last fetch summary
  last_error      TEXT,
  fetch_interval_minutes INTEGER NOT NULL DEFAULT 360, -- 6 hours default
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, partition_label)
);

CREATE INDEX IF NOT EXISTS idx_fetch_partitions_source
  ON fetch_partitions (source_id);

CREATE INDEX IF NOT EXISTS idx_fetch_partitions_next
  ON fetch_partitions (is_enabled, last_fetched_at ASC NULLS FIRST)
  WHERE is_enabled = TRUE;

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER trg_fetch_partitions_updated
  BEFORE UPDATE ON fetch_partitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 2. Pick next partition to fetch (round-robin by staleness)
-- ============================================================================

CREATE OR REPLACE FUNCTION next_fetch_partition(
  p_source_type TEXT DEFAULT NULL  -- Optional: filter to specific source type
)
RETURNS TABLE(
  partition_id UUID,
  source_id UUID,
  source_name TEXT,
  source_type TEXT,
  partition_label TEXT,
  config_json JSONB,
  minutes_since_fetch FLOAT8
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    fp.id AS partition_id,
    fp.source_id,
    es.name AS source_name,
    es.type::TEXT AS source_type,
    fp.partition_label,
    -- Merge: partition config overrides source config
    COALESCE(es.config_json, '{}'::JSONB) || fp.config_json AS config_json,
    CASE
      WHEN fp.last_fetched_at IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (NOW() - fp.last_fetched_at)) / 60.0)::FLOAT8
      ELSE NULL  -- Never fetched = highest priority
    END AS minutes_since_fetch
  FROM fetch_partitions fp
  JOIN event_sources es ON es.id = fp.source_id
  WHERE fp.is_enabled = TRUE
    AND es.is_enabled = TRUE
    -- Only fetch if overdue (or never fetched)
    AND (
      fp.last_fetched_at IS NULL
      OR (NOW() - fp.last_fetched_at) > (fp.fetch_interval_minutes * INTERVAL '1 minute')
    )
    -- Back off on consecutive errors (exponential: 2^errors * interval, max 24h)
    AND (
      fp.consecutive_errors = 0
      OR (NOW() - fp.last_fetched_at) > LEAST(
        fp.fetch_interval_minutes * POWER(2, fp.consecutive_errors) * INTERVAL '1 minute',
        INTERVAL '24 hours'
      )
    )
    -- Optional source type filter
    AND (p_source_type IS NULL OR es.type::TEXT = p_source_type)
  ORDER BY
    -- Never-fetched first
    fp.last_fetched_at ASC NULLS FIRST,
    -- Then by priority (higher first)
    fp.priority DESC,
    -- Then by staleness (oldest first)
    fp.last_fetched_at ASC
  LIMIT 1
  FOR UPDATE OF fp SKIP LOCKED;  -- Prevent concurrent coordinator races
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. Complete a fetch partition (update last_fetched_at, result, errors)
-- ============================================================================

CREATE OR REPLACE FUNCTION complete_fetch_partition(
  p_partition_id UUID,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL,
  p_result JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE fetch_partitions
  SET
    last_fetched_at = NOW(),
    last_result = COALESCE(p_result, last_result),
    last_error = CASE WHEN p_success THEN NULL ELSE COALESCE(p_error, 'Unknown error') END,
    consecutive_errors = CASE WHEN p_success THEN 0 ELSE consecutive_errors + 1 END
  WHERE id = p_partition_id;

  -- Also update the source's last_fetch_at if successful
  IF p_success THEN
    UPDATE event_sources
    SET last_fetch_at = NOW()
    WHERE id = (SELECT source_id FROM fetch_partitions WHERE id = p_partition_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Seed default partitions for existing sources
-- ============================================================================

-- Ticketmaster: Potsdam area (default)
INSERT INTO fetch_partitions (source_id, partition_label, config_json, priority, fetch_interval_minutes)
SELECT id, 'potsdam-50mi',
  '{"lat": 44.6697, "lng": -74.9814, "radius": 50, "days_ahead": 90}'::JSONB,
  10, 360  -- 6 hours
FROM event_sources
WHERE name = 'Ticketmaster'
ON CONFLICT (source_id, partition_label) DO NOTHING;

-- Eventbrite: Potsdam area (default)
INSERT INTO fetch_partitions (source_id, partition_label, config_json, priority, fetch_interval_minutes)
SELECT id, 'potsdam-50mi',
  '{"lat": 44.6697, "lng": -74.9814, "radius": 50, "days_ahead": 90}'::JSONB,
  10, 360  -- 6 hours
FROM event_sources
WHERE name = 'Eventbrite'
ON CONFLICT (source_id, partition_label) DO NOTHING;

-- ============================================================================
-- 5. Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION next_fetch_partition(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_fetch_partition(UUID, BOOLEAN, TEXT, JSONB) TO service_role;

-- RLS: service_role only
ALTER TABLE fetch_partitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON fetch_partitions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

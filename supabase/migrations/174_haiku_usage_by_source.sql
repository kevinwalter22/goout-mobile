-- ============================================================================
-- Per-source Haiku cost attribution (169)
-- ============================================================================
-- The 'anthropic_haiku' counter in api_usage_counters is GLOBAL — it tells us
-- the Haiku line moved, not WHICH source (collector_targets web-collector
-- target, or auto-discovered venue-website) drove it. Before ramping
-- ingestion hard, we need per-source attribution so a single messy
-- high-churn source can be identified and fixed instead of just observed as
-- a total increase.
--
-- This is purely additive instrumentation. It does NOT touch
-- api_usage_counters, increment_api_usage, or get_api_budget — the existing
-- global anthropic_haiku counter and its monthly cap remain the backstop,
-- unchanged.
--
-- Populated by llm-extractor.ts::extractEvents() when callers pass
-- opts.sourceKey (ingest-web-collector passes 'collector:<target.name>',
-- ingest-venue-website passes 'venue:<explore_item title>'). Structured-API
-- adapters (Ticketmaster/PredictHQ/Eventbrite/Google Places) never call
-- extractEvents and so never write here.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS get_haiku_usage_by_source(DATE);
--   DROP FUNCTION IF EXISTS increment_haiku_usage_by_source(TEXT, INTEGER);
--   DROP TABLE IF EXISTS haiku_usage_by_source;
-- ============================================================================

CREATE TABLE IF NOT EXISTS haiku_usage_by_source (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL,   -- e.g. 'collector:Bethel Woods Center for the Arts', 'venue:Storm King'
  period_start DATE NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_key, period_start)
);

ALTER TABLE haiku_usage_by_source ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage haiku_usage_by_source" ON haiku_usage_by_source;
CREATE POLICY "Service role can manage haiku_usage_by_source"
  ON haiku_usage_by_source FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Hot path for the "top spending sources this month" report.
CREATE INDEX IF NOT EXISTS idx_haiku_usage_by_source_period
  ON haiku_usage_by_source (period_start, cost_cents DESC);

-- ────────────────────────────────────────────────────────────────────────
-- increment_haiku_usage_by_source: atomically adds to a source's monthly
-- cent total. Mirrors increment_api_usage's get-or-create + accumulate
-- shape, but keyed by (source_key, period_start) instead of (service,
-- period_start), and has no cap of its own — it's an observability
-- breakdown of the existing capped 'anthropic_haiku' counter, not a second
-- enforcement point.
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_haiku_usage_by_source(
  p_source_key TEXT,
  p_cost_cents INTEGER
)
RETURNS VOID AS $$
DECLARE
  v_period DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  INSERT INTO haiku_usage_by_source (source_key, period_start, cost_cents)
  VALUES (p_source_key, v_period, GREATEST(p_cost_cents, 0))
  ON CONFLICT (source_key, period_start)
  DO UPDATE SET
    cost_cents = haiku_usage_by_source.cost_cents + GREATEST(EXCLUDED.cost_cents, 0),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION increment_haiku_usage_by_source(TEXT, INTEGER) TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- get_haiku_usage_by_source: per-source Haiku spend for a given month
-- (defaults to the current month), highest spend first. Used by
-- scripts/cost_watch.mjs and ad-hoc "who's driving the Haiku line" queries.
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_haiku_usage_by_source(p_period_start DATE DEFAULT NULL)
RETURNS TABLE(
  source_key TEXT,
  period_start DATE,
  cost_cents INTEGER
) AS $$
DECLARE
  v_period DATE := COALESCE(p_period_start, date_trunc('month', CURRENT_DATE)::DATE);
BEGIN
  RETURN QUERY
  SELECT h.source_key, h.period_start, h.cost_cents
  FROM haiku_usage_by_source h
  WHERE h.period_start = v_period
  ORDER BY h.cost_cents DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_haiku_usage_by_source(DATE) TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- VERIFICATION HELPER
-- ────────────────────────────────────────────────────────────────────────
-- After applying:
--   SELECT increment_haiku_usage_by_source('collector:Test Target', 42);
--   SELECT * FROM get_haiku_usage_by_source();
--   -- → one row: source_key='collector:Test Target', cost_cents=42
--
--   SELECT * FROM get_api_budget('anthropic_haiku');
--   -- → unchanged shape/behavior; global cap unaffected by the above.
-- ────────────────────────────────────────────────────────────────────────

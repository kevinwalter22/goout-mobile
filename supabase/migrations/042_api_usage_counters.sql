-- ============================================================================
-- API Usage Counters — Internal budget guardrail (Task 4)
-- ============================================================================
-- Tracks monthly API request usage per service to enforce hard caps
-- independent of GCP quota settings. Prevents runaway costs.
--
-- Rollback:
--   DROP TABLE IF EXISTS api_usage_counters;
--   DROP FUNCTION IF EXISTS get_api_budget(TEXT);
--   DROP FUNCTION IF EXISTS increment_api_usage(TEXT, INTEGER);
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_usage_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  period_start DATE NOT NULL,
  requests_used INTEGER NOT NULL DEFAULT 0,
  requests_limit INTEGER NOT NULL DEFAULT 10000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service, period_start)
);

ALTER TABLE api_usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage api_usage_counters" ON api_usage_counters;
CREATE POLICY "Service role can manage api_usage_counters"
  ON api_usage_counters FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- get_api_budget: returns current budget status for a service
-- ============================================================================

CREATE OR REPLACE FUNCTION get_api_budget(p_service TEXT)
RETURNS TABLE(
  requests_used INTEGER,
  requests_limit INTEGER,
  requests_remaining INTEGER
) AS $$
DECLARE
  v_period DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
  -- Get-or-create counter for current month
  INSERT INTO api_usage_counters (service, period_start, requests_used, requests_limit)
  VALUES (p_service, v_period, 0, 10000)
  ON CONFLICT (service, period_start) DO NOTHING;

  RETURN QUERY
  SELECT
    c.requests_used,
    c.requests_limit,
    GREATEST(c.requests_limit - c.requests_used, 0) AS requests_remaining
  FROM api_usage_counters c
  WHERE c.service = p_service AND c.period_start = v_period;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_api_budget(TEXT) TO service_role;

-- ============================================================================
-- increment_api_usage: atomically adds to the usage counter
-- Returns TRUE if the increment was within budget, FALSE if it would exceed.
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_api_usage(
  p_service TEXT,
  p_count INTEGER DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
  v_period DATE := date_trunc('month', CURRENT_DATE)::DATE;
  v_row api_usage_counters%ROWTYPE;
BEGIN
  -- Get-or-create counter
  INSERT INTO api_usage_counters (service, period_start, requests_used, requests_limit)
  VALUES (p_service, v_period, 0, 10000)
  ON CONFLICT (service, period_start) DO NOTHING;

  -- Atomic increment + check
  UPDATE api_usage_counters
  SET requests_used = requests_used + p_count,
      updated_at = NOW()
  WHERE service = p_service AND period_start = v_period
  RETURNING * INTO v_row;

  -- Return TRUE if still within budget
  RETURN v_row.requests_used <= v_row.requests_limit;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION increment_api_usage(TEXT, INTEGER) TO service_role;

-- ============================================================================
-- Seed: default budget for Google Places (conservative 10k/month)
-- ============================================================================

INSERT INTO api_usage_counters (service, period_start, requests_used, requests_limit)
VALUES ('google_places', date_trunc('month', CURRENT_DATE)::DATE, 0, 10000)
ON CONFLICT (service, period_start) DO NOTHING;

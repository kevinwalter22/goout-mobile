-- ============================================================================
-- Pre-launch protection guardrails (110)
-- ============================================================================
-- 1. Rate-limit triggers on user-created event inserts (5/hour)
--    and content report inserts (10/hour)
-- 2. LLM daily usage tracking + budget check helpers
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_event_creation_rate ON explore_items;
--   DROP TRIGGER IF EXISTS trg_report_rate ON content_reports;
--   DROP FUNCTION IF EXISTS enforce_event_creation_rate();
--   DROP FUNCTION IF EXISTS enforce_report_rate();
--   DROP FUNCTION IF EXISTS record_llm_usage(INTEGER, INTEGER);
--   DROP FUNCTION IF EXISTS check_llm_daily_budget(INTEGER);
--   DROP TABLE IF EXISTS llm_daily_usage;
-- ============================================================================

-- ============================================================================
-- 1. Rate-limit trigger for user-created events (5 per hour)
-- ============================================================================
-- Uses the existing check_rate_limit() helper from migration 073.
-- Fires only on rows with created_by_user_id (user-created, not pipeline).

CREATE OR REPLACE FUNCTION enforce_event_creation_rate()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM check_rate_limit(NEW.created_by_user_id, 'create_event', 5, 3600);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_creation_rate ON explore_items;

CREATE TRIGGER trg_event_creation_rate
  BEFORE INSERT ON explore_items
  FOR EACH ROW
  WHEN (NEW.created_by_user_id IS NOT NULL)
  EXECUTE FUNCTION enforce_event_creation_rate();

-- ============================================================================
-- 2. Rate-limit trigger for content reports (10 per hour)
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_report_rate()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM check_rate_limit(NEW.reporter_id, 'content_report', 10, 3600);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_rate ON content_reports;

CREATE TRIGGER trg_report_rate
  BEFORE INSERT ON content_reports
  FOR EACH ROW
  EXECUTE FUNCTION enforce_report_rate();

-- ============================================================================
-- 3. LLM daily usage tracking table
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_daily_usage (
  usage_date    DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  call_count    INTEGER NOT NULL DEFAULT 0,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE llm_daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON llm_daily_usage FROM anon, authenticated;

-- ============================================================================
-- 4. record_llm_usage() — increment daily counters after each LLM call
-- ============================================================================

CREATE OR REPLACE FUNCTION record_llm_usage(
  p_input_tokens INTEGER,
  p_output_tokens INTEGER
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO llm_daily_usage (usage_date, call_count, input_tokens, output_tokens, updated_at)
  VALUES (CURRENT_DATE, 1, p_input_tokens, p_output_tokens, NOW())
  ON CONFLICT (usage_date) DO UPDATE SET
    call_count    = llm_daily_usage.call_count + 1,
    input_tokens  = llm_daily_usage.input_tokens + EXCLUDED.input_tokens,
    output_tokens = llm_daily_usage.output_tokens + EXCLUDED.output_tokens,
    updated_at    = NOW();
END;
$$;

-- ============================================================================
-- 5. check_llm_daily_budget() — returns whether the daily budget allows more
--    calls.  p_max_calls defaults to 1000 (~$6/day on haiku).
-- ============================================================================

CREATE OR REPLACE FUNCTION check_llm_daily_budget(p_max_calls INTEGER DEFAULT 1000)
RETURNS TABLE(allowed BOOLEAN, calls_today INTEGER, calls_remaining INTEGER)
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_calls INTEGER;
BEGIN
  SELECT COALESCE(ldu.call_count, 0) INTO v_calls
  FROM llm_daily_usage ldu
  WHERE ldu.usage_date = CURRENT_DATE;

  IF NOT FOUND THEN
    v_calls := 0;
  END IF;

  allowed        := v_calls < p_max_calls;
  calls_today    := v_calls;
  calls_remaining := GREATEST(p_max_calls - v_calls, 0);
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION record_llm_usage(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION check_llm_daily_budget(INTEGER) TO authenticated;

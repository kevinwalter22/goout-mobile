-- ============================================================================
-- Phase 5.2 — LLM Extraction Fallback for ingest-web-collector (129)
-- ============================================================================
-- Wires the Phase 5.1 _shared/llm-extractor.ts into the existing
-- collector_targets pipeline. When a target has use_llm_fallback=TRUE and
-- the deterministic (jsonld/ics/rss/dom) strategies yield fewer than 2
-- candidates, ingest-web-collector calls extractEvents() on the cached
-- HTML and merges the results into event_ingest_raw.
--
-- Three changes here:
--   1. ADD COLUMN use_llm_fallback BOOLEAN (default FALSE — opt-in)
--   2. Redefine get_enabled_collector_targets() RPC to include the new
--      column in its return table
--   3. Seed api_usage_counters row for service='anthropic_haiku' with a
--      $50/mo limit (counter increments are denominated in CENTS for this
--      service; the existing requests_limit/requests_used columns are
--      reused with the per-service semantic that 1 unit = 1¢)
--   4. Flip use_llm_fallback=TRUE for the 5 hand-picked Warwick targets
--      from design doc §G 5.2: Bethel Woods, Storm King, Albert Wisner,
--      Drowned Lands, Sugar Loaf PAC. is_enabled STAYS FALSE — atomic flip
--      to TRUE happens after this migration deploys and ingest-web-collector
--      is redeployed with the LLM integration code.
--
-- Rollback:
--   ALTER TABLE collector_targets DROP COLUMN IF EXISTS use_llm_fallback;
--   DELETE FROM api_usage_counters WHERE service = 'anthropic_haiku';
--   (then redeploy get_enabled_collector_targets from migration 100)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. Add the use_llm_fallback column
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE collector_targets
  ADD COLUMN IF NOT EXISTS use_llm_fallback BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN collector_targets.use_llm_fallback IS
  'Phase 5.2: when TRUE, ingest-web-collector calls the LLM extractor '
  '(supabase/functions/_shared/llm-extractor.ts) on the cached HTML after '
  'deterministic strategies if they yield < 2 candidates. Opt-in per target.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. Redefine get_enabled_collector_targets() to include use_llm_fallback
-- ────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_enabled_collector_targets();

CREATE FUNCTION get_enabled_collector_targets()
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
  source_id UUID,
  town TEXT,
  venue_name TEXT,
  default_category TEXT,
  content_types TEXT[],
  site_config JSONB,
  source_type TEXT,
  use_llm_fallback BOOLEAN
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
    ct.source_id,
    ct.town,
    ct.venue_name,
    ct.default_category,
    ct.content_types,
    ct.site_config,
    ct.source_type,
    ct.use_llm_fallback
  FROM collector_targets ct
  WHERE ct.is_enabled = TRUE
    AND ct.circuit_breaker = 'closed'
    AND (
      ct.last_run_at IS NULL
      OR (NOW() - ct.last_run_at) > (ct.crawl_frequency_minutes * INTERVAL '1 minute')
    )
  ORDER BY
    ct.last_run_at ASC NULLS FIRST
  FOR UPDATE OF ct SKIP LOCKED;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_enabled_collector_targets() TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Seed api_usage_counters for anthropic_haiku at $50/mo (5000 cents)
-- ────────────────────────────────────────────────────────────────────────
-- For service='anthropic_haiku', the counter columns are reused with
-- per-service semantic: 1 unit = 1 cent. requests_limit = 5000 ⇒ $50/mo.
-- This matches the design-doc hard cap. extractEvents() in llm-extractor.ts
-- calls increment_api_usage('anthropic_haiku', cost_cents) after each
-- successful run; ingest-web-collector calls get_api_budget('anthropic_haiku')
-- before each LLM call to enforce the cap.

INSERT INTO api_usage_counters (service, period_start, requests_used, requests_limit)
VALUES ('anthropic_haiku', date_trunc('month', CURRENT_DATE)::DATE, 0, 5000)
ON CONFLICT (service, period_start) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Enable LLM fallback for 5 hand-picked Warwick targets (design doc §G 5.2)
-- ────────────────────────────────────────────────────────────────────────
-- is_enabled STAYS FALSE. The atomic flip to TRUE is a separate operational
-- step after this migration deploys and ingest-web-collector is redeployed
-- with the LLM integration code (Phase 5.2 step 4 in Kevin's brief).
--
-- These 5 targets were chosen as the Week 0/Week 1 validation cohort because:
--   - All five have rich event content that the Phase 5.1 fixture set
--     confirmed the extractor handles well (84.4% recall, 96.8% precision)
--   - They span the structural diversity of the catalog: Wix widget
--     (Sugar Loaf PAC), Squarespace (Drowned Lands), WordPress
--     (Bethel Woods, Storm King), Modern Events Calendar plugin
--     (Albert Wisner). If integration works for these, it likely works
--     for the rest of the catalog.

UPDATE collector_targets
   SET use_llm_fallback = TRUE
 WHERE name IN (
   'Bethel Woods Center for the Arts',
   'Storm King Art Center',
   'Albert Wisner Public Library',
   'Drowned Lands Brewery',
   'Sugar Loaf Performing Arts Center'
 );

-- ────────────────────────────────────────────────────────────────────────
-- VERIFICATION HELPER
-- ────────────────────────────────────────────────────────────────────────
-- After applying:
--   SELECT name, use_llm_fallback, is_enabled, source_type, town
--     FROM collector_targets
--    WHERE use_llm_fallback = TRUE
--    ORDER BY name;
--
-- Expected: 5 rows, all use_llm_fallback=TRUE, is_enabled=FALSE.
-- ────────────────────────────────────────────────────────────────────────

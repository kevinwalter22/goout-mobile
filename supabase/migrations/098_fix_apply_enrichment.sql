-- Fix apply_enrichment: remove reference to compute_item_confidence
-- which doesn't exist. Confidence is already computed at ingestion time
-- and doesn't need to be recalculated on enrichment.

CREATE OR REPLACE FUNCTION apply_enrichment(
  p_explore_item_id UUID,
  p_hook_line TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_recurrence TEXT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL,
  p_availability_json JSONB DEFAULT NULL,
  p_price_bucket TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_time_text TEXT DEFAULT NULL,
  p_provenance JSONB DEFAULT NULL,
  p_audience_fit TEXT DEFAULT NULL,
  p_is_event_venue BOOLEAN DEFAULT NULL,
  p_enrichment_version INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE explore_items SET
    hook_line       = COALESCE(p_hook_line, hook_line),
    tags            = COALESCE(p_tags, tags),
    recurrence      = COALESCE(p_recurrence, recurrence),
    starts_at       = COALESCE(p_starts_at, starts_at),
    ends_at         = COALESCE(p_ends_at, ends_at),
    availability_json = COALESCE(p_availability_json, availability_json),
    price_bucket    = CASE
                        WHEN p_price_bucket IS NOT NULL AND p_price_bucket != 'unknown'
                        THEN p_price_bucket::price_bucket
                        ELSE price_bucket
                      END,
    description     = CASE
                        WHEN description IS NULL THEN p_description
                        ELSE description
                      END,
    time_text       = COALESCE(p_time_text, time_text),
    provenance      = COALESCE(p_provenance, provenance),
    audience_fit    = CASE
                        WHEN p_audience_fit IS NOT NULL AND p_audience_fit != 'unknown'
                        THEN p_audience_fit::audience_fit_type
                        ELSE audience_fit
                      END,
    is_event_venue  = COALESCE(p_is_event_venue, is_event_venue),
    enrichment_version = COALESCE(p_enrichment_version, enrichment_version),
    llm_enriched_at = NOW(),
    updated_at      = NOW()
  WHERE id = p_explore_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN, INTEGER) TO authenticated;

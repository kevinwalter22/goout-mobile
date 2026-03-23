-- ============================================================================
-- Enrichment Classification Upgrade (097)
-- ============================================================================
-- Adds structured classification fields for audience fit, event venue
-- detection, and enrichment versioning. These power the relevance ranking
-- so the explore feed shows "real things young people do" instead of
-- random POIs.
--
-- Fields:
--   audience_fit   — who is this for? (youth_general, family, business, tourist, unknown)
--   is_event_venue — does this place host events? (bars with live music, theaters, etc.)
--   enrichment_version — tracks which prompt version produced the classification
-- ============================================================================

-- 1. Create audience_fit enum
DO $$ BEGIN
  CREATE TYPE audience_fit_type AS ENUM (
    'youth_general',   -- Broadly appealing to 18-35 (bars, restaurants, parks, concerts)
    'family',          -- Family-oriented (kid-friendly museums, playgrounds, family restaurants)
    'business',        -- Business/professional (conference centers, co-working, business hotels)
    'tourist',         -- Primarily tourist attractions (souvenir shops, tour buses, tourist traps)
    'niche',           -- Niche interest (very specific hobby shops, specialty services)
    'unknown'          -- Cannot determine from available data
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add new columns
ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS audience_fit audience_fit_type NOT NULL DEFAULT 'unknown';

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS is_event_venue BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS enrichment_version INTEGER NOT NULL DEFAULT 0;

-- 3. Index for audience_fit filtering (fast exclusion of business/tourist)
CREATE INDEX IF NOT EXISTS idx_explore_items_audience_fit
  ON explore_items(audience_fit)
  WHERE audience_fit NOT IN ('unknown', 'youth_general');

-- 4. Backfill: Infer audience_fit from existing data where possible
-- Nightlife/bars → youth_general
UPDATE explore_items
SET audience_fit = 'youth_general'
WHERE audience_fit = 'unknown'
  AND deleted_at IS NULL
  AND (
    category = 'Nightlife'
    OR sub_category IN ('bar', 'pub', 'nightclub', 'lounge', 'club')
    OR 'nightlife' = ANY(tags)
    OR 'adults_only' = ANY(tags)
    OR 'bar' = ANY(tags)
    OR 'brewery' = ANY(tags)
    OR 'live_music' = ANY(tags)
    OR 'concert' = ANY(tags)
  );

-- Family-oriented items
UPDATE explore_items
SET audience_fit = 'family'
WHERE audience_fit = 'unknown'
  AND deleted_at IS NULL
  AND (
    'family_friendly' = ANY(tags)
    OR 'kids' = ANY(tags)
    OR sub_category IN ('playground', 'children museum', 'family restaurant', 'amusement park')
  );

-- Tourist traps
UPDATE explore_items
SET audience_fit = 'tourist'
WHERE audience_fit = 'unknown'
  AND deleted_at IS NULL
  AND sub_category IN ('tourist attraction', 'souvenir shop', 'tour operator', 'visitor center');

-- Backfill is_event_venue from tags and sub_categories
UPDATE explore_items
SET is_event_venue = TRUE
WHERE deleted_at IS NULL
  AND is_event_venue = FALSE
  AND (
    sub_category IN ('event venue', 'concert hall', 'amphitheater', 'theater',
                     'performing arts theater', 'comedy club', 'music venue',
                     'nightclub', 'bar', 'pub', 'lounge')
    OR 'live_music' = ANY(tags)
    OR 'concert' = ANY(tags)
    OR 'theater' = ANY(tags)
    OR category = 'Nightlife'
  );

-- 5. Update apply_enrichment to accept new fields
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
    updated_at      = NOW(),
    normalized_confidence = compute_item_confidence(
      COALESCE(p_provenance, provenance),
      (SELECT es.type FROM event_sources es WHERE es.id = source_id)
    )
  WHERE id = p_explore_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN, INTEGER) TO authenticated;

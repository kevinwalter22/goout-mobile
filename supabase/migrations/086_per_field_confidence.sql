-- ============================================================================
-- Migration 086: Per-Field Confidence + Validation
-- ============================================================================
-- 1. source_type_base_confidence() — source reliability lookup
-- 2. bootstrap_provenance() — backfill provenance for existing items
-- 3. compute_item_confidence() — upgraded weighted per-field formula
-- 4. apply_enrichment() — upgraded with p_provenance parameter
-- 5. claim_enrichment_job() — add item_provenance to return
-- 6. merge_duplicate_fields() — cross-source field merging
-- 7. mark_duplicates() — upgraded with merge phase
-- 8. quality_audit() — data quality report
-- 9. Run backfill
-- ============================================================================


-- ============================================================================
-- 1. Source reliability function
-- ============================================================================

CREATE OR REPLACE FUNCTION source_type_base_confidence(p_source_type TEXT)
RETURNS NUMERIC AS $$
  SELECT CASE p_source_type
    WHEN 'api_google_places'      THEN 0.95
    WHEN 'api_ticketmaster'       THEN 0.90
    WHEN 'api_eventbrite'         THEN 0.88
    WHEN 'curated_csv'            THEN 0.85
    WHEN 'web_community_calendar' THEN 0.60
    WHEN 'web_collector'          THEN 0.55
    WHEN 'manual'                 THEN 0.50
    ELSE 0.50
  END;
$$ LANGUAGE sql IMMUTABLE;


-- ============================================================================
-- 2. Bootstrap provenance for existing items
-- ============================================================================

CREATE OR REPLACE FUNCTION bootstrap_provenance()
RETURNS TABLE(items_updated INTEGER) AS $$
DECLARE
  v_count INTEGER := 0;
  v_item RECORD;
  v_source_type TEXT;
  v_base_conf NUMERIC;
  v_prov JSONB;
  v_fields JSONB;
  v_method TEXT;
  v_set_at TEXT;
BEGIN
  FOR v_item IN
    SELECT e.*, es.type::TEXT AS src_type
    FROM explore_items e
    LEFT JOIN event_sources es ON e.source_id = es.id
    WHERE e.priority >= 0
      AND NOT e.is_duplicate
  LOOP
    v_source_type := COALESCE(v_item.src_type, 'manual');
    v_base_conf := source_type_base_confidence(v_source_type);
    v_set_at := COALESCE(v_item.created_at::TEXT, NOW()::TEXT);

    -- Determine extraction method from source type
    v_method := CASE
      WHEN v_source_type LIKE 'api_%' THEN 'api_direct'
      WHEN v_source_type LIKE 'web_%' THEN 'web_scrape'
      WHEN v_source_type = 'curated_csv' THEN 'csv_import'
      ELSE 'manual'
    END;

    v_fields := '{}'::JSONB;

    -- Title (always present)
    IF v_item.title IS NOT NULL AND LENGTH(v_item.title) > 0 THEN
      v_fields := v_fields || jsonb_build_object('title', jsonb_build_object(
        'confidence', v_base_conf,
        'source_type', v_source_type,
        'set_at', v_set_at,
        'method', v_method
      ));
    END IF;

    -- Description
    IF v_item.description IS NOT NULL AND LENGTH(v_item.description) > 0 THEN
      -- If AI-enriched and description was likely set by AI
      IF v_item.llm_enriched_at IS NOT NULL AND v_item.description IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object('description', jsonb_build_object(
          'confidence', GREATEST(0.65, v_base_conf),
          'source_type', CASE WHEN v_base_conf >= 0.85 THEN v_source_type ELSE 'ai_enrichment' END,
          'set_at', COALESCE(v_item.llm_enriched_at::TEXT, v_set_at),
          'method', CASE WHEN v_base_conf >= 0.85 THEN v_method ELSE 'ai_inferred' END
        ));
      ELSE
        v_fields := v_fields || jsonb_build_object('description', jsonb_build_object(
          'confidence', v_base_conf,
          'source_type', v_source_type,
          'set_at', v_set_at,
          'method', v_method
        ));
      END IF;
    END IF;

    -- Category
    IF v_item.category IS NOT NULL AND v_item.category != '' THEN
      v_fields := v_fields || jsonb_build_object('category', jsonb_build_object(
        'confidence', v_base_conf * 0.9,
        'source_type', v_source_type,
        'set_at', v_set_at,
        'method', v_method
      ));
    END IF;

    -- Hook line (almost always AI-generated)
    IF v_item.hook_line IS NOT NULL AND LENGTH(v_item.hook_line) >= 10 THEN
      v_fields := v_fields || jsonb_build_object('hook_line', jsonb_build_object(
        'confidence', 0.70,
        'source_type', 'ai_enrichment',
        'set_at', COALESCE(v_item.llm_enriched_at::TEXT, v_set_at),
        'method', 'ai_inferred'
      ));
    END IF;

    -- Tags (AI-enriched)
    IF v_item.tags IS NOT NULL AND array_length(v_item.tags, 1) > 0 THEN
      v_fields := v_fields || jsonb_build_object('tags', jsonb_build_object(
        'confidence', CASE
          WHEN array_length(v_item.tags, 1) >= 5 THEN 0.75
          ELSE 0.60
        END,
        'source_type', 'ai_enrichment',
        'set_at', COALESCE(v_item.llm_enriched_at::TEXT, v_set_at),
        'method', 'ai_inferred'
      ));
    END IF;

    -- Price bucket
    IF v_item.price_bucket IS NOT NULL AND v_item.price_bucket::TEXT != 'unknown' THEN
      v_fields := v_fields || jsonb_build_object('price_bucket', jsonb_build_object(
        'confidence', CASE
          WHEN v_source_type LIKE 'api_%' THEN v_base_conf
          ELSE 0.60
        END,
        'source_type', CASE
          WHEN v_source_type LIKE 'api_%' THEN v_source_type
          ELSE 'ai_enrichment'
        END,
        'set_at', v_set_at,
        'method', CASE
          WHEN v_source_type LIKE 'api_%' THEN 'api_direct'
          ELSE 'ai_inferred'
        END
      ));
    END IF;

    -- Availability JSON
    IF v_item.availability_json IS NOT NULL THEN
      v_fields := v_fields || jsonb_build_object('availability_json', jsonb_build_object(
        'confidence', COALESCE(
          (v_item.availability_json ->> 'confidence')::NUMERIC / 100.0,
          0.65
        ),
        'source_type', COALESCE(v_item.availability_json ->> 'source', 'ai_enrichment'),
        'set_at', COALESCE(v_item.llm_enriched_at::TEXT, v_set_at),
        'method', 'ai_inferred'
      ));
    END IF;

    -- Lat/Lng
    IF v_item.lat IS NOT NULL AND v_item.lng IS NOT NULL THEN
      v_fields := v_fields || jsonb_build_object('lat', jsonb_build_object(
        'confidence', v_base_conf,
        'source_type', v_source_type,
        'set_at', v_set_at,
        'method', v_method
      ));
    END IF;

    -- Location name
    IF v_item.location_name IS NOT NULL AND LENGTH(v_item.location_name) > 0 THEN
      v_fields := v_fields || jsonb_build_object('location_name', jsonb_build_object(
        'confidence', v_base_conf,
        'source_type', v_source_type,
        'set_at', v_set_at,
        'method', v_method
      ));
    END IF;

    -- Build provenance, preserving any existing legacy fields
    v_prov := jsonb_build_object(
      'schema_version', 2,
      'fields', v_fields,
      'confirmations', '[]'::JSONB
    );

    -- Merge with existing provenance if present (preserve web collector data)
    IF v_item.provenance IS NOT NULL THEN
      v_prov := v_prov || jsonb_build_object(
        'source_url', v_item.provenance ->> 'source_url',
        'extraction_method', v_item.provenance ->> 'extraction_method',
        'target_name', v_item.provenance ->> 'target_name',
        'collected_at', v_item.provenance ->> 'collected_at'
      );
    END IF;

    UPDATE explore_items
    SET provenance = v_prov,
        updated_at = NOW()
    WHERE id = v_item.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 3. Upgraded compute_item_confidence — weighted per-field average
-- ============================================================================

CREATE OR REPLACE FUNCTION compute_item_confidence(p_item_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_item explore_items%ROWTYPE;
  v_fields JSONB;
  v_score NUMERIC := 0;

  -- Field weights (sum to 100)
  w_title     CONSTANT NUMERIC := 15;
  w_category  CONSTANT NUMERIC := 12;
  w_tags      CONSTANT NUMERIC := 15;
  w_price     CONSTANT NUMERIC := 10;
  w_avail     CONSTANT NUMERIC := 12;
  w_latlng    CONSTANT NUMERIC := 15;
  w_hookline  CONSTANT NUMERIC := 8;
  w_desc      CONSTANT NUMERIC := 5;
  w_location  CONSTANT NUMERIC := 8;

  v_conf NUMERIC;
  v_bonus NUMERIC := 0;
BEGIN
  SELECT * INTO v_item FROM explore_items WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_fields := COALESCE(v_item.provenance -> 'fields', '{}'::JSONB);

  -- Title
  v_conf := COALESCE(
    (v_fields -> 'title' ->> 'confidence')::NUMERIC,
    CASE WHEN v_item.title IS NOT NULL AND LENGTH(v_item.title) > 3 THEN 0.70 ELSE 0.0 END
  );
  v_score := v_score + (v_conf * w_title);

  -- Category
  v_conf := COALESCE(
    (v_fields -> 'category' ->> 'confidence')::NUMERIC,
    CASE WHEN v_item.category IS NOT NULL AND v_item.category != '' THEN 0.60 ELSE 0.0 END
  );
  v_score := v_score + (v_conf * w_category);

  -- Tags
  v_conf := COALESCE(
    (v_fields -> 'tags' ->> 'confidence')::NUMERIC,
    CASE
      WHEN v_item.tags IS NOT NULL AND array_length(v_item.tags, 1) >= 5 THEN 0.70
      WHEN v_item.tags IS NOT NULL AND array_length(v_item.tags, 1) >= 1 THEN 0.40
      ELSE 0.0
    END
  );
  v_score := v_score + (v_conf * w_tags);

  -- Price bucket
  v_conf := COALESCE(
    (v_fields -> 'price_bucket' ->> 'confidence')::NUMERIC,
    CASE WHEN v_item.price_bucket IS NOT NULL AND v_item.price_bucket::TEXT != 'unknown' THEN 0.60 ELSE 0.0 END
  );
  v_score := v_score + (v_conf * w_price);

  -- Availability
  v_conf := COALESCE(
    (v_fields -> 'availability_json' ->> 'confidence')::NUMERIC,
    CASE WHEN v_item.availability_json IS NOT NULL THEN 0.65 ELSE 0.0 END
  );
  v_score := v_score + (v_conf * w_avail);

  -- Lat/Lng (combined)
  v_conf := COALESCE(
    (v_fields -> 'lat' ->> 'confidence')::NUMERIC,
    CASE WHEN v_item.lat IS NOT NULL AND v_item.lng IS NOT NULL THEN 0.85 ELSE 0.0 END
  );
  v_score := v_score + (v_conf * w_latlng);

  -- Hook line
  v_conf := COALESCE(
    (v_fields -> 'hook_line' ->> 'confidence')::NUMERIC,
    CASE WHEN v_item.hook_line IS NOT NULL AND LENGTH(v_item.hook_line) >= 10 THEN 0.65 ELSE 0.0 END
  );
  v_score := v_score + (v_conf * w_hookline);

  -- Description
  v_conf := COALESCE(
    (v_fields -> 'description' ->> 'confidence')::NUMERIC,
    CASE WHEN v_item.description IS NOT NULL AND LENGTH(v_item.description) > 20 THEN 0.60 ELSE 0.0 END
  );
  v_score := v_score + (v_conf * w_desc);

  -- Location name
  v_conf := COALESCE(
    (v_fields -> 'location_name' ->> 'confidence')::NUMERIC,
    CASE WHEN v_item.location_name IS NOT NULL THEN 0.70 ELSE 0.0 END
  );
  v_score := v_score + (v_conf * w_location);

  -- Cross-source confirmation bonus (max +5)
  IF v_item.provenance ? 'confirmations'
     AND jsonb_typeof(v_item.provenance -> 'confirmations') = 'array' THEN
    v_bonus := LEAST(jsonb_array_length(v_item.provenance -> 'confirmations') * 1.5, 5);
  END IF;

  RETURN GREATEST(0, LEAST(100, ROUND(v_score + v_bonus)::INTEGER));
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION compute_item_confidence(UUID) TO authenticated;


-- ============================================================================
-- 4. Upgraded apply_enrichment with p_provenance
-- ============================================================================

-- Drop old signature first (10 params)
DROP FUNCTION IF EXISTS apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, price_bucket, TEXT, TEXT);

CREATE OR REPLACE FUNCTION apply_enrichment(
  p_explore_item_id UUID,
  p_hook_line TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_recurrence TEXT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL,
  p_availability_json JSONB DEFAULT NULL,
  p_price_bucket price_bucket DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_time_text TEXT DEFAULT NULL,
  p_provenance JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE explore_items
  SET
    hook_line = COALESCE(p_hook_line, hook_line),
    tags = COALESCE(p_tags, tags),
    recurrence = COALESCE(p_recurrence, recurrence),
    starts_at = COALESCE(p_starts_at, starts_at),
    ends_at = COALESCE(p_ends_at, ends_at),
    availability_json = COALESCE(p_availability_json, availability_json),
    price_bucket = COALESCE(p_price_bucket, price_bucket),
    description = CASE
      WHEN description IS NULL THEN COALESCE(p_description, description)
      ELSE description
    END,
    time_text = COALESCE(p_time_text, time_text),
    provenance = COALESCE(p_provenance, provenance),
    llm_enriched_at = NOW(),
    updated_at = NOW()
  WHERE id = p_explore_item_id;

  -- Recompute confidence with provenance-aware formula
  UPDATE explore_items
  SET normalized_confidence = compute_item_confidence(p_explore_item_id)
  WHERE id = p_explore_item_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, price_bucket, TEXT, TEXT, JSONB) TO service_role;


-- ============================================================================
-- 5. Upgrade claim_enrichment_job to include provenance
-- ============================================================================

DROP FUNCTION IF EXISTS claim_enrichment_job();

CREATE OR REPLACE FUNCTION claim_enrichment_job()
RETURNS TABLE(
  job_id UUID,
  explore_item_id UUID,
  item_title TEXT,
  item_description TEXT,
  item_hook_line TEXT,
  item_category TEXT,
  item_schedule_text TEXT,
  item_time_text TEXT,
  item_recurrence TEXT,
  item_season TEXT,
  item_tags TEXT[],
  item_availability_json JSONB,
  item_price_bucket price_bucket,
  item_location_name TEXT,
  item_town TEXT,
  item_kind TEXT,
  item_provenance JSONB
) AS $$
DECLARE
  v_job_id UUID;
  v_explore_item_id UUID;
BEGIN
  UPDATE enrichment_queue
  SET status = 'running',
      started_at = NOW(),
      attempts = attempts + 1,
      updated_at = NOW()
  WHERE id = (
    SELECT id FROM enrichment_queue
    WHERE status = 'queued'
      AND attempts < max_attempts
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, enrichment_queue.explore_item_id INTO v_job_id, v_explore_item_id;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_job_id,
    e.id,
    e.title,
    e.description,
    e.hook_line,
    e.category,
    e.schedule_text,
    e.time_text,
    e.recurrence,
    e.season,
    e.tags,
    e.availability_json,
    e.price_bucket,
    e.location_name,
    e.town,
    e.kind::TEXT,
    e.provenance
  FROM explore_items e
  WHERE e.id = v_explore_item_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION claim_enrichment_job() TO service_role;


-- ============================================================================
-- 6. Cross-source field merging
-- ============================================================================

CREATE OR REPLACE FUNCTION merge_duplicate_fields()
RETURNS TABLE(groups_merged INTEGER, fields_upgraded INTEGER) AS $$
DECLARE
  v_groups INTEGER := 0;
  v_fields_upgraded INTEGER := 0;
  v_group RECORD;
  v_canonical RECORD;
  v_dup RECORD;
  v_canonical_prov JSONB;
  v_canonical_fields JSONB;
  v_dup_fields JSONB;
  v_canonical_conf NUMERIC;
  v_dup_conf NUMERIC;
  v_confirmations JSONB;
BEGIN
  FOR v_group IN
    SELECT DISTINCT canonical_item_id AS canonical_id
    FROM explore_items
    WHERE is_duplicate = TRUE
      AND canonical_item_id IS NOT NULL
  LOOP
    v_groups := v_groups + 1;

    SELECT * INTO v_canonical FROM explore_items WHERE id = v_group.canonical_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_canonical_prov := COALESCE(v_canonical.provenance, '{"schema_version":2,"fields":{},"confirmations":[]}'::JSONB);
    v_canonical_fields := COALESCE(v_canonical_prov -> 'fields', '{}'::JSONB);
    v_confirmations := COALESCE(v_canonical_prov -> 'confirmations', '[]'::JSONB);

    FOR v_dup IN
      SELECT * FROM explore_items
      WHERE canonical_item_id = v_group.canonical_id
        AND is_duplicate = TRUE
      ORDER BY COALESCE(normalized_confidence, 0) DESC
    LOOP
      v_dup_fields := COALESCE(v_dup.provenance -> 'fields', '{}'::JSONB);

      -- Lat/Lng: upgrade if duplicate has coordinates and higher confidence
      v_canonical_conf := COALESCE((v_canonical_fields -> 'lat' ->> 'confidence')::NUMERIC, 0);
      v_dup_conf := COALESCE((v_dup_fields -> 'lat' ->> 'confidence')::NUMERIC, 0);
      IF v_dup.lat IS NOT NULL AND v_dup.lng IS NOT NULL
         AND v_dup_conf > v_canonical_conf + 0.10 THEN
        UPDATE explore_items SET lat = v_dup.lat, lng = v_dup.lng WHERE id = v_group.canonical_id;
        v_canonical_fields := v_canonical_fields || jsonb_build_object('lat', v_dup_fields -> 'lat');
        v_confirmations := v_confirmations || jsonb_build_object(
          'field', 'lat',
          'confirmed_by', jsonb_build_array(v_dup_fields -> 'lat' ->> 'source_type'),
          'confirmed_at', NOW()
        );
        v_fields_upgraded := v_fields_upgraded + 1;
      END IF;

      -- Location name
      v_canonical_conf := COALESCE((v_canonical_fields -> 'location_name' ->> 'confidence')::NUMERIC, 0);
      v_dup_conf := COALESCE((v_dup_fields -> 'location_name' ->> 'confidence')::NUMERIC, 0);
      IF v_dup.location_name IS NOT NULL AND LENGTH(v_dup.location_name) > 0
         AND v_dup_conf > v_canonical_conf + 0.10 THEN
        UPDATE explore_items SET location_name = v_dup.location_name WHERE id = v_group.canonical_id;
        v_canonical_fields := v_canonical_fields || jsonb_build_object('location_name', v_dup_fields -> 'location_name');
        v_fields_upgraded := v_fields_upgraded + 1;
      END IF;

      -- Address
      v_canonical_conf := COALESCE((v_canonical_fields -> 'address' ->> 'confidence')::NUMERIC, 0);
      v_dup_conf := COALESCE((v_dup_fields -> 'address' ->> 'confidence')::NUMERIC, 0);
      IF v_dup.address IS NOT NULL AND LENGTH(v_dup.address) > 0
         AND (v_canonical.address IS NULL OR v_dup_conf > v_canonical_conf + 0.10) THEN
        UPDATE explore_items SET address = v_dup.address WHERE id = v_group.canonical_id;
        v_canonical_fields := v_canonical_fields || jsonb_build_object('address', v_dup_fields -> 'address');
        v_fields_upgraded := v_fields_upgraded + 1;
      END IF;

      -- Description (only if canonical is NULL or very short)
      v_canonical_conf := COALESCE((v_canonical_fields -> 'description' ->> 'confidence')::NUMERIC, 0);
      v_dup_conf := COALESCE((v_dup_fields -> 'description' ->> 'confidence')::NUMERIC, 0);
      IF v_dup.description IS NOT NULL AND LENGTH(v_dup.description) > 20
         AND (v_canonical.description IS NULL OR LENGTH(v_canonical.description) < 20)
         AND v_dup_conf > v_canonical_conf + 0.10 THEN
        UPDATE explore_items SET description = v_dup.description WHERE id = v_group.canonical_id;
        v_canonical_fields := v_canonical_fields || jsonb_build_object('description', v_dup_fields -> 'description');
        v_fields_upgraded := v_fields_upgraded + 1;
      END IF;

      -- Image (fill if canonical has none)
      IF v_dup.image_url IS NOT NULL AND v_canonical.image_url IS NULL THEN
        UPDATE explore_items
        SET image_url = v_dup.image_url,
            image_thumb_url = v_dup.image_thumb_url
        WHERE id = v_group.canonical_id;
        v_fields_upgraded := v_fields_upgraded + 1;
      END IF;

    END LOOP;

    -- Write back merged provenance
    v_canonical_prov := jsonb_build_object(
      'schema_version', 2,
      'fields', v_canonical_fields,
      'confirmations', v_confirmations
    );
    -- Preserve legacy keys
    IF v_canonical.provenance IS NOT NULL THEN
      IF v_canonical.provenance ? 'source_url' THEN
        v_canonical_prov := v_canonical_prov || jsonb_build_object('source_url', v_canonical.provenance ->> 'source_url');
      END IF;
      IF v_canonical.provenance ? 'target_name' THEN
        v_canonical_prov := v_canonical_prov || jsonb_build_object('target_name', v_canonical.provenance ->> 'target_name');
      END IF;
    END IF;

    UPDATE explore_items
    SET provenance = v_canonical_prov,
        updated_at = NOW()
    WHERE id = v_group.canonical_id;

  END LOOP;

  RETURN QUERY SELECT v_groups, v_fields_upgraded;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION merge_duplicate_fields() TO service_role;


-- ============================================================================
-- 7. Upgrade mark_duplicates to include merge phase
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_duplicates()
RETURNS TABLE(groups_found INTEGER, items_marked INTEGER) AS $$
DECLARE
  v_groups INTEGER := 0;
  v_marked INTEGER := 0;
  v_group RECORD;
  v_canonical_id UUID;
  v_fuzzy_result RECORD;
  v_merge_result RECORD;
BEGIN
  -- Reset all duplicate flags first
  UPDATE explore_items SET is_duplicate = FALSE, canonical_item_id = NULL
  WHERE is_duplicate = TRUE;

  -- Phase 1: Exact dedup (by dedupe_key)
  FOR v_group IN
    SELECT dedupe_key, COUNT(*) AS cnt
    FROM explore_items
    WHERE dedupe_key IS NOT NULL
      AND dedupe_key != ''
      AND priority >= 0
    GROUP BY dedupe_key
    HAVING COUNT(*) > 1
  LOOP
    v_groups := v_groups + 1;

    SELECT id INTO v_canonical_id
    FROM explore_items
    WHERE dedupe_key = v_group.dedupe_key
      AND priority >= 0
    ORDER BY
      COALESCE(normalized_confidence, 0) DESC,
      priority DESC,
      created_at ASC
    LIMIT 1;

    UPDATE explore_items
    SET is_duplicate = TRUE, canonical_item_id = v_canonical_id
    WHERE dedupe_key = v_group.dedupe_key
      AND id != v_canonical_id
      AND priority >= 0;

    v_marked := v_marked + (v_group.cnt - 1);
  END LOOP;

  -- Phase 2: Fuzzy dedup
  SELECT * INTO v_fuzzy_result FROM mark_fuzzy_duplicates();
  v_groups := v_groups + v_fuzzy_result.pairs_found;
  v_marked := v_marked + v_fuzzy_result.items_marked;

  -- Phase 3: Cross-source field merging
  SELECT * INTO v_merge_result FROM merge_duplicate_fields();

  RETURN QUERY SELECT v_groups, v_marked;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 8. Quality audit RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION quality_audit(
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_low_confidence JSONB;
  v_missing_critical JSONB;
  v_source_quality JSONB;
BEGIN
  -- Low confidence items
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::JSONB), '[]'::JSONB) INTO v_low_confidence
  FROM (
    SELECT id, title, normalized_confidence,
           provenance -> 'fields' AS field_confidences
    FROM explore_items
    WHERE priority >= 0 AND NOT is_duplicate
      AND normalized_confidence IS NOT NULL
    ORDER BY normalized_confidence ASC
    LIMIT p_limit
  ) sub;

  -- Missing critical fields
  SELECT jsonb_build_object(
    'missing_lat_lng', (
      SELECT COUNT(*) FROM explore_items
      WHERE priority >= 0 AND NOT is_duplicate
        AND (lat IS NULL OR lng IS NULL)
    ),
    'missing_category', (
      SELECT COUNT(*) FROM explore_items
      WHERE priority >= 0 AND NOT is_duplicate
        AND (category IS NULL OR category = '')
    ),
    'few_tags', (
      SELECT COUNT(*) FROM explore_items
      WHERE priority >= 0 AND NOT is_duplicate
        AND (tags IS NULL OR array_length(tags, 1) IS NULL OR array_length(tags, 1) < 3)
    ),
    'missing_availability', (
      SELECT COUNT(*) FROM explore_items
      WHERE priority >= 0 AND NOT is_duplicate
        AND availability_json IS NULL
    ),
    'unknown_price', (
      SELECT COUNT(*) FROM explore_items
      WHERE priority >= 0 AND NOT is_duplicate
        AND (price_bucket IS NULL OR price_bucket::TEXT = 'unknown')
    ),
    'no_provenance', (
      SELECT COUNT(*) FROM explore_items
      WHERE priority >= 0 AND NOT is_duplicate
        AND provenance IS NULL
    ),
    'no_image', (
      SELECT COUNT(*) FROM explore_items
      WHERE priority >= 0 AND NOT is_duplicate
        AND image_url IS NULL
    )
  ) INTO v_missing_critical;

  -- Per-source quality
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::JSONB), '[]'::JSONB) INTO v_source_quality
  FROM (
    SELECT
      es.name AS source_name,
      es.type::TEXT AS source_type,
      COUNT(*) AS total_items,
      ROUND(AVG(ei.normalized_confidence)) AS avg_confidence,
      COUNT(*) FILTER (WHERE ei.normalized_confidence >= 70) AS high_quality,
      COUNT(*) FILTER (WHERE ei.normalized_confidence >= 40 AND ei.normalized_confidence < 70) AS medium_quality,
      COUNT(*) FILTER (WHERE ei.normalized_confidence < 40 OR ei.normalized_confidence IS NULL) AS low_quality,
      COUNT(*) FILTER (WHERE ei.provenance IS NOT NULL) AS has_provenance,
      COUNT(*) FILTER (WHERE ei.tags IS NOT NULL AND array_length(ei.tags, 1) >= 5) AS good_tags,
      COUNT(*) FILTER (WHERE ei.image_url IS NOT NULL) AS has_image
    FROM explore_items ei
    JOIN event_sources es ON ei.source_id = es.id
    WHERE ei.priority >= 0 AND NOT ei.is_duplicate
    GROUP BY es.name, es.type
    ORDER BY avg_confidence ASC
  ) sub;

  v_result := jsonb_build_object(
    'audit_at', NOW(),
    'summary', jsonb_build_object(
      'total_active', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate),
      'avg_confidence', (SELECT ROUND(AVG(normalized_confidence)) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate AND normalized_confidence IS NOT NULL),
      'with_provenance', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate AND provenance IS NOT NULL),
      'without_provenance', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate AND provenance IS NULL)
    ),
    'missing_critical_fields', v_missing_critical,
    'source_quality', v_source_quality,
    'low_confidence_items', v_low_confidence
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION quality_audit(INTEGER) TO authenticated;


-- ============================================================================
-- 9. Run backfill
-- ============================================================================

-- Populate provenance for all existing items
SELECT * FROM bootstrap_provenance();

-- Recompute confidence with the new weighted formula
UPDATE explore_items
SET normalized_confidence = compute_item_confidence(id)
WHERE priority >= 0;

-- Run dedup with the new merge phase
SELECT * FROM mark_duplicates();

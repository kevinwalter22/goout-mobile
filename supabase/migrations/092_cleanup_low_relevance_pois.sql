-- ============================================================================
-- Cleanup Low-Relevance POIs (092)
-- ============================================================================
-- Soft-delete items that slipped through earlier ingestion filters.
-- These are businesses not appropriate for a "go out" discovery app.
--
-- Complements migration 089 with additional patterns for hotels, automotive,
-- personal services, and other non-discovery POIs.
-- ============================================================================

-- Hotels / lodging / motels
UPDATE explore_items SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    title ~* '\y(hotel|motel|hostel)\y'
    OR title ~* '\y(resort|suites?|lodge)\y'
    OR sub_category IN ('lodging', 'hotel', 'motel', 'extended stay hotel')
  );

-- Automotive
UPDATE explore_items SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    title ~* '(car.wash|car.repair|auto.body|car.dealer|tire.shop)'
    OR title ~* '(oil.change|muffler|transmission)'
    OR sub_category IN ('car wash', 'car repair', 'car dealer', 'gas station')
  );

-- Gas stations & convenience stores
UPDATE explore_items SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    title ~* '(gas.station)'
    OR sub_category IN ('gas station', 'convenience store', 'electric vehicle charging station')
  );

-- Personal services
UPDATE explore_items SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    title ~* '(hair.salon|beauty.salon|nail.salon|\ybarber)'
    OR title ~* '(dry.clean|laundromat|\ylaundry\y)'
    OR sub_category IN ('hair salon', 'beauty salon', 'laundry', 'dry cleaner')
  );

-- Medical / professional that 089 might have missed
UPDATE explore_items SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    title ~* '(pharmacy|veterinar|chiropract|optometrist)'
    OR title ~* '(real.estate|\yrealty\y)'
    OR sub_category IN ('pharmacy', 'drugstore', 'veterinary care', 'real estate agency')
  );

-- Schools / postal / hardware
UPDATE explore_items SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    title ~* '(post.office|\yups\y.store|fedex)'
    OR title ~* '(hardware.store|lumber)'
    OR title ~* '(\yschool\y|preschool|daycare)'
    OR sub_category IN ('school', 'preschool', 'primary school', 'secondary school',
                         'post office', 'hardware store')
  );

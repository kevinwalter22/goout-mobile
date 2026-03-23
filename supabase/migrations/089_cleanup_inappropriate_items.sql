-- ============================================================================
-- Cleanup Inappropriate Items (089)
-- ============================================================================
-- One-time soft-delete of items that aren't appropriate for a discovery app.
-- These slipped through during initial ingestion before content filtering
-- was added to the Google Places ingest function.
--
-- Items are soft-deleted (deleted_at set) so they're excluded from the
-- explore feed but can be restored if needed.
-- ============================================================================

-- Soft-delete by title pattern (businesses not suited for "go out" discovery)
UPDATE explore_items SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    -- Funeral / death services
    title ~* '(funeral|mortuary|cremation|cemetery)'
    -- Storage facilities
    OR title ~* '(self.storage|storage.unit)'
    -- Big-box / discount retail
    OR title ~* '(tractor.supply|dollar.(tree|general))'
    -- Auto services
    OR title ~* '(auto.parts|tire.center)'
    -- Bail / pawn
    OR title ~* '(bail.bond|pawn.shop)'
    -- Medical / dental
    OR title ~* '(urgent.care|medical.center|\yhospital\y)'
    OR title ~* '(dentist|orthodont)'
    -- Professional services
    OR title ~* '(insurance|law.office|attorney)'
    OR title ~* '(tax.prep|accounting)'
    -- Banks
    OR title ~* '\ybank\y'
  );

-- Soft-delete by sub_category (types removed from ingestion)
UPDATE explore_items SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND sub_category IN ('church', 'clothing store', 'florist', 'pet store');

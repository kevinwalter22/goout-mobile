-- ============================================================================
-- Web Collector Source Types — Part 1: Enum Only (Wave 3, Phase 3)
-- ============================================================================
-- Adds enum value for web collectors.
--
-- IMPORTANT: PostgreSQL requires new enum values to be committed before
-- they can be used in DML. The source row INSERT is in migration 039.
--
-- Rollback:
--   -- Note: enum values cannot be removed in PostgreSQL
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'web_community_calendar'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'event_source_type')) THEN
    ALTER TYPE event_source_type ADD VALUE 'web_community_calendar';
  END IF;
END$$;

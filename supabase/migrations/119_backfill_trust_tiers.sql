-- ============================================================================
-- Backfill Source Trust Tiers on Existing collector_targets
-- ============================================================================
-- Sets source_trust_tier on all pre-existing collector_targets rows based on
-- their source_type (added in migration 100). New targets created after
-- migration 118 default to 'silver' via the column default.
--
-- Tier assignments:
--   gold    ← campus, town, org  (institutional, reliable, structured calendars)
--   silver  ← venue              (manually-seeded venue pages — reasonable trust)
--   (platinum is reserved for API sources in event_sources, not collector_targets)
--
-- Also ensures all existing campus targets that were seeded and verified in
-- migration 100 are properly enabled (they were set is_enabled=true there,
-- but this is a belt-and-suspenders check).
--
-- Rollback:
--   UPDATE collector_targets SET source_trust_tier = 'silver';
-- ============================================================================

-- ── Gold: institutional calendar sources ─────────────────────────────────────
-- University/college calendars, municipal event pages, arts councils, chambers
UPDATE collector_targets
SET source_trust_tier = 'gold'
WHERE source_type IN ('campus', 'town', 'org')
  AND source_trust_tier = 'silver';   -- only update rows still at default

-- ── Silver: venue websites (default, but make explicit) ──────────────────────
-- Bars, restaurants, museums, theatres — reliable when they have event pages,
-- but site structure and update cadence varies
UPDATE collector_targets
SET source_trust_tier = 'silver'
WHERE source_type = 'venue'
  AND source_trust_tier != 'silver';  -- no-op unless manually changed to bronze

-- ── Summary notice ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_gold   INTEGER;
  v_silver INTEGER;
  v_total  INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_gold   FROM collector_targets WHERE source_trust_tier = 'gold';
  SELECT COUNT(*) INTO v_silver FROM collector_targets WHERE source_trust_tier = 'silver';
  v_total := v_gold + v_silver;
  RAISE NOTICE '119 trust tiers: gold=%, silver=%, total=%', v_gold, v_silver, v_total;
END;
$$;

-- ── Log current disabled targets needing manual verification ─────────────────
-- These targets were seeded in migrations 045, 062, 100 with is_enabled=false.
-- After running this migration, check this list and enable targets that are live.
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '--- Disabled collector targets awaiting verification ---';
  FOR rec IN
    SELECT name, base_url, source_type, source_trust_tier
    FROM collector_targets
    WHERE is_enabled = false
    ORDER BY source_trust_tier DESC, source_type, name
  LOOP
    RAISE NOTICE '  [%][%] % — %', rec.source_trust_tier, rec.source_type, rec.name, rec.base_url;
  END LOOP;
  RAISE NOTICE '--- End of disabled targets list ---';
END;
$$;

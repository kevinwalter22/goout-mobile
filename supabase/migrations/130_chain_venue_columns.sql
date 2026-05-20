-- ============================================================================
-- Phase 5.3 prep — Chain Venue Columns (130)
-- ============================================================================
-- Adds is_chain / chain_brand / is_chain_override to explore_items so the
-- Phase 5.3 venue-discovery bridge can exclude chain venues from auto-
-- crawling, and the recommender can suppress them in discovery feeds.
--
-- Schema only: backfill is handled by scripts/backfill_chain_venues.ts
-- (run once after this migration applies) so the brand vocabulary has a
-- single source of truth in supabase/functions/_shared/chain-detection.ts.
--
-- Forward path: source-adapters/google_places.ts calls isChainVenue() at
-- normalization time and emits is_chain + chain_brand on each
-- NormalizedEvent; normalize-raw-events writes them into the upsert.
--
-- Effective chain status (the value the ranker and 5.3 enqueue check):
--   COALESCE(is_chain_override, is_chain)
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_explore_items_chain_brand;
--   DROP INDEX IF EXISTS idx_explore_items_is_chain;
--   ALTER TABLE explore_items
--     DROP COLUMN IF EXISTS is_chain_override,
--     DROP COLUMN IF EXISTS chain_brand,
--     DROP COLUMN IF EXISTS is_chain;
-- ============================================================================

ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS is_chain BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS chain_brand TEXT,
  ADD COLUMN IF NOT EXISTS is_chain_override BOOLEAN;

COMMENT ON COLUMN explore_items.is_chain IS
  'TRUE when the venue is a known multi-location brand. Set at normalization '
  'time by the Google Places adapter using supabase/functions/_shared/'
  'chain-detection.ts. The recommender applies a x0.5 score penalty in '
  'discovery feeds (overridden by active search and friends-checked-in '
  'signals), and the Phase 5.3 venue-discovery bridge skips chain rows '
  'when enqueueing crawl candidates.';

COMMENT ON COLUMN explore_items.chain_brand IS
  'Normalized brand string (e.g. "Starbucks", "Dunkin") when is_chain=TRUE; '
  'NULL otherwise. Used for chain-level analytics and "find me a {brand} '
  'near here" searches.';

COMMENT ON COLUMN explore_items.is_chain_override IS
  'Tri-state manual override. NULL = use is_chain (default). TRUE = force '
  'chain (use for local mini-chains the curated list misses). FALSE = force '
  'not-chain (use for chains we DO want to crawl, e.g. a Whole Foods location '
  'with real event programming). Effective value: COALESCE(is_chain_override, is_chain).';

-- Partial index on TRUE values: the recommender and 5.3 enqueue query
-- both filter chains OUT, so we only need fast lookup on the minority
-- TRUE rows.
CREATE INDEX IF NOT EXISTS idx_explore_items_is_chain
  ON explore_items(is_chain)
  WHERE is_chain = TRUE;

-- Partial index on chain_brand for brand-scoped queries
-- ("show me all Starbucks near here").
CREATE INDEX IF NOT EXISTS idx_explore_items_chain_brand
  ON explore_items(chain_brand)
  WHERE chain_brand IS NOT NULL;

# Wave 1 Verification Suite

All Wave 1 tasks from `docs/system_audit.md` section D.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| W1-1 | `93f2d6e` | Fix duplicate migration 023 → 027 |
| W1-2 | `f417e2f` | Unify tag taxonomy (49 canonical tags) |
| W1-3 | `1c5cbe8` | Wire tag filtering into explore RPC |
| W1-4 | `93fd380` | Stable distance sort + pagination |
| W1-5 | `b66db6e` | Stale event demotion |
| W1-6 | `1617a98` | Confidence scoring + quality gate |
| W1-7 | `1617a98` | Quality gate in RPC (combined with W1-6) |
| W1-8 | `8cc727b` | Verify is_available_at_time() |

## New Migrations

| Number | File | Purpose |
|--------|------|---------|
| 028 | `028_add_tag_filter_to_rpc.sql` | `p_tags TEXT[]` param + `&&` overlap |
| 029 | `029_add_stale_demotion.sql` | `demote_stale_items()` + stale exclusion |
| 030 | `030_add_confidence_writeback.sql` | `compute_item_confidence()` + quality gate |
| 031 | `031_verify_time_availability.sql` | `is_available_at_time()` re-declare + tests |

Apply order: 028 → 029 → 030 → 031 (sequential, each depends on prior).

---

## Acceptance Tests

Run these SQL queries in the Supabase SQL Editor after applying all migrations.

### W1-1: Migration numbering

```sql
-- PASS if no error: migration 027 exists and 023 duplicate is resolved
-- Verify by listing migration files — no two share the same prefix number.
-- (Manual check: ls supabase/migrations/)
```

### W1-2: Tag taxonomy sync

```bash
# Run from project root:
npx tsx scripts/check_tag_sync.ts
# Expected output: "Tag sync check PASSED (49 tags in both lists)"
```

### W1-3: Tag filtering via RPC

```sql
-- Verify p_tags parameter works with array overlap
SELECT count(*) FROM filter_explore_items(
  p_tags := ARRAY['outdoors', 'hiking']
);
-- PASS: Returns count > 0 (if outdoors/hiking items exist)

-- Verify no results for non-existent tag
SELECT count(*) FROM filter_explore_items(
  p_tags := ARRAY['nonexistent_tag_xyz']
);
-- PASS: Returns 0
```

### W1-4: Distance sort stability

```
Manual test in the app:
1. Open Explore tab
2. Set sort to "Distance"
3. Scroll to page 2
4. Scroll back to page 1
PASS: Items on page 1 are in the same order as before scrolling.
No items appear on both page 1 and page 2.
```

### W1-5: Stale event demotion

```sql
-- Run demotion
SELECT demote_stale_items();

-- Verify: no stale events have priority >= 0
SELECT count(*)
FROM explore_items
WHERE kind = 'event'
  AND starts_at < NOW() - INTERVAL '1 day'
  AND priority >= 0;
-- PASS: Returns 0

-- Verify: activities are unaffected
SELECT count(*)
FROM explore_items
WHERE kind = 'activity'
  AND priority = -1;
-- PASS: Returns 0 (no activities were demoted)

-- Verify: demoted items excluded from RPC results
SELECT count(*)
FROM filter_explore_items()
WHERE priority < 0;
-- PASS: Returns 0
```

### W1-6: Confidence write-back

```sql
-- Verify confidence was backfilled
SELECT count(*) AS total,
       count(normalized_confidence) AS scored,
       count(*) - count(normalized_confidence) AS unscored
FROM explore_items;
-- PASS: scored = total (all items have a confidence score)

-- Verify scoring formula
SELECT id, title,
       category IS NOT NULL AS has_category,
       price_bucket::TEXT != 'unknown' AS has_price,
       array_length(tags, 1) > 0 AS has_tags,
       availability_json IS NOT NULL AS has_availability,
       lat IS NOT NULL AND lng IS NOT NULL AS has_location,
       normalized_confidence
FROM explore_items
ORDER BY normalized_confidence ASC
LIMIT 10;
-- PASS: Items with fewer fields filled have lower scores.
--       Minimum possible: 0 (missing all five fields).
--       Maximum: 100 (all fields present).
```

### W1-7: Quality gate

```sql
-- Verify low-quality items excluded from RPC (default threshold 40)
SELECT count(*)
FROM filter_explore_items()
WHERE normalized_confidence < 40;
-- PASS: Returns 0

-- Verify NULL confidence passes through (backwards compatible)
-- (Only relevant if any items haven't been scored yet)
SELECT count(*)
FROM filter_explore_items()
WHERE normalized_confidence IS NULL;
-- PASS: Returns >= 0 (NULL items are NOT excluded)

-- Verify custom threshold works
SELECT count(*) FROM filter_explore_items(p_min_confidence := 70);
SELECT count(*) FROM filter_explore_items(p_min_confidence := 0);
-- PASS: Threshold 70 returns <= threshold 0
```

### W1-8: Time availability helper

```sql
-- These run automatically during migration 031.
-- To re-verify manually:

SELECT is_available_at_time('{"available_times": "anytime"}'::jsonb, 'morning');
-- PASS: TRUE

SELECT is_available_at_time('{"available_times": "daylight"}'::jsonb, 'evening');
-- PASS: FALSE

SELECT is_available_at_time(
  '{"available_times": {"start": "09:00", "end": "17:00"}}'::jsonb,
  'evening'
);
-- PASS: FALSE

SELECT is_available_at_time(
  '{"available_times": {"start": "19:00", "end": "23:00"}}'::jsonb,
  'evening'
);
-- PASS: TRUE
```

---

## Rollback Procedures

Each task can be rolled back independently in reverse order.

### W1-8 rollback
```sql
DROP FUNCTION IF EXISTS is_available_at_time(JSONB, TEXT);
-- Note: this breaks filter_explore_items() if p_time_of_day is non-null.
-- Currently dormant (always NULL), so safe to drop.
```

### W1-7 + W1-6 rollback
```sql
UPDATE explore_items SET normalized_confidence = NULL;
DROP FUNCTION IF EXISTS compute_item_confidence(UUID);
-- Restore filter RPCs from migration 029 (without p_min_confidence param).
-- Run migration 029's CREATE OR REPLACE statements again.
```

### W1-5 rollback
```sql
UPDATE explore_items SET priority = 0 WHERE priority = -1;
DROP FUNCTION IF EXISTS demote_stale_items();
SELECT cron.unschedule('demote-stale-items');  -- if pg_cron was used
-- Restore filter RPCs from migration 028 (without priority >= 0 clause).
```

### W1-4 rollback
```
Revert commit 93fd380 in src/lib/exploreQuery.ts.
No migration changes — client-only fix.
```

### W1-3 rollback
```sql
-- Restore filter RPCs without p_tags parameter.
-- Run migration 022's original CREATE OR REPLACE statements.
```

### W1-2 rollback
```
Revert src/config/tagTaxonomy.ts, src/lib/normalizeExploreItem.ts,
and supabase/functions/_shared/enrichment-schema.ts to prior state.
No migration changes.
```

### W1-1 rollback
```
Rename supabase/migrations/027_upgrade_enrichment_pipeline.sql back
to 023_upgrade_enrichment_pipeline.sql and rename
023_add_posts_explore_item_id.sql to avoid collision.
```

---

## Files Modified

| File | Tasks | Change |
|------|-------|--------|
| `src/config/tagTaxonomy.ts` | W1-2 | NEW: 49 canonical tags, single source of truth |
| `src/lib/normalizeExploreItem.ts` | W1-2 | Import from tagTaxonomy, add synonyms |
| `src/lib/exploreQuery.ts` | W1-3, W1-4, W1-5, W1-6 | Tag filtering, overfetch, stale exclusion, quality gate |
| `supabase/functions/_shared/enrichment-schema.ts` | W1-2 | Add festival, market, fair to VALID_TAGS |
| `scripts/check_tag_sync.ts` | W1-2 | NEW: Tag sync verification script |
| `docs/migration_notes.md` | W1-1 | NEW: Migration numbering documentation |
| `supabase/migrations/027_*` | W1-1 | Renamed from 023 |
| `supabase/migrations/028_*` | W1-3 | NEW: Tag filter RPC |
| `supabase/migrations/029_*` | W1-5 | NEW: Stale demotion + priority exclusion |
| `supabase/migrations/030_*` | W1-6, W1-7 | NEW: Confidence + quality gate |
| `supabase/migrations/031_*` | W1-8 | NEW: Time availability tests |

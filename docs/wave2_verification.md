# Wave 2 Verification Suite

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| W2-1 | `9939fb4` | Eventbrite API source adapter + ingestion function |
| W2-2 | `5119770` | Cross-source dedup detection (migration 032) |
| W2-3 | `bdab96a` | Re-enrichment scheduler + backfill script |
| W2-4 | `b9da680` | Pipeline health monitoring (migration 033) |
| W2-5 | `3318f2e` | Seasonal filtering + availability_json validation (migration 034) |
| W2-6 | `6ec3361` | Wire deterministic normalization into ingestion |
| W2-7 | `173971f` | Fetch rotation + geo partitioning (migration 035) |

## Files Changed

### New Files
- `supabase/functions/_shared/source-adapters/eventbrite.ts` — Eventbrite adapter
- `supabase/functions/_shared/source-adapters/index.ts` — Adapter registry
- `supabase/functions/ingest-eventbrite/index.ts` — Eventbrite ingestion Edge Function
- `supabase/migrations/032_add_dedup_detection.sql` — Dedup columns, compute/mark functions, filter RPC update
- `supabase/functions/schedule-enrichment/index.ts` — Re-enrichment scheduler Edge Function
- `scripts/backfill_enrichment.ts` — CLI backfill script
- `supabase/migrations/033_add_pipeline_health_log.sql` — Health log table + snapshot RPC
- `supabase/functions/health-summary/index.ts` — Health dashboard Edge Function
- `supabase/functions/_shared/health-log.ts` — Shared health logging utility
- `supabase/migrations/034_add_season_filter.sql` — Season filter in RPCs + availability validation
- `supabase/functions/_shared/normalize-fields.ts` — Deno-compatible field normalization
- `supabase/migrations/035_add_fetch_partitions.sql` — Fetch partitions + rotation RPCs
- `supabase/functions/fetch-coordinator/index.ts` — Fetch rotation orchestrator

### Modified Files
- `src/lib/exploreQuery.ts` — Added `.eq("is_duplicate", false)` in fallback, season param to RPCs, `getCurrentSeason()` helper
- `supabase/functions/normalize-raw-events/index.ts` — Added `normalizeFields()` step, `compute_dedupe_key()` post-upsert, health logging

---

## SQL Acceptance Tests

Run these in the Supabase SQL Editor to verify each task.

### W2-1: Eventbrite Adapter

No migration needed (adapter is code-only). Verify by deploying and invoking:

```sql
-- Verify Eventbrite source exists (after first invocation)
SELECT name, type, is_enabled, last_fetch_at
FROM event_sources
WHERE type = 'api_eventbrite';

-- Verify raw data was ingested
SELECT COUNT(*) AS eventbrite_raw_count
FROM event_ingest_raw eir
JOIN event_sources es ON es.id = eir.source_id
WHERE es.type = 'api_eventbrite';
```

### W2-2: Cross-Source Dedup

```sql
-- 1. Columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'explore_items'
  AND column_name IN ('dedupe_key', 'is_duplicate', 'canonical_item_id');
-- Expected: 3 rows

-- 2. Dedupe keys computed
SELECT COUNT(*) AS items_with_dedupe_key
FROM explore_items
WHERE dedupe_key IS NOT NULL;
-- Expected: > 0

-- 3. Mark duplicates works
SELECT * FROM mark_duplicates();
-- Returns: (groups_found, items_marked)

-- 4. Duplicates excluded from filter
SELECT COUNT(*) FROM filter_explore_items();
-- All returned items should have is_duplicate = false
SELECT COUNT(*) FROM explore_items WHERE is_duplicate = true;
```

### W2-3: Re-enrichment Scheduler

```sql
-- Verify enrichment queue exists and has items
SELECT status, COUNT(*) FROM enrichment_queue GROUP BY status;

-- Test: items with NULL confidence should be findable
SELECT COUNT(*) AS needing_enrichment
FROM explore_items
WHERE priority >= 0
  AND (
    normalized_confidence IS NULL
    OR tags IS NULL
    OR hook_line IS NULL
    OR availability_json IS NULL
  );
```

**Edge Function test:**
```bash
# Dry run
curl.exe -X POST "https://lkmntknpaiaiqvupzjbz.supabase.co/functions/v1/schedule-enrichment" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d "{\"dry_run\": true}"
```

### W2-4: Health Monitoring

```sql
-- 1. Table exists
SELECT column_name FROM information_schema.columns
WHERE table_name = 'pipeline_health_log'
ORDER BY ordinal_position;
-- Expected: id, stage, source_name, status, items_processed, items_failed, duration_ms, details_json, created_at

-- 2. Snapshot RPC works
SELECT pipeline_health_snapshot();
-- Returns JSON with: snapshot_at, sources, queues, quality, recent_errors

-- 3. Quality metrics
SELECT
  (pipeline_health_snapshot()->'quality'->>'total_items')::INT AS total,
  (pipeline_health_snapshot()->'quality'->>'active_items')::INT AS active,
  (pipeline_health_snapshot()->'quality'->>'duplicates_marked')::INT AS dupes,
  (pipeline_health_snapshot()->'quality'->>'avg_confidence')::INT AS avg_conf;
```

**Edge Function test:**
```bash
curl.exe -X GET "https://lkmntknpaiaiqvupzjbz.supabase.co/functions/v1/health-summary" \
  -H "Authorization: Bearer <ANON_KEY>"
```

### W2-5: Seasonal Filtering

```sql
-- 1. Validate function exists
SELECT validate_availability_json('{"type": "activity", "available_seasons": ["summer"]}'::JSONB);

-- 2. Season filter works
-- Items with summer-only availability should be excluded in winter
SELECT COUNT(*) AS winter_visible
FROM filter_explore_items(p_season := 'winter');

SELECT COUNT(*) AS summer_visible
FROM filter_explore_items(p_season := 'summer');

-- 3. Season helper
SELECT get_current_season();

-- 4. Test with known seasonal item
-- (Insert a test item, then query)
-- INSERT INTO explore_items (title, kind, priority, availability_json)
-- VALUES ('Summer Festival', 'event', 50,
--   '{"type": "event", "available_seasons": ["summer"]}'::JSONB);
-- SELECT COUNT(*) FROM filter_explore_items(p_season := 'winter');
-- The summer festival should NOT appear in winter results.
```

### W2-6: Normalization Wiring

```sql
-- After running normalize-raw-events, verify items have canonical values
SELECT
  category,
  COUNT(*) AS cnt
FROM explore_items
WHERE priority >= 0
GROUP BY category
ORDER BY cnt DESC;
-- Expected: canonical values like 'Arts & Culture', 'Outdoor', etc.

-- Verify normalized_confidence is set at write time
SELECT COUNT(*) AS has_confidence
FROM explore_items
WHERE normalized_confidence IS NOT NULL AND priority >= 0;

-- Verify dedupe_key is computed
SELECT COUNT(*) AS has_dedupe_key
FROM explore_items
WHERE dedupe_key IS NOT NULL AND priority >= 0;
```

### W2-7: Fetch Rotation

```sql
-- 1. Table exists with default partitions
SELECT fp.partition_label, fp.is_enabled, fp.fetch_interval_minutes,
       fp.last_fetched_at, fp.consecutive_errors,
       es.name AS source_name
FROM fetch_partitions fp
JOIN event_sources es ON es.id = fp.source_id;
-- Expected: potsdam-50mi partitions for Ticketmaster and Eventbrite

-- 2. Next partition picks correctly
SELECT * FROM next_fetch_partition();
-- Returns the most overdue partition

-- 3. Complete updates correctly
-- (After a fetch coordinator run)
SELECT partition_label, last_fetched_at, last_result, consecutive_errors
FROM fetch_partitions
ORDER BY last_fetched_at DESC NULLS LAST;
```

**Edge Function test:**
```bash
# Dry run
curl.exe -X POST "https://lkmntknpaiaiqvupzjbz.supabase.co/functions/v1/fetch-coordinator" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d "{\"dry_run\": true, \"max_fetches\": 1}"
```

---

## App-Level Checks

### Filter Chips

1. **"Free" chip** — Should only show items with `price_bucket = 'free'`
2. **"Outdoors" chip** — Should match via tags `outdoors`, `hiking`, `nature`, `parks`
3. **"Live Music" chip** — Should match via tags `live_music`, `concert`
4. **Date filters** — "Today", "This Weekend" should use availability_json when available

### Seasonal Behavior

- In winter (Dec-Feb): Summer-only activities (e.g., beach, outdoor pool) should not appear
- Items with no seasonal restriction should always appear
- Items with `available_seasons: ["year_round"]` should always appear

### Dedup Behavior

- If Ticketmaster and Eventbrite both have the same event (same title, date, location):
  - Only ONE should appear in the feed
  - The one with higher confidence is kept as canonical

### Data Quality

```sql
-- Quick quality dashboard
SELECT
  COUNT(*) AS total_items,
  COUNT(*) FILTER (WHERE priority >= 0) AS active_items,
  COUNT(*) FILTER (WHERE is_duplicate) AS duplicates,
  ROUND(AVG(normalized_confidence) FILTER (WHERE normalized_confidence IS NOT NULL)) AS avg_confidence,
  COUNT(*) FILTER (WHERE hook_line IS NOT NULL AND LENGTH(hook_line) >= 10) AS has_hook_line,
  COUNT(*) FILTER (WHERE tags IS NOT NULL AND array_length(tags, 1) > 0) AS has_tags,
  COUNT(*) FILTER (WHERE availability_json IS NOT NULL) AS has_availability,
  COUNT(*) FILTER (WHERE price_bucket != 'unknown') AS has_price
FROM explore_items;
```

---

## Deployment Steps

1. **Apply migrations 032-035** in order via Supabase Dashboard SQL Editor
2. **Deploy Edge Functions:**
   ```bash
   npx supabase functions deploy ingest-eventbrite
   npx supabase functions deploy schedule-enrichment
   npx supabase functions deploy health-summary
   npx supabase functions deploy normalize-raw-events
   npx supabase functions deploy fetch-coordinator
   ```
3. **Set secrets** (if not already set):
   ```bash
   npx supabase secrets set EVENTBRITE_API_KEY=<your-key>
   npx supabase secrets set ANTHROPIC_API_KEY=<your-key>
   ```
4. **Test fetch coordinator:**
   ```bash
   curl.exe -X POST "https://lkmntknpaiaiqvupzjbz.supabase.co/functions/v1/fetch-coordinator" \
     -H "Authorization: Bearer <ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d "{\"max_fetches\": 1}"
   ```
5. **Run normalization:**
   ```bash
   curl.exe -X POST "https://lkmntknpaiaiqvupzjbz.supabase.co/functions/v1/normalize-raw-events" \
     -H "Authorization: Bearer <ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d "{\"batch_size\": 50}"
   ```
6. **Check health:**
   ```bash
   curl.exe -X GET "https://lkmntknpaiaiqvupzjbz.supabase.co/functions/v1/health-summary" \
     -H "Authorization: Bearer <ANON_KEY>"
   ```

---

## Rollback Notes

Each task is independently reversible:

| Task | Rollback |
|------|----------|
| W2-1 | Set `event_sources.is_enabled = false` for Eventbrite. Delete `ingest-eventbrite` function. |
| W2-2 | `ALTER TABLE explore_items DROP COLUMN dedupe_key, is_duplicate, canonical_item_id;` Restore filter RPCs from migration 030. |
| W2-3 | Delete `schedule-enrichment` function and `scripts/backfill_enrichment.ts`. |
| W2-4 | `DROP TABLE pipeline_health_log; DROP FUNCTION pipeline_health_snapshot(); DROP FUNCTION cleanup_old_health_logs(INTEGER);` Delete `health-summary` function. |
| W2-5 | Restore filter RPCs from migration 032 (drop `p_season` param). `DROP FUNCTION validate_availability_json(JSONB);` Revert `exploreQuery.ts` season changes. |
| W2-6 | Revert `normalize-raw-events/index.ts` to remove normalization step. Delete `normalize-fields.ts`. |
| W2-7 | `DROP TABLE fetch_partitions CASCADE; DROP FUNCTION next_fetch_partition(TEXT); DROP FUNCTION complete_fetch_partition(UUID, BOOLEAN, TEXT, JSONB);` Delete `fetch-coordinator` function. |

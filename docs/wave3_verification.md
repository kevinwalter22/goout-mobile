# Wave 3 Verification Suite

## Summary

Wave 3 adds two new data sources and a web collector framework:

| Phase | Commit | Description |
|---|---|---|
| W3-0 | `de08c3d` | Disable Eventbrite geo-discovery (API removed 2020) |
| W3-1 | `8a90cb2` | Google Places ingestion (Nearby Search v1) |
| W3-2 | `9098ad4` | Google Places adapter (normalize → explore_items) |
| W3-3 | `7ac6479` | Web collector framework (robots.txt, circuit breaker) |
| W3-4 | (this)   | Verification suite + docs |

## Pre-Deployment Checklist

### 1. Secrets Required

```bash
# Google Places API key — required for Phase 1
npx supabase secrets set GOOGLE_PLACES_API_KEY=<your-key>

# Verify existing secrets still work
npx supabase secrets list
```

### 2. Migrations to Apply

Apply in order via SQL Editor:

1. **036** — Disable Eventbrite source + partitions
2. **037** — Add Google Places source row + fetch partition
3. **038** — Add web_community_calendar enum + disabled template source

### 3. Edge Functions to Deploy

```bash
npx supabase functions deploy ingest-google-places
npx supabase functions deploy ingest-eventbrite
npx supabase functions deploy fetch-coordinator
npx supabase functions deploy normalize-raw-events
```

## Verification Steps

### V1: Eventbrite Disabled Cleanly

```bash
# Should return: {"success":true,"status":"disabled","reason":"unsupported_endpoint",...}
curl -X POST $SUPABASE_URL/functions/v1/ingest-eventbrite \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

**Expected**: Zero errors, `status: "disabled"`, health log entry with `items_processed: 0`.

**SQL Check**:
```sql
SELECT is_enabled, config_json->>'disabled_reason' AS reason
FROM event_sources WHERE type = 'api_eventbrite';
-- Expected: is_enabled=false, reason='geo_discovery_endpoint_removed'
```

### V2: Google Places Ingestion

```bash
# Dry run first — no DB writes
curl -X POST $SUPABASE_URL/functions/v1/ingest-google-places \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"included_types": ["restaurant"], "dry_run": true}'
```

**Expected**: `success: true`, results array with restaurant names from Potsdam area.

```bash
# Live run with single type
curl -X POST $SUPABASE_URL/functions/v1/ingest-google-places \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"included_types": ["restaurant"]}'
```

**Expected**: `inserted` count > 0, raw records in `event_ingest_raw`.

**SQL Check**:
```sql
-- Raw records from Google Places
SELECT COUNT(*), MIN(fetched_at), MAX(fetched_at)
FROM event_ingest_raw eir
JOIN event_sources es ON es.id = eir.source_id
WHERE es.type = 'api_google_places';

-- Should see Google Places items
SELECT external_id, raw_json->>'displayName' AS name, status
FROM event_ingest_raw eir
JOIN event_sources es ON es.id = eir.source_id
WHERE es.type = 'api_google_places'
ORDER BY fetched_at DESC LIMIT 10;
```

### V3: Google Places Normalization

```bash
# Run normalizer after ingestion
curl -X POST $SUPABASE_URL/functions/v1/normalize-raw-events \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"max_items": 50}'
```

**Expected**: `normalized` count > 0, `api_google_places` in supported adapters list.

**SQL Check**:
```sql
-- Activities from Google Places in explore_items
SELECT title, kind, category, price_bucket, tags, town, priority, xp_value
FROM explore_items ei
JOIN event_sources es ON es.id = ei.source_id
WHERE es.type = 'api_google_places'
ORDER BY priority DESC
LIMIT 20;

-- Verify kind='activity' for all Places items
SELECT kind, COUNT(*) FROM explore_items ei
JOIN event_sources es ON es.id = ei.source_id
WHERE es.type = 'api_google_places'
GROUP BY kind;
-- Expected: all rows have kind='activity'
```

### V4: Full Pipeline End-to-End

```bash
# Run full ingestion (all types)
curl -X POST $SUPABASE_URL/functions/v1/ingest-google-places \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"

# Then normalize
curl -X POST $SUPABASE_URL/functions/v1/normalize-raw-events \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"max_items": 500}'
```

**SQL Check**:
```sql
-- Total items by source
SELECT es.name, es.type, COUNT(ei.id) AS items, AVG(ei.priority) AS avg_priority
FROM explore_items ei
JOIN event_sources es ON es.id = ei.source_id
GROUP BY es.name, es.type
ORDER BY items DESC;

-- Category distribution for Google Places
SELECT category, COUNT(*) FROM explore_items ei
JOIN event_sources es ON es.id = ei.source_id
WHERE es.type = 'api_google_places'
GROUP BY category ORDER BY COUNT(*) DESC;

-- Price bucket distribution
SELECT price_bucket, COUNT(*) FROM explore_items ei
JOIN event_sources es ON es.id = ei.source_id
WHERE es.type = 'api_google_places'
GROUP BY price_bucket ORDER BY COUNT(*) DESC;
```

### V5: Fetch Coordinator Picks Google Places

```bash
curl -X POST $SUPABASE_URL/functions/v1/fetch-coordinator \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source_type": "api_google_places", "dry_run": true}'
```

**Expected**: Picks the `potsdam-activities` partition, shows would invoke `ingest-google-places`.

### V6: Health Pipeline Logging

```sql
-- Recent health log entries
SELECT stage, source_name, status, items_processed, items_failed,
       duration_ms, created_at
FROM pipeline_health_log
ORDER BY created_at DESC LIMIT 20;

-- Google Places specific entries
SELECT * FROM pipeline_health_log
WHERE source_name = 'Google Places'
ORDER BY created_at DESC LIMIT 5;
```

### V7: Web Collector Framework (Template Only)

```sql
-- Verify web collector source exists and is DISABLED
SELECT name, type, is_enabled, config_json->>'disabled_reason' AS reason
FROM event_sources WHERE type::TEXT LIKE 'web_%';
-- Expected: is_enabled=false, reason='template_only'
```

### V8: Eventbrite Partition Disabled

```sql
-- Verify Eventbrite partition is disabled
SELECT fp.partition_label, fp.is_enabled, fp.consecutive_errors
FROM fetch_partitions fp
JOIN event_sources es ON es.id = fp.source_id
WHERE es.type = 'api_eventbrite';
-- Expected: is_enabled=false, consecutive_errors=0
```

## Acceptance Criteria

- [ ] Eventbrite returns `status: "disabled"` with zero errors
- [ ] Google Places ingests places for at least 5 different types
- [ ] Normalization produces `kind='activity'` items with proper categories
- [ ] Tags are populated from place types (e.g., parks → outdoors, nature)
- [ ] Price buckets are mapped from priceLevel
- [ ] Circuit breaker stops ingestion after 3 consecutive API errors
- [ ] Health log has entries for Google Places ingest and normalize stages
- [ ] Web collector template source exists but is disabled
- [ ] Fetch coordinator can pick Google Places partition
- [ ] No Eventbrite errors appear in logs

## Rollback Plan

### Disable Google Places

```sql
UPDATE event_sources SET is_enabled = false WHERE type = 'api_google_places';
UPDATE fetch_partitions SET is_enabled = false
  WHERE source_id IN (SELECT id FROM event_sources WHERE type = 'api_google_places');
```

### Remove Google Places Data

```sql
-- Remove explore_items from Google Places
DELETE FROM explore_items
WHERE source_id IN (SELECT id FROM event_sources WHERE type = 'api_google_places');

-- Remove raw data
DELETE FROM event_ingest_raw
WHERE source_id IN (SELECT id FROM event_sources WHERE type = 'api_google_places');
```

---

## Wave 3.5 — Pipeline Hardening (Migrations 040-043)

### New Migrations

| Migration | Purpose |
|---|---|
| **040** | Enrichment updates (description, time_text, fuzzy dedup) |
| **041** | Fix normalization trigger on UPDATE (idempotent re-ingest) |
| **042** | API usage counters (budget guardrail) |
| **043** | Place details cache (lazy detail loading) |

### Additional Edge Functions to Deploy

```bash
npx supabase functions deploy ingest-google-places    # Rewritten with multi-region + text search
npx supabase functions deploy fetch-place-details     # New: lazy detail loading
npx supabase functions deploy enrich-explore-item     # Updated: description + time_text
npx supabase functions deploy run-enrichment-queue    # Updated: description + time_text
```

### V9: Idempotent Ingestion (Migration 041)

```bash
# Run ingestion twice — second run should produce all "unchanged"
curl -X POST $SUPABASE_URL/functions/v1/ingest-google-places \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"included_types": ["restaurant"], "max_total_requests": 5}'

# Wait, then run again
curl -X POST $SUPABASE_URL/functions/v1/ingest-google-places \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"included_types": ["restaurant"], "max_total_requests": 5}'
```

**Expected**: Second run shows `"unchanged"` for all items. Zero `"inserted"` on re-run.

### V10: Budget Guardrail (Migration 042)

```sql
-- Check budget counter exists
SELECT * FROM get_api_budget('google_places');
-- Expected: requests_used >= 0, requests_limit = 10000, requests_remaining > 0

-- Test atomic increment
SELECT increment_api_usage('google_places', 1);
-- Expected: TRUE (within budget)

-- Verify counter incremented
SELECT * FROM get_api_budget('google_places');
```

### V11: Multi-Region (Potsdam + Canton)

```bash
# Run with default regions
curl -X POST $SUPABASE_URL/functions/v1/ingest-google-places \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"included_types": ["park"], "max_total_requests": 10}'
```

**Expected**: Results include items from both Potsdam and Canton areas. Response includes `region` field per result.

```sql
-- Check geographic spread of Places items
SELECT town, COUNT(*) FROM explore_items ei
JOIN event_sources es ON es.id = ei.source_id
WHERE es.type = 'api_google_places'
GROUP BY town ORDER BY COUNT(*) DESC;
```

### V12: Text Search Coverage

```bash
curl -X POST $SUPABASE_URL/functions/v1/ingest-google-places \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"included_types": [], "keywords": ["hiking trail"], "max_total_requests": 10}'
```

**Expected**: Results include hiking-related places discovered via Text Search.

### V13: Place Details Cache (Migration 043)

```sql
-- Verify table exists
SELECT COUNT(*) FROM place_details_cache;
-- Expected: 0 (empty until users view detail pages)

-- Verify RLS policies
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'place_details_cache';
-- Expected: SELECT for authenticated, ALL for service_role
```

### V14: Expanded Type Coverage

```sql
-- Check new types are being ingested and normalized
SELECT sub_category, COUNT(*)
FROM explore_items ei
JOIN event_sources es ON es.id = ei.source_id
WHERE es.type = 'api_google_places'
GROUP BY sub_category ORDER BY COUNT(*) DESC;
-- Expected: More categories than before (stadium, ice skating rink, etc.)
```

### V15: Enrichment with Description + Condensed Schedule

```sql
-- Check LLM-generated descriptions
SELECT title, LEFT(description, 80) AS desc_preview
FROM explore_items
WHERE description IS NOT NULL
  AND source_id IN (SELECT id FROM event_sources WHERE type = 'api_google_places')
LIMIT 10;

-- Check condensed schedules
SELECT title, time_text, LEFT(schedule_text, 40) AS raw_schedule
FROM explore_items
WHERE time_text IS NOT NULL
LIMIT 10;
```

### V16: Fuzzy Dedup

```sql
-- Check fuzzy duplicates detected
SELECT COUNT(*) FROM explore_items WHERE is_duplicate = TRUE;

-- Inspect specific matches
SELECT a.title AS duplicate, b.title AS canonical,
  similarity(LOWER(a.title), LOWER(b.title)) AS sim
FROM explore_items a
JOIN explore_items b ON a.canonical_item_id = b.id
WHERE a.is_duplicate = TRUE
LIMIT 10;
```

## Wave 3.5 Acceptance Criteria

- [ ] Re-running ingestion produces zero new inserts (idempotent)
- [ ] Budget counter tracks API requests accurately
- [ ] Multi-region returns items from both Potsdam and Canton
- [ ] Text Search discovers items not found by Nearby Search
- [ ] Place details cache table is ready (empty until user views)
- [ ] New types (stadium, ski_resort, etc.) have correct categories and tags
- [ ] LLM enrichment generates descriptions for Places items missing them
- [ ] Fuzzy dedup marks cross-source duplicates without false positives on dated events
- [ ] `fetch-place-details` edge function deploys and returns details for Google Places items

---

## Files Changed in Wave 3

| File | Action | Phase |
|---|---|---|
| `supabase/functions/ingest-eventbrite/index.ts` | Rewritten as safe no-op | W3-0 |
| `supabase/migrations/036_disable_eventbrite.sql` | New | W3-0 |
| `docs/eventbrite_deprecation.md` | New | W3-0 |
| `supabase/functions/ingest-google-places/index.ts` | New | W3-1 |
| `supabase/migrations/037_add_google_places_source.sql` | New | W3-1 |
| `supabase/functions/fetch-coordinator/index.ts` | Modified (added mapping) | W3-1 |
| `docs/google_places_setup.md` | New | W3-1 |
| `supabase/functions/_shared/source-adapters/google_places.ts` | New | W3-2 |
| `supabase/functions/_shared/source-adapters/index.ts` | Modified (registered adapter) | W3-2 |
| `supabase/functions/_shared/source-adapters/ticketmaster.ts` | Modified (added tags to interface) | W3-2 |
| `supabase/functions/normalize-raw-events/index.ts` | Modified (removed type cast) | W3-2 |
| `supabase/functions/_shared/web-collector.ts` | New | W3-3 |
| `supabase/migrations/038_add_web_collector_source_types.sql` | New | W3-3 |
| `docs/web_collectors.md` | New | W3-3 |
| `docs/wave3_verification.md` | New | W3-4 |

## Files Changed in Wave 3.5

| File | Action | Description |
|---|---|---|
| `supabase/migrations/040_enhance_enrichment_and_fuzzy_dedup.sql` | New | Enrichment + fuzzy dedup |
| `supabase/migrations/041_fix_normalization_on_update.sql` | New | Idempotent re-ingest trigger |
| `supabase/migrations/042_api_usage_counters.sql` | New | Budget guardrail |
| `supabase/migrations/043_place_details_cache.sql` | New | Lazy detail caching |
| `supabase/functions/ingest-google-places/index.ts` | Rewritten | Multi-region, Text Search, budget |
| `supabase/functions/fetch-place-details/index.ts` | New | Lazy Place Details |
| `supabase/functions/_shared/source-adapters/google_places.ts` | Modified | Added 14 new type mappings |
| `supabase/functions/_shared/enrichment-schema.ts` | Modified | description + short_schedule |
| `supabase/functions/_shared/llm-provider.ts` | Modified | Model config |
| `supabase/functions/run-enrichment-queue/index.ts` | Modified | New enrichment fields |
| `supabase/functions/enrich-explore-item/index.ts` | Modified | New enrichment fields |
| `src/lib/postableNow.ts` | Modified | Fixed date priority over availability_json |
| `src/hooks/usePlaceDetails.ts` | New | Client hook for lazy details |
| `app/event/[id].tsx` | Modified | Added Place Details display |
| `docs/google_places_setup.md` | Updated | Full docs refresh |
| `docs/wave3_verification.md` | Updated | Added Wave 3.5 verification |

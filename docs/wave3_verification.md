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

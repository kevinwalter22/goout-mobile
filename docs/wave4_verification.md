# Wave 4 Verification Suite — Web Collector System

## Summary

Wave 4 implements a production-grade web collector system for ingesting hyperlocal events from public web pages with strict compliance guardrails.

| Phase | Commit | Description |
|-------|--------|-------------|
| W4-1 | (this) | collector_targets configuration model |
| W4-2 | (this) | Fetch + cache with change detection |
| W4-3 | (this) | Deterministic extraction pipeline (JSON-LD, ICS, RSS, DOM) |

## Non-Negotiable Rules Enforced

- ✅ NO scraping social media (Facebook/Instagram/TikTok)
- ✅ Respect robots.txt (cached per target, 24h TTL)
- ✅ Allowlist-only: every target must be explicitly configured
- ✅ Circuit breakers: auto-disable on repeated 401/403/429 or parsing failures
- ✅ Caching: store fetched HTML with hash, skip unchanged pages
- ✅ AI only operates on cached content (never live browsing)

## Pre-Deployment Checklist

### 1. Migrations to Apply

```bash
# Apply via SQL Editor (in order)
044_add_collector_targets.sql        # Schema, enums, tables, functions
045_seed_web_collector_targets.sql   # Seed data (requires 044 to be committed first)
046_fix_collector_page_cache_trigger.sql  # Fix trigger (if 044 was already applied)
047_add_health_dashboard_views.sql   # Health monitoring views and functions
```

**Note**: PostgreSQL requires enum values to be committed before they can be used in DML statements. Migrations 044 and 045 must be run as separate transactions.

### 2. Edge Functions to Deploy

```bash
npx supabase functions deploy ingest-web-collector
npx supabase functions deploy fetch-coordinator  # Updated with web_collector mapping
```

## Verification Steps

### V1: Migration Applied Successfully

```sql
-- Verify enums created
SELECT typname FROM pg_type WHERE typname IN ('parsing_strategy', 'circuit_breaker_state');
-- Expected: both rows present

-- Verify tables created
SELECT tablename FROM pg_tables
WHERE tablename IN ('collector_targets', 'collector_page_cache');
-- Expected: both rows present

-- Verify example targets seeded (all disabled)
SELECT name, base_url, is_enabled, circuit_breaker
FROM collector_targets;
-- Expected: 3 rows (Clarkson, SUNY Potsdam, St. Lawrence), all is_enabled=false

-- Verify web_collector source row
SELECT name, type, is_enabled FROM event_sources
WHERE type = 'web_collector';
-- Expected: "Web Collector", is_enabled=true
```

### V2: Collector Targets Functions Work

```sql
-- Get enabled targets (should be empty since all disabled by default)
SELECT * FROM get_enabled_collector_targets();
-- Expected: empty result set

-- Enable one target for testing
UPDATE collector_targets
SET is_enabled = true
WHERE name = 'Clarkson University Events';

-- Now should return 1 target
SELECT name, base_url, parsing_strategy
FROM get_enabled_collector_targets();
-- Expected: 1 row

-- Disable it again
UPDATE collector_targets SET is_enabled = false
WHERE name = 'Clarkson University Events';
```

### V3: Circuit Breaker Functions

```sql
-- Test trip circuit breaker
-- First enable a target
UPDATE collector_targets
SET is_enabled = true, circuit_breaker = 'closed'
WHERE name = 'Clarkson University Events';

-- Get target ID
SELECT id FROM collector_targets WHERE name = 'Clarkson University Events';

-- Trip the circuit breaker (replace UUID)
SELECT trip_circuit_breaker('TARGET_UUID_HERE', 'Test trip');

-- Verify it tripped
SELECT name, circuit_breaker FROM collector_targets
WHERE name = 'Clarkson University Events';
-- Expected: circuit_breaker = 'open'

-- Verify health log entry
SELECT stage, source_name, status, details_json
FROM pipeline_health_log
WHERE stage = 'circuit_breaker'
ORDER BY created_at DESC LIMIT 1;
-- Expected: action='tripped'

-- Reset it
SELECT reset_circuit_breaker('TARGET_UUID_HERE');

-- Verify reset
SELECT name, circuit_breaker, consecutive_errors
FROM collector_targets
WHERE name = 'Clarkson University Events';
-- Expected: circuit_breaker='closed', consecutive_errors=0

-- Clean up
UPDATE collector_targets SET is_enabled = false
WHERE name = 'Clarkson University Events';
```

### V4: Page Cache Change Detection

```sql
-- Verify collector_page_cache table structure
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'collector_page_cache'
ORDER BY ordinal_position;
-- Expected: id, target_id, url, url_hash, content_hash, raw_html, extracted_candidates, etc.

-- Page cache should be empty initially
SELECT COUNT(*) FROM collector_page_cache;
-- Expected: 0
```

### V5: Fetch Coordinator Mapping

```bash
# Dry run to verify mapping exists
curl -X POST $SUPABASE_URL/functions/v1/fetch-coordinator \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source_type": "web_collector", "dry_run": true}'
```

**Expected**: Response shows `web_collector` source type is recognized and would invoke `ingest-web-collector`.

### V6: Ingest Web Collector (Dry Run)

```bash
# Run collector with no enabled targets (should return no_targets status)
curl -X POST $SUPABASE_URL/functions/v1/ingest-web-collector \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

**Expected**: `{ "success": true, "status": "no_targets", ... }`

### V7: Source Adapter Registered

```sql
-- Verify web_collector adapter exists
-- (Check via code inspection or API call to normalize-raw-events)
```

**From normalize-raw-events response:**
```json
"supported_adapters": ["api_ticketmaster", "api_eventbrite", "api_google_places", "web_collector", "web_community_calendar"]
```

### V8: Real Target Test (Optional)

**WARNING**: Only run this if you have a valid, robots.txt-compliant target configured.

```sql
-- Enable a real target (e.g., if you add one)
UPDATE collector_targets
SET
  is_enabled = true,
  base_url = 'https://example.com',  -- Replace with real URL
  discovery_urls = ARRAY['/events'],
  allowed_paths = ARRAY['/events/']
WHERE name = 'Test Target';
```

```bash
# Run the collector
curl -X POST $SUPABASE_URL/functions/v1/ingest-web-collector \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

**Check results:**
```sql
-- Pages cached
SELECT url, content_hash, http_status, extraction_strategy
FROM collector_page_cache
ORDER BY fetched_at DESC LIMIT 10;

-- Extracted candidates
SELECT url, jsonb_array_length(extracted_candidates) AS candidate_count
FROM collector_page_cache
WHERE extracted_candidates IS NOT NULL;

-- Target metrics updated
SELECT name, last_run_at, last_run_pages_fetched, last_run_items_found
FROM collector_targets;
```

### V9: Robots.txt Caching

```sql
-- After running collector, check robots.txt cache
SELECT name, robots_txt_allows_crawl, robots_txt_fetched_at,
       LEFT(robots_txt_cache, 100) AS robots_preview
FROM collector_targets
WHERE robots_txt_fetched_at IS NOT NULL;
```

### V10: Health Logging

```sql
-- Check web collector health entries
SELECT stage, source_name, status, items_processed, items_failed,
       duration_ms, details_json
FROM pipeline_health_log
WHERE stage = 'web_collect'
ORDER BY created_at DESC LIMIT 10;
```

### V11: Health Dashboard (Migration 047)

```sql
-- Quick health check
SELECT * FROM quick_health_check();
-- Expected: Table with check_name, status, value, details columns

-- Target health view
SELECT name, is_enabled, circuit_breaker, is_overdue
FROM v_collector_target_health;
-- Expected: All collector targets with health indicators

-- Pipeline stage health
SELECT stage, runs_last_7d, success_rate_pct, last_status
FROM v_pipeline_stage_health
WHERE source_name = 'Web Collector' OR source_name IS NULL;
-- Expected: Summary stats per pipeline stage

-- Web collector snapshot
SELECT web_collector_health_snapshot();
-- Expected: JSON with targets, page_cache, recent_runs sections

-- Full pipeline snapshot
SELECT pipeline_health_snapshot();
-- Expected: JSON with sources, queues, quality, web_collector sections
```

## Acceptance Criteria

- [ ] Migration 044 applies without errors (schema)
- [ ] Migration 045 applies without errors (seed data)
- [ ] Migration 046 applies without errors (trigger fix)
- [ ] Migration 047 applies without errors (health views)
- [ ] `parsing_strategy` and `circuit_breaker_state` enums created
- [ ] `collector_targets` table with all required fields
- [ ] `collector_page_cache` table for HTML caching
- [ ] All example targets seeded as DISABLED by default
- [ ] `get_enabled_collector_targets()` returns only enabled targets due to run
- [ ] `trip_circuit_breaker()` sets state to 'open' and logs event
- [ ] `reset_circuit_breaker()` resets state and errors
- [ ] `complete_collector_run()` updates metrics correctly
- [ ] Fetch coordinator recognizes `web_collector` source type
- [ ] `v_collector_target_health` view returns target status
- [ ] `quick_health_check()` returns health indicators
- [ ] `web_collector_health_snapshot()` returns JSON summary
- [ ] `ingest-web-collector` function deploys and runs
- [ ] Source adapter registered for normalization
- [ ] No Facebook/Instagram/TikTok targets allowed (enforced by allowlist)

## Rollback Plan

```sql
-- Disable all collector targets
UPDATE collector_targets SET is_enabled = false;

-- If needed, drop tables and enums
DROP TABLE IF EXISTS collector_page_cache;
DROP TABLE IF EXISTS collector_targets;
DROP TYPE IF EXISTS parsing_strategy;
DROP TYPE IF EXISTS circuit_breaker_state;

-- Remove web_collector source row
DELETE FROM event_sources WHERE type = 'web_collector';
```

---

## Files Changed in Wave 4

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/044_add_collector_targets.sql` | New | Collector targets + page cache tables (schema only) |
| `supabase/migrations/045_seed_web_collector_targets.sql` | New | Seed web_collector source and example targets |
| `supabase/migrations/046_fix_collector_page_cache_trigger.sql` | New | Fix incorrect updated_at trigger |
| `supabase/migrations/047_add_health_dashboard_views.sql` | New | Health views and monitoring functions |
| `supabase/functions/_shared/web-collector.ts` | Rewritten | Enhanced with targets integration + caching |
| `supabase/functions/_shared/web-extractors.ts` | New | JSON-LD, ICS, RSS, DOM extraction |
| `supabase/functions/_shared/source-adapters/web_collector.ts` | New | Normalization adapter |
| `supabase/functions/_shared/source-adapters/index.ts` | Modified | Registered web_collector adapter |
| `supabase/functions/ingest-web-collector/index.ts` | New | Main ingestion edge function (W4-5: now inserts into event_ingest_raw) |
| `supabase/functions/fetch-coordinator/index.ts` | Modified | Added web_collector mapping |
| `docs/wave4_verification.md` | New | This file |
| `docs/web_collector_playbook.md` | New | Operations playbook for web collector |

---

## Adding a New Collector Target

### 1. Verify Robots.txt Compliance

Before adding a target, manually check its robots.txt:

```bash
curl https://example.com/robots.txt
```

Ensure:
- The site doesn't block crawlers with `User-agent: *` / `Disallow: /`
- The specific paths you want to crawl are not disallowed
- There's no `Crawl-delay` directive requiring excessive delays

### 2. Add Target via SQL

```sql
INSERT INTO collector_targets (
  name,
  base_url,
  discovery_urls,
  allowed_paths,
  parsing_strategy,
  dom_selectors,
  is_enabled,
  source_id,
  crawl_frequency_minutes,
  contact_email
)
SELECT
  'Example Venue Events',
  'https://example.com',
  ARRAY['/events', '/calendar'],
  ARRAY['/events/', '/calendar/'],
  'hybrid',
  jsonb_build_object(
    'event_container', '.event-item',
    'title', '.event-title',
    'date', '.event-date',
    'location', '.event-location'
  ),
  false,  -- Start DISABLED
  es.id,
  360,    -- 6 hours
  'admin@yourdomain.com'
FROM event_sources es
WHERE es.name = 'Web Collector';
```

### 3. Test with Dry Run

```bash
curl -X POST $SUPABASE_URL/functions/v1/ingest-web-collector \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target_id": "TARGET_UUID", "dry_run": true}'
```

### 4. Enable Target

```sql
UPDATE collector_targets
SET is_enabled = true
WHERE name = 'Example Venue Events';
```

### 5. Monitor

```sql
-- Check last run
SELECT name, last_run_at, last_run_pages_fetched, last_run_items_found, consecutive_errors
FROM collector_targets
WHERE name = 'Example Venue Events';

-- Check circuit breaker status
SELECT name, circuit_breaker
FROM collector_targets
WHERE name = 'Example Venue Events';
```

---

## Extraction Strategy Selection Guide

| Content Type | Strategy | Notes |
|--------------|----------|-------|
| Schema.org markup | `jsonld` | Highest quality, structured data |
| ICS calendar feed | `ics` | Direct calendar data |
| RSS/Atom feed | `rss` | News-style event lists |
| Custom HTML | `html_dom` | Requires site-specific selectors |
| Unknown/Mixed | `hybrid` | Tries JSON-LD first, falls back to DOM |

### DOM Selector Configuration

For `html_dom` or `hybrid` strategy, configure selectors:

```sql
UPDATE collector_targets
SET dom_selectors = jsonb_build_object(
  'event_container', '.event-card, .calendar-item',  -- Container for each event
  'title', 'h2.event-title, .event-name',            -- Event title
  'date', '.event-date, time[datetime]',             -- Date/time
  'location', '.event-venue, .location',             -- Location name
  'description', '.event-description, .summary',     -- Description
  'link', 'a.event-link, a[href*="event"]',          -- Link to detail page
  'image', 'img.event-image, .thumbnail img'         -- Event image
)
WHERE name = 'Target Name';
```

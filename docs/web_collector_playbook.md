# Web Collector Operations Playbook

## Overview

The Web Collector is a production-grade system for ingesting hyperlocal events from public web pages with strict compliance guardrails. This playbook covers day-to-day operations.

**Non-Negotiable Rules:**
- NO scraping social media (Facebook/Instagram/TikTok)
- Respect robots.txt (cached per target, 24h TTL)
- Allowlist-only: every target must be explicitly configured
- Circuit breakers: auto-disable on repeated errors
- AI only operates on cached content (never live browsing)

---

## Quick Reference

### Run the Collector

```bash
# Run all enabled targets
curl -X POST $SUPABASE_URL/functions/v1/ingest-web-collector \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"

# Run a specific target
curl -X POST $SUPABASE_URL/functions/v1/ingest-web-collector \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target_id": "UUID_HERE"}'

# Dry run (no database writes)
curl -X POST $SUPABASE_URL/functions/v1/ingest-web-collector \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

### Health Check

```sql
-- Quick health check
SELECT * FROM quick_health_check();

-- Full pipeline health snapshot
SELECT pipeline_health_snapshot();

-- Web collector specific health
SELECT web_collector_health_snapshot();
```

### View Target Status

```sql
SELECT name, is_enabled, circuit_breaker, minutes_since_run, is_overdue
FROM v_collector_target_health;
```

---

## Adding a New Target

### Step 1: Verify Robots.txt Compliance

Before adding any target, check its robots.txt:

```bash
curl https://example.com/robots.txt
```

Ensure:
- The site doesn't block crawlers with `User-agent: * / Disallow: /`
- Your target paths are allowed
- No excessive `Crawl-delay` requirements

### Step 2: Identify Content Structure

Visit the target site and determine:

1. **Discovery URLs**: Entry points listing events (e.g., `/events`, `/calendar`)
2. **Allowed Paths**: URL patterns for event pages (e.g., `/events/`, `/calendar/`)
3. **Parsing Strategy**: What structured data is available?
   - `jsonld` - Site has Schema.org/JSON-LD markup
   - `ics` - Site provides iCal/ICS feed
   - `rss` - Site has RSS/Atom feed
   - `html_dom` - Custom HTML requiring CSS selectors
   - `hybrid` - Try JSON-LD first, fall back to DOM

4. **DOM Selectors** (if using `html_dom` or `hybrid`):
   - `event_container`: CSS selector for each event item
   - `title`: Selector for event title
   - `date`: Selector for date/time information
   - `location`: Selector for venue/location
   - `description`: Selector for event description
   - `link`: Selector for link to event detail page
   - `image`: Selector for event image

### Step 3: Insert the Target

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
  max_pages_per_run,
  contact_email
)
SELECT
  'Example Venue Events',           -- Descriptive name
  'https://example.com',            -- Base URL (no trailing slash)
  ARRAY['/events', '/calendar'],    -- Discovery entry points
  ARRAY['/events/', '/calendar/'],  -- Allowed URL path patterns
  'hybrid',                         -- Strategy (try JSON-LD, fallback DOM)
  jsonb_build_object(
    'event_container', '.event-card',
    'title', '.event-title, h2',
    'date', '.event-date, time[datetime]',
    'location', '.venue-name',
    'description', '.event-description',
    'link', 'a.event-link',
    'image', 'img.event-image'
  ),
  false,                            -- Start DISABLED for testing
  es.id,                            -- Link to Web Collector source
  360,                              -- Crawl every 6 hours
  10,                               -- Max 10 pages per run
  'admin@yourdomain.com'            -- Contact for compliance
FROM event_sources es
WHERE es.name = 'Web Collector';
```

### Step 4: Test with Dry Run

```bash
# Get the target ID
SELECT id, name FROM collector_targets WHERE name = 'Example Venue Events';

# Test fetch (dry run)
curl -X POST $SUPABASE_URL/functions/v1/ingest-web-collector \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target_id": "UUID_HERE", "dry_run": true}'
```

Check the response:
- `pages_fetched`: Number of pages retrieved
- `candidates_found`: Raw candidates extracted
- `valid_candidates`: Candidates with required fields (title, URL, date)

### Step 5: Review Extraction Results

```sql
-- Check cached pages
SELECT url, http_status, extraction_strategy,
       jsonb_array_length(extracted_candidates) AS candidates,
       extraction_errors
FROM collector_page_cache
WHERE target_id = 'UUID_HERE'
ORDER BY fetched_at DESC;

-- Check candidate quality
SELECT
  ec->>'title' AS title,
  ec->>'start_date' AS start_date,
  ec->>'is_valid' AS is_valid,
  ec->>'validation_errors' AS errors
FROM collector_page_cache cpc,
     jsonb_array_elements(cpc.extracted_candidates) ec
WHERE cpc.target_id = 'UUID_HERE'
LIMIT 20;
```

### Step 6: Tune Selectors (if needed)

If candidates are missing fields, adjust selectors:

```sql
UPDATE collector_targets
SET dom_selectors = jsonb_build_object(
  'event_container', '.event-item',           -- Updated selector
  'title', 'h3.title, .event-name',           -- Multiple fallbacks
  'date', '[data-date], .date-info time',     -- Data attribute + fallback
  'location', '.location, .venue',
  'description', '.summary, .excerpt',
  'link', 'a[href*="/event/"]',               -- URL pattern match
  'image', '.thumbnail img, .hero-image'
)
WHERE id = 'UUID_HERE';

-- Clear cache to re-extract
DELETE FROM collector_page_cache WHERE target_id = 'UUID_HERE';
```

### Step 7: Enable the Target

Once extraction looks good:

```sql
UPDATE collector_targets
SET is_enabled = true
WHERE id = 'UUID_HERE';
```

---

## Monitoring

### Dashboard Views

```sql
-- Target health overview
SELECT name, is_enabled, circuit_breaker,
       last_run_at, last_run_items_found,
       is_overdue, total_cached_pages
FROM v_collector_target_health
WHERE is_enabled = true;

-- Pipeline stage health (last 7 days)
SELECT stage, source_name, runs_last_7d,
       total_processed, success_rate_pct, last_status
FROM v_pipeline_stage_health
WHERE source_name = 'Web Collector' OR source_name IS NULL;

-- Ingestion activity by source
SELECT source_name, raw_pending, norm_queued,
       active_items, items_created_24h
FROM v_ingestion_activity;
```

### Health Snapshots

```sql
-- Full pipeline snapshot (JSON)
SELECT pipeline_health_snapshot();

-- Web collector specific snapshot
SELECT web_collector_health_snapshot();

-- Quick health check (table format)
SELECT * FROM quick_health_check()
WHERE status != 'ok';
```

### Recent Errors

```sql
-- Last 24 hours of errors/warnings
SELECT stage, source_name, status, items_failed,
       created_at, details_json
FROM pipeline_health_log
WHERE status != 'ok'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

---

## Circuit Breaker Recovery

Circuit breakers trip after repeated errors (401, 403, 429, or 5 consecutive failures).

### Check Circuit Breaker Status

```sql
SELECT name, circuit_breaker, consecutive_errors,
       last_run_at, robots_txt_allows_crawl
FROM collector_targets
WHERE circuit_breaker != 'closed';
```

### Diagnose the Issue

```sql
-- Check recent health logs for this target
SELECT created_at, status, details_json
FROM pipeline_health_log
WHERE source_name LIKE '%TARGET_NAME%'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 10;

-- Check page cache for HTTP errors
SELECT url, http_status, last_checked_at
FROM collector_page_cache
WHERE target_id = 'UUID_HERE'
  AND (http_status >= 400 OR http_status IS NULL)
ORDER BY last_checked_at DESC;
```

### Recovery Steps

1. **If robots.txt blocked**: Site added restrictions. Disable target or adjust paths.

2. **If rate limited (429)**: Increase delays:
   ```sql
   UPDATE collector_targets
   SET request_delay_ms = 2000,  -- Increase from 1000
       rate_limit_rpm = 10       -- Reduce from 30
   WHERE id = 'UUID_HERE';
   ```

3. **If auth required (401/403)**: Site added protection. Disable target.

4. **If parsing failures**: Update selectors (see "Tune Selectors" above).

### Reset Circuit Breaker

After fixing the issue:

```sql
SELECT reset_circuit_breaker('TARGET_UUID_HERE');

-- Verify reset
SELECT name, circuit_breaker, consecutive_errors
FROM collector_targets
WHERE id = 'UUID_HERE';
```

### Test Recovery

```bash
# Run single target to verify fix
curl -X POST $SUPABASE_URL/functions/v1/ingest-web-collector \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target_id": "UUID_HERE"}'
```

---

## Troubleshooting

### No Candidates Found

**Symptom**: `candidates_found: 0` but page was fetched

**Causes**:
1. DOM selectors don't match HTML structure
2. Page uses client-side rendering (JavaScript required)
3. Page structure changed

**Diagnosis**:
```sql
-- Check if HTML was captured
SELECT LENGTH(raw_html), extraction_strategy, extraction_errors
FROM collector_page_cache
WHERE target_id = 'UUID_HERE'
ORDER BY fetched_at DESC LIMIT 1;
```

**Solutions**:
- Update `dom_selectors` to match current HTML
- If site is JS-rendered, this target may not be compatible
- Try switching `parsing_strategy` to `jsonld` if site has Schema.org

### Valid Candidates = 0

**Symptom**: Candidates extracted but none are valid

**Cause**: Missing required fields (title, source_url, or date)

**Diagnosis**:
```sql
-- Check validation errors
SELECT
  ec->>'title' AS title,
  ec->>'start_date' AS start_date,
  ec->>'validation_errors' AS errors
FROM collector_page_cache cpc,
     jsonb_array_elements(cpc.extracted_candidates) ec
WHERE cpc.target_id = 'UUID_HERE';
```

**Solutions**:
- Update date selector to find temporal information
- Ensure title selector finds event names
- Check if events have dates on detail pages (may need to crawl deeper)

### Robots.txt Blocked

**Symptom**: `pages_blocked > 0` or `robots_txt_allows_crawl = false`

**Diagnosis**:
```sql
SELECT name, robots_txt_allows_crawl,
       LEFT(robots_txt_cache, 200) AS robots_preview
FROM collector_targets
WHERE id = 'UUID_HERE';
```

**Solutions**:
- Review robots.txt restrictions
- Adjust `allowed_paths` to only include permitted areas
- If fully blocked, disable target (compliance required)

### Target Never Runs

**Symptom**: Target is enabled but never executes

**Causes**:
1. `crawl_frequency_minutes` not elapsed since last run
2. All targets filtered out by `max_targets` limit

**Diagnosis**:
```sql
SELECT name, is_enabled, last_run_at,
       crawl_frequency_minutes,
       minutes_since_run, is_overdue
FROM v_collector_target_health
WHERE name = 'TARGET_NAME';
```

**Solutions**:
```sql
-- Reset last_run_at to force immediate run
UPDATE collector_targets
SET last_run_at = NULL
WHERE id = 'UUID_HERE';
```

---

## Maintenance Tasks

### Weekly: Review Health

```sql
-- Check for chronic issues
SELECT name, circuit_breaker, consecutive_errors,
       last_run_items_found
FROM collector_targets
WHERE is_enabled
  AND (circuit_breaker != 'closed' OR consecutive_errors > 0);

-- Review error trends
SELECT stage, COUNT(*) AS error_count
FROM pipeline_health_log
WHERE status = 'error'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY stage
ORDER BY error_count DESC;
```

### Monthly: Clean Old Cache

```sql
-- Remove stale page cache (pages not checked in 30 days)
DELETE FROM collector_page_cache
WHERE last_checked_at < NOW() - INTERVAL '30 days';

-- Clean health logs (auto-runs weekly if pg_cron enabled)
SELECT cleanup_old_health_logs(30);
```

### As Needed: Refresh Selectors

When sites update their HTML:

```sql
-- Clear cache and re-extract
DELETE FROM collector_page_cache WHERE target_id = 'UUID_HERE';

-- Update selectors (inspect site for new structure)
UPDATE collector_targets
SET dom_selectors = jsonb_build_object(...)
WHERE id = 'UUID_HERE';
```

---

## Parsing Strategy Guide

| Content Type | Strategy | Notes |
|--------------|----------|-------|
| Schema.org markup | `jsonld` | Best quality, structured data |
| iCal/ICS feed | `ics` | Direct calendar format |
| RSS/Atom feed | `rss` | News-style event lists |
| Custom HTML | `html_dom` | Requires site-specific selectors |
| Unknown/Mixed | `hybrid` | Tries JSON-LD first, falls back to DOM |

### Checking for JSON-LD

```bash
# Look for JSON-LD in page source
curl -s https://example.com/events | grep -o '<script type="application/ld+json"'
```

If found, use `jsonld` strategy (no DOM selectors needed).

### DOM Selector Tips

- Use browser DevTools to find unique selectors
- Prefer class names over nested structure
- Add fallback selectors: `'.primary-class, .fallback-class'`
- Use data attributes when available: `'[data-event-id]'`
- For dates, look for `<time datetime="...">` elements

---

## Security & Compliance

### Do NOT Add These Targets

- Facebook Events
- Instagram
- TikTok
- Any site requiring authentication
- Sites with `Disallow: /` in robots.txt
- Sites with aggressive rate limiting

### Required for Each Target

- Valid robots.txt allowing crawl
- Public event data (no login required)
- Contact email for compliance inquiries
- Reasonable crawl frequency (minimum 1 hour)

### Rate Limiting

Default settings protect against overload:
- `rate_limit_rpm`: 30 requests per minute
- `request_delay_ms`: 1000ms between requests
- `max_pages_per_run`: 50 pages maximum

Adjust conservatively for sensitive sites.

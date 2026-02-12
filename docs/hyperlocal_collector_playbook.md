# Hyperlocal Web Collector Playbook

Operational guide for the Euda web collector pipeline — adding targets, monitoring health, reviewing quarantined items, and troubleshooting.

---

## 1. Adding a New Collector Target

Insert a row into `collector_targets`. Start **disabled** (`is_enabled = false`) and test before enabling.

```sql
INSERT INTO collector_targets (
  id, name, base_url, discovery_urls, allowed_paths,
  parsing_strategy, source_id,
  town, venue_name, default_category, content_types, site_config,
  is_enabled
) VALUES (
  gen_random_uuid(),
  'Downtown Potsdam Bar',
  'https://downtownbar.example.com',
  ARRAY['/events', '/calendar'],
  ARRAY['/events', '/calendar'],
  'hybrid',
  (SELECT id FROM event_sources WHERE type = 'web_collector' LIMIT 1),
  'Potsdam',
  'Downtown Bar',
  'nightlife',
  '{events}',
  '{"timezone": "America/New_York"}'::JSONB,
  false
);
```

### Key fields

| Field | Purpose | Example |
|-------|---------|---------|
| `town` | Fallback when address parsing fails | `'Potsdam'` |
| `venue_name` | Fallback when candidate has no location | `'Downtown Bar'` |
| `default_category` | Used when keyword inference returns `'community'` | `'nightlife'` |
| `content_types` | `{events}`, `{activities}`, or `{events,activities}` — drives `kind` | `'{events}'` |
| `site_config` | Per-site tuning (see below) | `'{}'` |

### site_config options

```jsonc
{
  "timezone": "America/New_York",          // for naive datetimes
  "date_format": "MM/DD/YYYY",            // hint for ambiguous dates
  "ignore_patterns": ["^Closed", "^TBD"], // regex — skip matching titles
  "min_title_length": 5,                  // override 3-char default
  "require_location": false               // whether location is mandatory
}
```

---

## 2. Enabling / Disabling Targets

```sql
-- Enable
UPDATE collector_targets SET is_enabled = true WHERE name = 'Downtown Potsdam Bar';

-- Disable (immediate kill switch)
UPDATE collector_targets SET is_enabled = false WHERE name = 'Downtown Potsdam Bar';
```

The pipeline only processes targets where `is_enabled = true` and enough time has elapsed since the last run (`crawl_frequency_minutes`).

---

## 3. Testing a Target

Run the ingest function for a single target:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/ingest-web-collector" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target_id": "<uuid>", "dry_run": true}'
```

- `dry_run: true` — extracts candidates but doesn't insert into `event_ingest_raw`
- Check the response `summary` for `candidates_found`, `valid_candidates`, `pages_error`

Then run normalization:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/normalize-raw-events" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source_type": "web_collector", "batch_size": 5}'
```

---

## 4. Monitoring Pipeline Health

### Quick health check

```sql
SELECT * FROM quick_health_check();
```

### Dashboard views

```sql
-- Recent pipeline events
SELECT * FROM pipeline_health_dashboard ORDER BY logged_at DESC LIMIT 20;

-- Source-level summary
SELECT * FROM source_health_summary;
```

### Normalization summary fields

The normalize worker logs `auto_approved` and `quarantined` counts per run in the health log `details_json`.

---

## 5. Admin Review Queue

### In-app

Settings → Admin → Review Queue (visible only to admin users)

Each quarantined card shows:
- Title, category, town, confidence badge
- Source URL (tappable)
- Extraction method and target name
- Approve / Reject buttons

### Via SQL

```sql
-- View quarantine queue
SELECT * FROM get_quarantine_queue(20, 0);

-- Approve
SELECT approve_quarantined_item('<item-uuid>');

-- Reject with reason
SELECT reject_quarantined_item('<item-uuid>', 'duplicate_of_existing');
```

---

## 6. Blocklist Rules

Block unwanted candidates by domain, URL pattern, or title pattern.

```sql
-- Block all candidates from a domain
INSERT INTO collector_blocklist (pattern_type, pattern, reason)
VALUES ('domain', 'spam-site.com', 'Known spam domain');

-- Block URLs matching a pattern
INSERT INTO collector_blocklist (pattern_type, pattern, reason)
VALUES ('url_pattern', '/archived/', 'Old archived pages');

-- Block titles matching a regex
INSERT INTO collector_blocklist (pattern_type, pattern, reason)
VALUES ('title_pattern', '^(CANCELLED|POSTPONED)', 'Cancelled events');
```

Blocklist is loaded once per ingest run. Matching candidates are skipped and counted as `candidates_blocklisted` in the summary.

---

## 7. Troubleshooting

### Circuit breaker tripped

The circuit breaker trips when a target hits too many consecutive errors (equal to `max_pages_per_run`).

```sql
-- Check circuit breaker state
SELECT name, circuit_state, consecutive_errors, last_error
FROM collector_targets WHERE circuit_state != 'closed';

-- Reset circuit breaker
UPDATE collector_targets
SET circuit_state = 'closed', consecutive_errors = 0
WHERE id = '<target-id>';
```

### Stale items

Web-collected events that haven't been refreshed in 30 days are automatically demoted:

```sql
-- Run stale demotion manually
SELECT demote_stale_web_items(30);

-- Check demoted items
SELECT title, stale_reason, last_refreshed_at
FROM explore_items
WHERE stale_reason IS NOT NULL
ORDER BY last_refreshed_at NULLS FIRST
LIMIT 20;
```

### Low confidence items

```sql
-- See what's being quarantined
SELECT title, normalized_confidence, provenance->>'extraction_method' as method
FROM explore_items
WHERE review_status = 'quarantined'
ORDER BY created_at DESC;
```

### ETag / conditional requests

The page cache tracks `etag`, `last_modified`, and `consecutive_unchanged`. If a server supports conditional requests, re-fetches return 304 and skip re-extraction.

```sql
-- Check cache effectiveness
SELECT url, consecutive_unchanged, etag IS NOT NULL as has_etag
FROM collector_page_cache
WHERE target_id = '<target-id>'
ORDER BY consecutive_unchanged DESC;
```

---

## 8. AI Budget Management

AI description cleaning is behind a feature flag with budget guardrails:

```sql
-- Check current state
SELECT * FROM feature_flags WHERE flag_name = 'ai_description_cleaning';

-- Enable with budget
UPDATE feature_flags
SET is_enabled = true,
    config_json = '{"max_tokens_per_item": 200, "daily_budget_tokens": 50000}'
WHERE flag_name = 'ai_description_cleaning';

-- Check API usage
SELECT * FROM api_usage_counters
WHERE counter_date = CURRENT_DATE;
```

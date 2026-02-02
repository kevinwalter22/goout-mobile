# Web Collectors Framework

## Overview

Web collectors scrape public web pages (community calendars, municipal event listings) to supplement API-sourced data. They operate under strict compliance rules.

## Non-Negotiable Rules

1. **robots.txt**: Every collector checks robots.txt before fetching. If disallowed, the fetch is blocked.
2. **No captcha bypass**: Never circumvent CAPTCHAs or anti-bot measures.
3. **No stealth**: Always identify as `EudaBot/1.0` in User-Agent header.
4. **No social media**: Do not scrape Facebook, Instagram, Twitter, etc.
5. **No login-required sites**: Only fetch publicly accessible pages.
6. **Kill switch**: Every collector checks `event_sources.is_enabled` before running.
7. **Circuit breaker**: Auto-disables after 3 consecutive errors (401, 403, 429, or network failures).
8. **Rate limiting**: Minimum 1-second delay between requests to the same host.
9. **Health logging**: Every collection cycle logs to `pipeline_health_log`.

## Architecture

```
┌─────────────────────────────────────┐
│        Web Collector Function       │
│  (e.g., collect-potsdam-events)     │
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │  Preflight   │→│ robots.txt   │  │
│  │  (kill switch │  │ check       │  │
│  │   + robots)  │  └──────────────┘  │
│  └──────┬──────┘                     │
│         ↓                            │
│  ┌──────────────┐                    │
│  │  fetchPage()  │ → Circuit breaker │
│  │  + rate limit │ → Error tracking  │
│  └──────┬──────┘                    │
│         ↓                            │
│  ┌──────────────┐                    │
│  │  Parse HTML   │ → Extract events  │
│  │  + store raw  │ → Dedup by hash   │
│  └──────┬──────┘                    │
│         ↓                            │
│  ┌──────────────┐                    │
│  │  logHealth()  │ → pipeline_health │
│  └──────────────┘                    │
└─────────────────────────────────────┘
```

## Using the Framework

### 1. Create a New Collector

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WebCollector } from "../_shared/web-collector.ts";

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const collector = new WebCollector(supabase, {
    sourceName: "My Community Calendar",
    sourceType: "web_community_calendar",
    userAgent: "EudaBot/1.0 (+https://euda.app/bot)",
    maxConsecutiveErrors: 3,
    requestDelayMs: 2000,
  });

  // Pre-flight: checks kill switch + robots.txt
  const canProceed = await collector.preflight("https://example.com/events");
  if (!canProceed) {
    return collector.disabledResponse();
  }

  // Fetch page
  const html = await collector.fetchPage("https://example.com/events");
  if (!html) {
    await collector.logHealth(0, 1);
    return new Response(JSON.stringify({ error: "Fetch failed" }), {
      status: 500,
    });
  }

  // Parse and process...
  // Store in event_ingest_raw...
  // Log health...

  await collector.logHealth(itemsProcessed, itemsFailed);
  return new Response(JSON.stringify({ success: true }));
});
```

### 2. Register in Database

Add a source row (DISABLED by default):

```sql
INSERT INTO event_sources (name, type, is_enabled, config_json)
VALUES (
  'My Calendar',
  'web_community_calendar',
  false,  -- Always start disabled
  '{"base_url": "https://example.com/events"}'
);
```

### 3. Add Fetch Partition (Optional)

```sql
INSERT INTO fetch_partitions (source_id, partition_label, config_json, priority, fetch_interval_minutes)
SELECT id, 'default', '{"url": "https://example.com/events"}'::JSONB, 1, 1440  -- 24 hours
FROM event_sources WHERE name = 'My Calendar';
```

### 4. Register in Fetch Coordinator

Add to `SOURCE_FUNCTION_MAP` in `fetch-coordinator/index.ts`:

```typescript
web_community_calendar: "collect-community-events",
```

### 5. Enable After Review

```sql
UPDATE event_sources SET is_enabled = true WHERE name = 'My Calendar';
```

## Kill Switch

Disable any web collector immediately:

```sql
UPDATE event_sources SET is_enabled = false WHERE type = 'web_community_calendar';
```

The next invocation will exit cleanly without making any network requests.

## Circuit Breaker Behavior

| Consecutive Errors | Behavior |
|---|---|
| 0 | Normal operation |
| 1-2 | Log warning, continue |
| 3+ | Circuit OPEN — refuse all fetches until manual reset |

To reset after fixing the issue:

```sql
UPDATE fetch_partitions SET consecutive_errors = 0
WHERE source_id IN (SELECT id FROM event_sources WHERE type = 'web_community_calendar');
```

## Source Types

| Type | Description | Status |
|---|---|---|
| `web_community_calendar` | Municipal/community event calendars | Template (disabled) |

Add new types via migration:

```sql
ALTER TYPE event_source_type ADD VALUE 'web_my_new_source';
```

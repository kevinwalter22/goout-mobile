# Adding Event Sources

This guide explains how to add new event data sources to the ingestion pipeline.

## Architecture Overview

```
┌─────────────────┐
│  Event Source   │ (Ticketmaster, PredictHQ, Eventbrite, etc.)
│      API        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Ingest Function │ supabase/functions/ingest-{source}/
│                 │ Fetches raw data, stores in event_ingest_raw
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│event_ingest_raw │ Raw JSON stored with hash for deduplication
│     (table)     │ Auto-creates normalization job via trigger
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Normalizer    │ supabase/functions/normalize-raw-events/
│                 │ Uses source adapter to map fields
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Source Adapter  │ supabase/functions/_shared/source-adapters/
│                 │ Isolated mapping logic per source
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ explore_items   │ Normalized data queried by the app
│     (table)     │ Auto-queues for LLM enrichment
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LLM Enrichment │ supabase/functions/run-enrichment-queue/
│                 │ Generates hook_line, tags, etc.
└─────────────────┘
```

## Step-by-Step: Adding a New Source

### 1. Register the Source Type

Add your source type to the `event_source_type` enum in your database:

```sql
-- Add to existing enum (run in Supabase SQL Editor)
ALTER TYPE event_source_type ADD VALUE IF NOT EXISTS 'api_predicthq';
```

### 2. Create the Source Adapter

Create a new file: `supabase/functions/_shared/source-adapters/{source}.ts`

```typescript
/**
 * {Source} Source Adapter
 * Maps {Source} API data to explore_items schema.
 */

import type { NormalizedEvent } from "./index.ts";

/**
 * Map {Source} categories to our category system
 */
function mapCategory(data: any): { category: string | null; sub_category: string | null } {
  // Map source-specific categories to our system
  // Categories: music, sports, arts, entertainment, community, food, outdoors, nightlife
  return { category: null, sub_category: null };
}

/**
 * Map {Source} pricing to our price bucket enum
 */
function mapPriceBucket(data: any): "free" | "$" | "$$" | "$$$" | "unknown" {
  // $0 = free, <$30 = $, <$75 = $$, else $$$
  return "unknown";
}

/**
 * Extract venue/location information
 */
function extractVenue(data: any): {
  location_name: string | null;
  address: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
} {
  return {
    location_name: null,
    address: null,
    town: null,
    lat: null,
    lng: null,
  };
}

/**
 * Main normalization function
 */
export function normalize{Source}Event(raw: any): NormalizedEvent {
  const { category, sub_category } = mapCategory(raw);
  const venue = extractVenue(raw);

  return {
    kind: "event",
    title: raw.name || raw.title,
    description: raw.description || null,
    hook_line: null, // Let LLM generate

    category,
    sub_category,

    ...venue,

    starts_at: raw.start_time || null,
    ends_at: raw.end_time || null,
    schedule_text: null,
    time_text: null,
    recurrence: null,
    season: null,

    price_bucket: mapPriceBucket(raw),
    effort: "low",

    xp_value: 50,
    priority: 50,
    is_anchor: false,
    is_hidden_gem: false,

    source_url: raw.url || null,
    external_id: raw.id,
  };
}
```

### 3. Register the Adapter

Update `supabase/functions/_shared/source-adapters/index.ts`:

```typescript
import { normalize{Source}Event } from "./{source}.ts";

export const ADAPTERS: Record<string, NormalizeFunction> = {
  api_ticketmaster: normalizeTicketmasterEvent,
  api_{source}: normalize{Source}Event,  // Add your adapter
};
```

### 4. Create the Ingest Function

Create: `supabase/functions/ingest-{source}/index.ts`

```typescript
/**
 * {Source} API Ingestion
 *
 * Required secrets:
 * - {SOURCE}_API_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "https://deno.land/std@0.177.0/hash/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IngestConfig {
  lat?: number;
  lng?: number;
  radius?: number;
  days_ahead?: number;
  dry_run?: boolean;
}

function hashJson(obj: unknown): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(obj));
  return hash.toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse config
    let config: IngestConfig = {};
    if (req.method === "POST") {
      try { config = await req.json(); } catch { }
    }

    // Get API key
    const apiKey = Deno.env.get("{SOURCE}_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "{SOURCE}_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get or create source
    const { data: source } = await supabase
      .from("event_sources")
      .select("id")
      .eq("name", "{Source}")
      .single();

    const sourceId = source?.id;
    if (!sourceId) {
      throw new Error("Source not found. Run migration first.");
    }

    // Fetch from API
    const response = await fetch(`https://api.{source}.com/events?...`);
    const data = await response.json();

    const results = [];

    // Process each event
    for (const event of data.events || []) {
      const externalId = event.id;
      const rawHash = hashJson(event);

      // Check for existing unchanged record
      const { data: existing } = await supabase
        .from("event_ingest_raw")
        .select("id, raw_hash")
        .eq("source_id", sourceId)
        .eq("external_id", externalId)
        .single();

      if (existing?.raw_hash === rawHash) {
        results.push({ external_id: externalId, status: "unchanged" });
        continue;
      }

      // Upsert raw data
      const { error } = await supabase
        .from("event_ingest_raw")
        .upsert({
          source_id: sourceId,
          external_id: externalId,
          fetched_at: new Date().toISOString(),
          raw_json: event,
          raw_hash: rawHash,
          status: "new",
        }, { onConflict: "source_id,external_id" });

      results.push({
        external_id: externalId,
        status: error ? "error" : (existing ? "updated" : "inserted"),
      });
    }

    // Update last_fetch_at
    await supabase
      .from("event_sources")
      .update({ last_fetch_at: new Date().toISOString() })
      .eq("id", sourceId);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

### 5. Add Database Migration

Create: `supabase/migrations/0XX_add_{source}_source.sql`

```sql
-- Add {Source} event source
INSERT INTO event_sources (name, type, is_enabled, config_json, fetch_interval_minutes) VALUES
  ('{Source}', 'api_{source}', true, '{
    "description": "{Source} API events",
    "default_lat": 44.6697,
    "default_lng": -74.9814,
    "default_radius": 50
  }', 360)
ON CONFLICT (name) DO UPDATE SET
  is_enabled = EXCLUDED.is_enabled,
  config_json = EXCLUDED.config_json;
```

### 6. Add API Key Secret

```bash
# Via Supabase CLI
supabase secrets set {SOURCE}_API_KEY=your_api_key

# Or via Dashboard
# Project Settings > Edge Functions > Secrets
```

### 7. Set Up Scheduling

**Option A: Supabase Dashboard (Pro plan)**
- Go to Database > Scheduled Functions
- Add cron job to call your ingest function

**Option B: GitHub Actions**
```yaml
# .github/workflows/ingest-{source}.yml
name: Ingest {Source}
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - name: Call Ingest Function
        run: |
          curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/ingest-{source}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json"
```

**Option C: Vercel Cron**
```json
// vercel.json
{
  "crons": [{
    "path": "/api/trigger-ingest?source={source}",
    "schedule": "0 */6 * * *"
  }]
}
```

## Field Mapping Reference

### Required Fields

| explore_items Field | Description | Example |
|---------------------|-------------|---------|
| `title` | Event name | "Summer Concert" |
| `external_id` | Source's unique ID | "TM-12345" |
| `kind` | "event" or "activity" | "event" |

### Optional Fields

| Field | Description | Mapping Tips |
|-------|-------------|--------------|
| `description` | Full description | Concatenate info + notes |
| `hook_line` | Short tagline | Leave null for LLM |
| `category` | Main category | Map from source genres |
| `sub_category` | Specific category | Genre/type details |
| `location_name` | Venue name | venue.name |
| `address` | Street address | venue.address.line1 |
| `town` | City, State | "Potsdam, NY" |
| `lat`, `lng` | Coordinates | venue.location |
| `starts_at` | ISO datetime | "2024-03-15T19:00:00Z" |
| `ends_at` | ISO datetime | Often null |
| `price_bucket` | free/$/$$/$$$ | Based on min price |
| `effort` | low/medium/high | Usually "low" for events |
| `xp_value` | Points (0-100) | Base 50, boost for majors |
| `priority` | Sort order (0-100) | Higher = featured |
| `is_anchor` | Major event flag | Championships, headliners |
| `source_url` | Ticket/info URL | event.url |

### Category Mapping

Map source categories to our standard set:

| Our Category | Examples |
|--------------|----------|
| `music` | Concerts, festivals, DJ sets |
| `sports` | Games, matches, tournaments |
| `arts` | Theater, dance, exhibitions |
| `entertainment` | Comedy, film, shows |
| `community` | Markets, fairs, meetups |
| `food` | Tastings, food festivals |
| `outdoors` | Hikes, nature events |
| `nightlife` | Club events, bar events |

### Price Bucket Mapping

| Price Range | Bucket |
|-------------|--------|
| $0 (free admission) | `free` |
| $1 - $29 | `$` |
| $30 - $74 | `$$` |
| $75+ | `$$$` |
| Unknown | `unknown` |

## Testing Your Integration

### 1. Test Ingest Function Locally

```bash
# Start Supabase functions
supabase functions serve

# Test ingest
curl -X POST http://localhost:54321/functions/v1/ingest-{source} \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

### 2. Verify Raw Data

```sql
-- Check raw ingested data
SELECT external_id, status, raw_json->>'name' as name
FROM event_ingest_raw
WHERE source_id = (SELECT id FROM event_sources WHERE name = '{Source}')
ORDER BY fetched_at DESC
LIMIT 10;
```

### 3. Test Normalization

```bash
# Run normalizer
curl -X POST http://localhost:54321/functions/v1/normalize-raw-events \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source_type": "api_{source}", "max_items": 5}'
```

### 4. Verify Normalized Data

```sql
-- Check normalized items
SELECT title, category, starts_at, town, price_bucket
FROM explore_items
WHERE source_id = (SELECT id FROM event_sources WHERE name = '{Source}')
ORDER BY created_at DESC
LIMIT 10;
```

### 5. Check Enrichment Queue

```sql
-- Items waiting for LLM enrichment
SELECT ei.title, eq.status, eq.priority
FROM enrichment_queue eq
JOIN explore_items ei ON ei.id = eq.explore_item_id
WHERE eq.status = 'queued'
ORDER BY eq.priority DESC;
```

## Monitoring

### Ingestion Stats

```sql
SELECT * FROM get_ingestion_stats();
```

### Sources Due for Fetch

```sql
SELECT * FROM get_sources_due_for_fetch();
```

### Failed Jobs

```sql
-- Failed normalization jobs
SELECT j.*, r.external_id, r.raw_json->>'name' as name
FROM event_normalization_jobs j
JOIN event_ingest_raw r ON r.id = j.raw_id
WHERE j.status = 'failed'
ORDER BY j.updated_at DESC;
```

## Existing Adapters

| Source | Type | Status | Notes |
|--------|------|--------|-------|
| Ticketmaster | `api_ticketmaster` | ✅ Active | Discovery API v2 |
| PredictHQ | `api_predicthq` | 🚧 Planned | Attended events |
| Eventbrite | `api_eventbrite` | 🚧 Planned | Local events |
| Yelp | `api_yelp` | 🚧 Planned | Activities/places |
| Google Places | `api_google_places` | 🚧 Planned | Activities/places |
| Manual CSV | `curated_csv` | ✅ Active | Local curation |

## Best Practices

1. **Idempotent Ingestion**: Always use hash comparison to avoid duplicates
2. **Rate Limiting**: Respect API rate limits with delays between requests
3. **Error Handling**: Store errors in `last_error` for debugging
4. **Isolated Adapters**: Keep mapping logic in separate files
5. **LLM Enrichment**: Leave `hook_line` null to let LLM generate quality content
6. **Priority Scoring**: Set higher priority for anchor events (concerts, sports)
7. **Testing**: Always test with `dry_run: true` first

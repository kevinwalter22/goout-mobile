# Event Ingestion Architecture

This document describes the event ingestion system for the Euda app's Explore feature.

## Overview

The architecture follows a **Source → Ingest → Normalize → Serve** pipeline:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Event Sources  │────▶│  Raw Ingestion   │────▶│  Normalization  │────▶│ explore_items│
│  (APIs, CSVs)   │     │  (event_ingest_  │     │  (jobs queue)   │     │ (app reads)  │
│                 │     │   raw)           │     │                 │     │              │
└─────────────────┘     └──────────────────┘     └─────────────────┘     └──────────────┘
```

## Database Tables

### 1. `event_sources`

Registry of all data sources for event ingestion.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Unique source name |
| type | ENUM | Source type (api_ticketmaster, curated_csv, etc.) |
| is_enabled | BOOLEAN | Whether source is active |
| config_json | JSONB | Source-specific configuration |
| last_fetch_at | TIMESTAMPTZ | Last successful fetch time |
| fetch_interval_minutes | INTEGER | How often to fetch (default: 60) |

**Source Types:**
- `curated_csv` - Manual CSV imports
- `api_ticketmaster` - Ticketmaster Discovery API
- `api_predicthq` - PredictHQ Events API
- `api_eventbrite` - Eventbrite API
- `api_yelp` - Yelp Fusion API
- `api_google_places` - Google Places API
- `manual` - Manually entered events

### 2. `event_ingest_raw`

Raw ingested data before normalization. Stores the original API response.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| source_id | UUID | FK to event_sources |
| external_id | TEXT | ID from the source system |
| fetched_at | TIMESTAMPTZ | When data was fetched |
| raw_json | JSONB | Original API response |
| raw_hash | TEXT | SHA256 for deduplication |
| status | ENUM | new, normalized, failed, skipped |
| last_error | TEXT | Error message if failed |

**Unique Constraint:** `(source_id, external_id)` - prevents duplicate imports

### 3. `explore_items`

Canonical table queried by the app. Contains normalized, clean data.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| source_id | UUID | FK to event_sources (nullable) |
| external_id | TEXT | Original source ID |
| kind | ENUM | 'event' or 'activity' |
| title | TEXT | Display title |
| description | TEXT | Full description |
| hook_line | TEXT | Short catchy text for cards |
| category | TEXT | Main category |
| sub_category | TEXT | Sub-category |
| location_name | TEXT | Venue/place name |
| address | TEXT | Street address |
| town | TEXT | City/town name |
| lat | FLOAT8 | Latitude |
| lng | FLOAT8 | Longitude |
| starts_at | TIMESTAMPTZ | Start time (nullable for activities) |
| ends_at | TIMESTAMPTZ | End time |
| schedule_text | TEXT | Human-readable schedule |
| time_text | TEXT | Time of day (Morning, Evening) |
| recurrence | TEXT | Recurrence pattern |
| season | TEXT | Seasonal availability |
| price_bucket | ENUM | free, $, $$, $$$, unknown |
| effort | ENUM | low, medium, high, unknown |
| xp_value | INTEGER | XP earned for check-in |
| priority | INTEGER | Sort priority |
| is_anchor | BOOLEAN | Major/featured event |
| is_hidden_gem | BOOLEAN | Local favorite |
| source_url | TEXT | Link to original listing |
| normalized_confidence | INTEGER | 0-100 quality score |

### 4. `event_normalization_jobs`

Job queue for processing raw data into normalized items.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| raw_id | UUID | FK to event_ingest_raw |
| status | ENUM | queued, running, done, failed |
| attempts | INTEGER | Number of attempts |
| max_attempts | INTEGER | Max retries (default: 3) |
| last_error | TEXT | Error message if failed |
| started_at | TIMESTAMPTZ | When processing started |
| completed_at | TIMESTAMPTZ | When processing finished |

## Security (RLS Policies)

| Table | Authenticated Users | Service Role |
|-------|---------------------|--------------|
| event_sources | No access | Full access |
| event_ingest_raw | No access | Full access |
| explore_items | **Read only** | Full access |
| event_normalization_jobs | No access | Full access |

The app only reads from `explore_items`. All ingestion and normalization is done server-side with the service role.

## Indexes

Optimized for common app queries:

- `explore_items(starts_at)` - Upcoming events
- `explore_items(town)` - Location filtering
- `explore_items(category)` - Category filtering
- `explore_items(lat, lng)` - Geo queries
- `explore_items(town, starts_at)` - Combined location + time
- `explore_items(priority)` - Featured/sorted lists

## Adding a New Source

### 1. Register the Source

```sql
INSERT INTO event_sources (name, type, config_json)
VALUES (
  'Ticketmaster NYC',
  'api_ticketmaster',
  '{
    "api_key_env": "TICKETMASTER_API_KEY",
    "market_id": "35",
    "radius": 25,
    "unit": "miles"
  }'
);
```

### 2. Implement the Fetcher

Create a fetcher function that:
1. Reads source config from `event_sources`
2. Calls the external API
3. Inserts raw data into `event_ingest_raw`

```typescript
async function fetchTicketmasterEvents(sourceId: string) {
  const { data: source } = await supabase
    .from('event_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  const apiKey = process.env[source.config_json.api_key_env];
  const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events?apikey=${apiKey}&...`);
  const events = await response.json();

  for (const event of events._embedded?.events || []) {
    const rawHash = sha256(JSON.stringify(event));

    await supabase.from('event_ingest_raw').upsert({
      source_id: sourceId,
      external_id: event.id,
      raw_json: event,
      raw_hash: rawHash,
      status: 'new'
    }, {
      onConflict: 'source_id,external_id'
    });
  }
}
```

### 3. Implement the Normalizer

Create a normalizer that transforms raw data into `explore_items`:

```typescript
async function normalizeTicketmasterEvent(rawData: any): Promise<ExploreItem> {
  const event = rawData.raw_json;

  return {
    source_id: rawData.source_id,
    external_id: rawData.external_id,
    kind: 'event',
    title: event.name,
    description: event.info || event.pleaseNote,
    hook_line: event.promoter?.description,
    category: mapTicketmasterCategory(event.classifications?.[0]),
    location_name: event._embedded?.venues?.[0]?.name,
    address: event._embedded?.venues?.[0]?.address?.line1,
    town: event._embedded?.venues?.[0]?.city?.name,
    lat: parseFloat(event._embedded?.venues?.[0]?.location?.latitude),
    lng: parseFloat(event._embedded?.venues?.[0]?.location?.longitude),
    starts_at: event.dates?.start?.dateTime,
    price_bucket: mapPriceBucket(event.priceRanges),
    source_url: event.url,
    normalized_confidence: 85
  };
}
```

### 4. Process the Job Queue

Use the helper functions to process jobs:

```typescript
async function processNormalizationJobs() {
  while (true) {
    // Claim next job atomically
    const { data: job } = await supabase.rpc('claim_normalization_job');

    if (!job || job.length === 0) break;

    try {
      const normalized = await normalizeEvent(job[0]);

      await supabase.from('explore_items').upsert(normalized, {
        onConflict: 'source_id,external_id'
      });

      await supabase.rpc('complete_normalization_job', {
        p_job_id: job[0].job_id,
        p_success: true
      });
    } catch (error) {
      await supabase.rpc('complete_normalization_job', {
        p_job_id: job[0].job_id,
        p_success: false,
        p_error: error.message
      });
    }
  }
}
```

## Data Flow Example

```
1. Cron job triggers Ticketmaster fetch
   ↓
2. Raw API response stored in event_ingest_raw
   ↓
3. Trigger auto-creates normalization job (status: 'queued')
   ↓
4. Worker calls claim_normalization_job() (status: 'running')
   ↓
5. Worker normalizes data, inserts into explore_items
   ↓
6. Worker calls complete_normalization_job() (status: 'done')
   ↓
7. App queries explore_items for display
```

## Category Mapping

Recommended category values for consistency:

| Category | Description |
|----------|-------------|
| music | Concerts, live music, DJ sets |
| sports | Games, matches, athletic events |
| arts | Theater, galleries, performances |
| food | Food festivals, tastings, markets |
| outdoors | Hiking, parks, outdoor activities |
| nightlife | Bars, clubs, late-night events |
| community | Meetups, volunteering, local gatherings |
| education | Workshops, classes, lectures |
| family | Kid-friendly events and activities |
| wellness | Yoga, meditation, fitness classes |

## Price Bucket Guidelines

| Bucket | Typical Price Range |
|--------|---------------------|
| free | $0 |
| $ | $1 - $25 |
| $$ | $26 - $75 |
| $$$ | $76+ |
| unknown | Price not available |

## Future Enhancements

1. **PostGIS Integration** - Replace lat/lng numeric indexes with proper geospatial indexes
2. **AI Normalization** - Use LLM for better category mapping and hook_line generation
3. **Deduplication** - Cross-source event matching to prevent duplicates
4. **Quality Scoring** - Automated confidence scoring based on data completeness
5. **Real-time Updates** - Webhook support for sources that provide them

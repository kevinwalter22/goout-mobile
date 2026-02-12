# Google Places API — Setup Guide

## Overview

The Google Places API (New) provides evergreen activity data — restaurants, cafes, parks, gyms, museums, and other local businesses/attractions. Unlike event APIs, Places data represents permanent or semi-permanent locations with opening hours, ratings, and price levels.

This is the **dense baseline** of the Explore tab: always-available local activities.

## APIs Used

### 1. Nearby Search (Phase 1)

- **Endpoint**: `POST https://places.googleapis.com/v1/places:searchNearby`
- **Max results**: 20 per request
- **No pagination**: Each request returns up to 20 results, no page token
- **Strategy**: One request per `includedType` per region

### 2. Text Search (Phase 2)

- **Endpoint**: `POST https://places.googleapis.com/v1/places:searchText`
- **Max results**: 20 per page, up to 60 total (3 pages via `pageToken`)
- **Strategy**: One keyword per region, with pagination for discovery gaps

### 3. Place Details (Lazy, on-demand)

- **Endpoint**: `GET https://places.googleapis.com/v1/places/{placeId}`
- **Called only** when a user views an item's detail page
- **Cached** in `place_details_cache` for 30 days

## Setup Steps

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable billing (required for Places API)

### 2. Enable the Places API (New)

1. Go to **APIs & Services > Library**
2. Search for "Places API (New)"
3. Click **Enable**

> **Important**: Enable "Places API (New)", NOT the legacy "Places API". The new API uses different endpoints and pricing.

### 3. Create an API Key

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > API Key**
3. Restrict the key:
   - **Application restrictions**: None (Edge Function runs server-side)
   - **API restrictions**: Restrict to "Places API (New)" only

### 4. Set the Secret in Supabase

```bash
# Via Supabase CLI
npx supabase secrets set GOOGLE_PLACES_API_KEY=your_api_key_here

# Or via Supabase Dashboard:
# Project Settings > Edge Functions > Add Secret
# Name: GOOGLE_PLACES_API_KEY
# Value: your_api_key_here
```

### 5. Apply Migrations

Apply in order via SQL Editor:

1. **037** — Google Places source row + fetch partition
2. **041** — Fix normalization trigger for UPDATE (idempotent re-ingest)
3. **042** — API usage counters (budget guardrail)
4. **043** — Place details cache (lazy detail loading)

### 6. Deploy Edge Functions

```bash
npx supabase functions deploy ingest-google-places
npx supabase functions deploy fetch-place-details
npx supabase functions deploy normalize-raw-events
```

### 7. Test

```bash
# Dry run — no DB writes
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/ingest-google-places \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true, "max_total_requests": 5}'
```

## Multi-Region Configuration

The ingestion function supports multiple search centers. By default it covers:

| Region | Lat | Lng | Radius |
|--------|-----|-----|--------|
| Potsdam | 44.6697 | -74.9814 | 25 km |
| Canton | 44.5956 | -75.1690 | 25 km |

Together these cover a roughly 20-mile radius around both towns with overlap for continuity.

### Custom regions via request body:

```json
{
  "regions": [
    { "name": "potsdam", "lat": 44.6697, "lng": -74.9814, "radius_m": 25000 },
    { "name": "canton", "lat": 44.5956, "lng": -75.1690, "radius_m": 25000 },
    { "name": "ogdensburg", "lat": 44.6942, "lng": -75.4863, "radius_m": 15000 }
  ]
}
```

### Legacy single-center (still supported):

```json
{
  "lat": 44.6697,
  "lng": -74.9814,
  "radius_meters": 50000
}
```

## Included Types (35 total)

| Category | Types |
|---|---|
| Food & Drink | `restaurant`, `cafe`, `bar`, `bakery`, `meal_takeaway` |
| Fitness & Wellness | `gym`, `spa`, `yoga_studio`, `swimming_pool` |
| Outdoor | `park`, `campground`, `marina` |
| Arts & Culture | `museum`, `library`, `art_gallery` |
| Entertainment | `movie_theater`, `bowling_alley`, `amusement_park`, `aquarium`, `performing_arts_theater`, `stadium` |
| Nightlife | `night_club` |
| Winter/Seasonal | `ice_skating_rink`, `ski_resort` |
| Sport | `golf_course` |
| Heritage & Community | `historical_landmark`, `visitor_center`, `community_center`, `church` |
| Shopping | `shopping_mall`, `book_store`, `clothing_store`, `florist`, `pet_store` |
| Accommodation | `lodging` |
| Attractions | `tourist_attraction` |

## Text Search Keywords (15)

Discovery keywords cover gaps that type-based Nearby Search misses:

`hiking trail`, `trailhead`, `brewery`, `winery`, `farm stand`, `farmers market`, `scenic overlook`, `swimming hole`, `canoe kayak launch`, `disc golf`, `mini golf`, `escape room`, `axe throwing`, `thrift store`, `antique shop`

Text Search supports pagination (up to 3 pages / 60 results per keyword per region).

## Budget Guardrail

Monthly request limits are enforced via `api_usage_counters` (migration 042):

- **Default limit**: 10,000 requests/month for `google_places`
- **Per-run ceiling**: `max_total_requests` (default 200)
- **Enforcement**: The ingestion function checks budget before starting and after each API call
- **Atomic**: Uses `increment_api_usage()` PostgreSQL function for safe concurrent access

### Check budget:

```sql
SELECT * FROM get_api_budget('google_places');
```

### Adjust limit:

```sql
UPDATE api_usage_counters
SET requests_limit = 15000
WHERE service = 'google_places'
  AND period_start = date_trunc('month', CURRENT_DATE)::DATE;
```

### Reset counter (e.g., after testing):

```sql
UPDATE api_usage_counters
SET requests_used = 0
WHERE service = 'google_places'
  AND period_start = date_trunc('month', CURRENT_DATE)::DATE;
```

## Idempotent Ingestion

The ingestion pipeline is strictly idempotent:

1. **Place ID as key**: `external_id = place.id` (Google's unique identifier)
2. **SHA256 hash**: Stable sorted-key JSON serialization detects actual data changes
3. **Batch hash comparison**: All existing hashes loaded into memory before upsert
4. **Three outcomes**: `inserted` (new), `updated` (data changed), `unchanged` (skip)
5. **Normalization trigger**: Migration 041 fires on both INSERT and UPDATE of `event_ingest_raw`

Re-running ingestion produces zero duplicate records.

## Lazy Place Details

Place Details are fetched on-demand, not during ingestion:

1. User opens an event/activity detail page
2. Client calls `fetch-place-details` edge function
3. Function checks `place_details_cache` table
4. If cache miss or expired (>30 days), calls Google Places Details API
5. Caches the result and returns it

### What's fetched on-demand:
- Phone number
- Website URI
- Google Maps link
- Photos (up to 5)
- Reviews (up to 5)
- Full opening hours
- Rating and review count

### Cost: ~$0.017 per Detail fetch, only for items users actually view.

## Pricing

| API | Cost per request | Usage pattern |
|---|---|---|
| Nearby Search (Atmosphere fields) | $0.035 | Per type per region per fetch cycle |
| Text Search (Atmosphere fields) | $0.035 | Per keyword per region per fetch cycle |
| Place Details | $0.017 | On-demand per user view (cached 30 days) |

### Estimated Monthly Cost (ingestion only)

- **35 types x 2 regions = 70 Nearby requests per cycle**
- **15 keywords x 2 regions x ~2 pages = 60 Text requests per cycle**
- **Total per cycle: ~130 requests**
- **4 cycles/day x 30 days = ~15,600 requests/month** (capped at 10,000 by budget guardrail)
- At $0.035/request = **~$350/month** uncapped
- With 10,000/month budget: **~$350** at full rate, offset by **$200/month free credit** = **~$150/month**
- Place Details: variable, pay-per-view

> Adjust budget via `api_usage_counters` to control costs.

## Kill Switch

To disable Google Places ingestion:

```sql
UPDATE event_sources SET is_enabled = false WHERE type = 'api_google_places';
```

To re-enable:

```sql
UPDATE event_sources SET is_enabled = true WHERE type = 'api_google_places';
UPDATE fetch_partitions SET is_enabled = true
  WHERE source_id IN (SELECT id FROM event_sources WHERE type = 'api_google_places');
```

## Field Mask (Ingestion)

```
places.id,places.displayName,places.types,places.formattedAddress,
places.location,places.priceLevel,places.rating,places.userRatingCount,
places.regularOpeningHours,places.websiteUri,places.editorialSummary,
places.primaryType,places.primaryTypeDisplayName,places.googleMapsUri
```

## Field Mask (Place Details — on-demand)

```
id,displayName,formattedAddress,websiteUri,nationalPhoneNumber,
googleMapsUri,photos,reviews,regularOpeningHours,editorialSummary,
rating,userRatingCount,priceLevel
```

## References

- [Places API (New) Overview](https://developers.google.com/maps/documentation/places/web-service/overview)
- [Nearby Search (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details)
- [Place Types](https://developers.google.com/maps/documentation/places/web-service/place-types)
- [Pricing](https://developers.google.com/maps/billing-and-pricing/pricing)

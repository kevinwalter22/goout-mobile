# Google Places API — Setup Guide

## Overview

The Google Places API (New) provides evergreen activity data — restaurants, cafes, parks, gyms, museums, and other local businesses/attractions. Unlike event APIs, Places data represents permanent or semi-permanent locations with opening hours, ratings, and price levels.

This is the **dense baseline** of the Explore tab: always-available local activities.

## API: Places API (New) — Nearby Search

- **Endpoint**: `POST https://places.googleapis.com/v1/places:searchNearby`
- **Auth**: API key via `X-Goog-Api-Key` header
- **Max results**: 20 per request
- **No pagination**: Each request returns up to 20 results, no page token
- **Strategy**: Iterate over `includedTypes` (one type per request) for comprehensive coverage

## Setup Steps

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable billing (required for Places API)

### 2. Enable the Places API (New)

1. Go to **APIs & Services → Library**
2. Search for "Places API (New)"
3. Click **Enable**

> **Important**: Enable "Places API (New)", NOT the legacy "Places API". The new API uses different endpoints and pricing.

### 3. Create an API Key

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → API Key**
3. Restrict the key:
   - **Application restrictions**: None (Edge Function runs server-side)
   - **API restrictions**: Restrict to "Places API (New)" only

### 4. Set the Secret in Supabase

```bash
# Via Supabase CLI
npx supabase secrets set GOOGLE_PLACES_API_KEY=your_api_key_here

# Or via Supabase Dashboard:
# Project Settings → Edge Functions → Add Secret
# Name: GOOGLE_PLACES_API_KEY
# Value: your_api_key_here
```

### 5. Deploy the Edge Function

```bash
npx supabase functions deploy ingest-google-places
```

### 6. Apply the Migration

Run `supabase/migrations/037_add_google_places_source.sql` in the SQL Editor to create the source row and fetch partition.

### 7. Test

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/ingest-google-places \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"included_types": ["restaurant"], "dry_run": true}'
```

## Pricing

Google Places API (New) uses SKU-based pricing:

| Field Category | Cost per request | Our usage |
|---|---|---|
| Basic (id, types, displayName, address, location) | $0.00 (free tier) | Always |
| Contact (websiteUri) | Included in Atmosphere | Always |
| Atmosphere (rating, priceLevel, openingHours, editorialSummary) | $0.035 per request | Always |

### Estimated Monthly Cost

- **17 place types × 1 request each × 1 fetch per 6 hours × 4 fetches/day × 30 days**
- = 17 × 4 × 30 = **2,040 requests/month**
- At $0.035/request = **~$71/month** at full rate
- Google provides **$200/month free credit** → **$0/month** for our usage level

> The free $200/month credit covers up to ~5,700 Atmosphere requests. We use ~2,040.

## Rate Limits

- Default: 600 requests per minute
- Our usage: ~17 requests per fetch cycle (one per type)
- No rate limit concerns at this scale

## Configuration

The source is configured via `event_sources.config_json` and `fetch_partitions.config_json`:

```json
{
  "lat": 44.6697,
  "lng": -74.9814,
  "radius_meters": 50000,
  "included_types": [
    "restaurant", "cafe", "bar", "bakery",
    "gym", "spa",
    "park", "campground",
    "museum", "library", "art_gallery",
    "movie_theater", "bowling_alley",
    "night_club",
    "shopping_mall", "book_store",
    "tourist_attraction"
  ]
}
```

### Included Types

| Category | Types |
|---|---|
| Food & Drink | `restaurant`, `cafe`, `bar`, `bakery` |
| Fitness | `gym`, `spa` |
| Outdoor | `park`, `campground` |
| Arts & Culture | `museum`, `library`, `art_gallery` |
| Entertainment | `movie_theater`, `bowling_alley` |
| Nightlife | `night_club` |
| Shopping | `shopping_mall`, `book_store` |
| Attractions | `tourist_attraction` |

To add or remove types, update `config_json` on the fetch partition:

```sql
UPDATE fetch_partitions
SET config_json = config_json || '{"included_types": ["restaurant", "cafe"]}'::JSONB
WHERE partition_label = 'potsdam-activities'
  AND source_id IN (SELECT id FROM event_sources WHERE type = 'api_google_places');
```

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

## Field Mask

We request the following fields from the API:

```
places.id,places.displayName,places.types,places.formattedAddress,
places.location,places.priceLevel,places.rating,places.userRatingCount,
places.regularOpeningHours,places.websiteUri,places.editorialSummary,
places.primaryType,places.primaryTypeDisplayName,places.googleMapsUri
```

## References

- [Places API (New) Overview](https://developers.google.com/maps/documentation/places/web-service/overview)
- [Nearby Search (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Place Types](https://developers.google.com/maps/documentation/places/web-service/place-types)
- [Pricing](https://developers.google.com/maps/billing-and-pricing/pricing)

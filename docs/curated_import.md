# Curated Events Import

This document explains how to import the curated Potsdam events/activities CSV into the Euda database.

## Overview

The import script reads the master CSV file and populates:
- `event_ingest_raw` - Raw CSV rows for traceability
- `explore_items` - Normalized data for the app

## Prerequisites

1. **Database migrations applied** - Run migration `017_event_ingestion_architecture.sql` first
2. **Service role key** - You need the Supabase service role key (not the anon key)
3. **Dependencies installed** - Run `npm install` to get csv-parse, dotenv, and ts-node

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create or update `.env.local` with your service role key:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...your-service-role-key...
```

> **Important:** The service role key bypasses RLS. Never commit it to git or expose it in the app.

You can find your service role key in:
Supabase Dashboard → Settings → API → `service_role` (secret)

## Running the Import

```bash
npm run import:events
```

Or directly:

```bash
npx ts-node scripts/import_curated_events.ts
```

## What It Does

### Source File

Reads: `src/types/Euda_Potsdam_Master_Database(Events Master).csv`

### Normalization Rules

| CSV Field | Target Field | Transformation |
|-----------|--------------|----------------|
| ID | external_id | Prefixed with `csv_` |
| Event Name | title | Trimmed, cleaned |
| Category | category | Trimmed |
| Sub-Category | sub_category | Trimmed |
| Hook Line | hook_line | Trimmed, cleaned |
| Location | location_name | Trimmed |
| Address | address | Trimmed |
| Longitude and Latitude | lat, lng | Parsed (see below) |
| Town | town | Trimmed |
| Schedule | schedule_text | Stored as-is |
| Time | time_text | Stored as-is |
| Recurrence | recurrence | Stored as-is |
| Season | season | Stored as-is |
| Est. Cost | price_bucket | Mapped to enum |
| Effort | effort | Mapped to enum |
| User Tips | description | Used as description |
| XP Value | xp_value | Parsed as integer |
| Is Anchor | is_anchor | Parsed as boolean |
| Is Hidden Gem | is_hidden_gem | Parsed as boolean |
| Priority (1-5) | priority | Parsed as integer |
| Audit_Confidence | normalized_confidence | Mapped to 0-100 |

### Lat/Lng Parsing

Handles multiple formats:
- `"44.19661528761782, -74.87251709305421"` (comma-separated)
- `"43.656012 -74.832907"` (space-separated)
- Empty values → `null`

### Price Bucket Mapping

| CSV Value | Enum Value |
|-----------|------------|
| Free, $0, free+rental | `free` |
| $ | `$` |
| $$ | `$$` |
| $$$ or more | `$$$` |
| Other/empty | `unknown` |

### Effort Mapping

| CSV Value | Enum Value |
|-----------|------------|
| Low, Easy | `low` |
| Medium, Moderate | `medium` |
| High, Hard, Difficult | `high` |
| Other/empty | `unknown` |

### Confidence Mapping

| CSV Value | Score |
|-----------|-------|
| HIGH | 90 |
| MEDIUM | 70 |
| LOW | 40 |
| FLAG | 30 |
| Other | 50 |

## Import Report

The script outputs a summary:

```
============================================================
IMPORT REPORT
============================================================
Total rows in CSV:     150
Skipped (empty):       5
Inserted:              120
Updated:               25
Failed:                0
------------------------------------------------------------
Missing lat/lng:       12
Missing category:      3
============================================================

✓ Import completed successfully!
```

## Idempotency

The script is safe to re-run:
- Uses `upsert` with unique constraint `(source_id, external_id)`
- Existing rows are updated, not duplicated
- Tracks "inserted" vs "updated" in the report

## Troubleshooting

### "Missing required environment variables"

Ensure `.env.local` has both:
- `EXPO_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### "Failed to create event source"

The `event_sources` table may not exist. Run migration `017_event_ingestion_architecture.sql`.

### "Row X: ... permission denied"

You're using the anon key instead of service role key. Check `SUPABASE_SERVICE_ROLE_KEY`.

### Import succeeded but data not showing in app

1. Check that `explore_items` has data in Supabase Dashboard
2. Update the app to query `explore_items` instead of `events`
3. Verify RLS policy allows authenticated reads

## Adding New CSV Data

1. Add rows to the CSV file
2. Re-run `npm run import:events`
3. New rows are inserted, existing rows are updated based on ID

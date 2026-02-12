# Euda As-Built Architecture Report

> Generated 2026-01-29 from full codebase audit.
> This document describes what is **actually implemented**, not what is planned.

---

## 1. System Overview

Euda is an Expo (React Native) + Supabase mobile app centered on local activity discovery, social check-ins, and gamification. The system ingests event data from external APIs, normalizes it, enriches it via LLM, and serves it through a filter-driven explore UI.

```
User Device (Expo/RN)
    |
    v
Supabase (PostgreSQL + Auth + Storage + Edge Functions)
    |
    +-- Auth (email/password, OAuth)
    +-- Database (explore_items, posts, profiles, friendships, ...)
    +-- Storage (posts bucket - check-in photos)
    +-- Edge Functions (Deno)
         +-- ingest-ticketmaster
         +-- normalize-raw-events
         +-- enrich-explore-item
         +-- run-enrichment-queue
         +-- cleanup-orphaned-media
    |
    +-- External APIs
         +-- Ticketmaster Discovery API
         +-- Anthropic Claude API (enrichment)
         +-- OpenAI API (enrichment fallback)
```

---

## 2. Database Schema

### 2.1 Custom Enums

| Enum | Values |
|------|--------|
| `event_source_type` | `curated_csv`, `api_ticketmaster`, `api_predicthq`, `api_eventbrite`, `api_yelp`, `api_google_places`, `manual` |
| `ingest_status` | `new`, `normalized`, `failed`, `skipped` |
| `explore_item_kind` | `event`, `activity` |
| `price_bucket` | `free`, `$`, `$$`, `$$$`, `unknown` |
| `effort_level` | `low`, `medium`, `high`, `unknown` |
| `job_status` | `queued`, `running`, `done`, `failed` |

### 2.2 Tables

#### `profiles`
- **Migration**: 001, 012, 014
- **Purpose**: User profiles linked to Supabase Auth
- **Columns**: `id` (UUID, FK->auth.users), `username` (TEXT UNIQUE), `created_at`, `updated_at`, `xp` (INT DEFAULT 0), `streak` (INT DEFAULT 0), `last_post_date` (DATE), `avatar_url` (TEXT), `bio` (TEXT)
- **Trigger**: Auto-creates profile on auth.users INSERT via `handle_new_user()`
- **RLS**: Users read own + accepted friends' profiles; update own only; secure `search_profiles()` RPC for search (migration 024)

#### `events` (LEGACY)
- **Migration**: 001
- **Purpose**: Original events table, pre-ingestion architecture. Still referenced by posts.
- **Columns**: `id`, `title`, `starts_at`, `venue_name`, `city`, `category`, `latitude`, `longitude`
- **Status**: Deprecated. No new events written here. Legacy posts still FK to it.

#### `event_rsvps` (LEGACY)
- **Migration**: 002
- **Purpose**: RSVPs for legacy events table
- **Columns**: `id`, `user_id` (FK->auth.users), `event_id` (FK->events), `created_at`
- **RLS**: Authenticated read; own insert/delete

#### `posts`
- **Migration**: 003, 004, 023, 026
- **Purpose**: User check-in posts with dual-camera photos
- **Columns**: `id`, `user_id` (FK->auth.users), `event_id` (FK->events, NULLABLE), `explore_item_id` (FK->explore_items, NULLABLE), `caption`, `photo_path`, `front_photo_path`, `camera_mode` (front/back/dual), `latitude`, `longitude`, `created_at`
- **Design**: Both `event_id` and `explore_item_id` can be NULL (standalone posts allowed)
- **RLS**: Authenticated read; own insert/delete
- **Trigger**: `award_xp_on_post()` - awards 10 XP on post creation

#### `post_reactions`
- **Migration**: 010
- **Purpose**: Emoji reactions on posts
- **Columns**: `id`, `post_id` (FK->posts), `user_id` (FK->auth.users), `emoji` (TEXT), `created_at`
- **Constraint**: UNIQUE(post_id, user_id, emoji)
- **RLS**: Authenticated read; own insert/delete

#### `post_comments`
- **Migration**: 010
- **Purpose**: Text comments on posts
- **Columns**: `id`, `post_id` (FK->posts), `user_id` (FK->auth.users), `content` (TEXT NOT NULL), `created_at`
- **RLS**: Authenticated read; own insert/delete

#### `friendships`
- **Migration**: 011, 013
- **Purpose**: Bidirectional friend relationships with request flow
- **Columns**: `id`, `user_id` (FK->auth.users), `friend_id` (FK->auth.users), `status` (pending/accepted/declined), `created_at`
- **Constraint**: UNIQUE(user_id, friend_id), CHECK(user_id != friend_id)
- **RLS**: Authenticated read own friendships; own insert; update own (status changes)

#### `event_sources`
- **Migration**: 017
- **Purpose**: Registry of data sources with scheduling metadata
- **Columns**: `id`, `name` (UNIQUE), `type` (event_source_type), `is_enabled`, `config_json` (JSONB), `fetch_interval_minutes`, `last_fetch_at`, `created_at`, `updated_at`
- **RLS**: service_role only (no client access)
- **Seed data**: "Potsdam Curated" (curated_csv) + "Ticketmaster" (api_ticketmaster) added in migrations 017/020

#### `event_ingest_raw`
- **Migration**: 017
- **Purpose**: Append-only log of raw ingested data from external sources
- **Columns**: `id`, `source_id` (FK->event_sources), `external_id`, `fetched_at`, `raw_json` (JSONB), `raw_hash` (TEXT), `status` (ingest_status), `last_error`, `created_at`
- **Constraint**: UNIQUE(source_id, external_id)
- **Trigger**: `auto_queue_normalization()` - auto-creates normalization job on INSERT
- **RLS**: service_role only

#### `event_normalization_jobs`
- **Migration**: 017
- **Purpose**: Queue for converting raw data to explore_items
- **Columns**: `id`, `raw_id` (FK->event_ingest_raw, UNIQUE), `status` (job_status), `attempts`, `max_attempts` (DEFAULT 3), `last_error`, `started_at`, `completed_at`, `created_at`, `updated_at`
- **RLS**: service_role only

#### `explore_items`
- **Migration**: 017, 018, 021, 023 (upgrade)
- **Purpose**: Canonical table for all events and activities served to the app
- **Core columns**: `id`, `kind` (explore_item_kind), `title`, `description`, `hook_line`
- **Categorization**: `category`, `sub_category`
- **Location**: `location_name`, `address`, `town`, `lat` (FLOAT), `lng` (FLOAT)
- **Timing**: `starts_at` (TIMESTAMPTZ), `ends_at`, `schedule_text`, `time_text`, `recurrence`, `season`
- **Enrichment**: `tags` (TEXT[]), `availability_json` (JSONB), `llm_enriched_at` (TIMESTAMPTZ)
- **Pricing/effort**: `price_bucket` (price_bucket), `effort` (effort_level)
- **Gamification**: `xp_value` (INT), `priority` (INT), `is_anchor` (BOOL), `is_hidden_gem` (BOOL)
- **Source tracking**: `source_url`, `source_id` (FK->event_sources), `external_id`
- **Constraint**: UNIQUE(source_id, external_id)
- **Indexes**: GIN on `tags`, GIN on `availability_json`, btree on `(availability_json->>'type')`, btree on `category`, btree on `starts_at`
- **RLS**: Authenticated SELECT granted (migration 023)

#### `enrichment_queue`
- **Migration**: 018
- **Purpose**: Queue for LLM enrichment of explore_items
- **Columns**: `id`, `explore_item_id` (FK->explore_items, UNIQUE), `priority` (INT), `status` (job_status), `attempts`, `max_attempts` (DEFAULT 3), `last_error`, `started_at`, `completed_at`, `created_at`, `updated_at`
- **RLS**: service_role only

#### `explore_item_rsvps`
- **Migration**: 019
- **Purpose**: RSVPs for explore_items (replaces event_rsvps for new items)
- **Columns**: `id`, `user_id` (FK->auth.users), `explore_item_id` (FK->explore_items), `created_at`
- **Constraint**: UNIQUE(user_id, explore_item_id)
- **RLS**: Authenticated read; own insert/delete

### 2.3 Key Database Functions

| Function | Migration | Purpose |
|----------|-----------|---------|
| `handle_new_user()` | 001 | Trigger: auto-create profile on signup |
| `award_xp_on_post()` | 014 | Trigger: +10 XP on post creation |
| `update_streak_on_post()` | 014, 015, 016 | Trigger: maintain streak on consecutive daily posts |
| `claim_normalization_job()` | 017 | Atomically claim next normalization job (FOR UPDATE SKIP LOCKED) |
| `complete_normalization_job()` | 017 | Mark normalization job done/failed |
| `queue_for_enrichment()` | 018 | Add explore_item to enrichment queue |
| `claim_enrichment_job()` | 018, 023 | Atomically claim next enrichment job, returns item data + availability + price |
| `complete_enrichment_job()` | 018 | Mark enrichment job done/failed |
| `apply_enrichment()` | 018, 021, 023 | Apply LLM enrichment to explore_item (hook_line, tags, recurrence, starts_at, ends_at, availability_json, price_bucket) |
| `is_available_on_day()` | 021 | Check if item available on a day of week |
| `is_available_in_season()` | 021 | Check if item available in a season |
| `is_available_at_time()` | 021 | Check if item available at time of day |
| `is_item_available_in_range()` | 022 | Check if item available within a date range |
| `filter_explore_items()` | 022 | Server-side filtered query with availability awareness |
| `count_filtered_explore_items()` | 022 | Count for pagination |
| `get_current_season()` | 021 | Returns current season string |
| `get_day_abbrev()` | 021 | Returns day-of-week abbreviation |
| `source_needs_fetch()` | 020 | Check if source is due for fetching |
| `get_sources_due_for_fetch()` | 020 | List all sources that need refresh |
| `get_ingestion_stats()` | 020 | Monitoring: counts by source and status |
| `search_profiles()` | 024 | Secure profile search (SECURITY DEFINER, returns only public fields) |

### 2.4 Scheduled Jobs (pg_cron)

| Job | Schedule | Target |
|-----|----------|--------|
| `ticketmaster-ingest` | `0 */6 * * *` (every 6h) | `ingest-ticketmaster` Edge Function |
| `normalize-events` | `*/15 * * * *` (every 15m) | `normalize-raw-events` Edge Function |
| `enrich-events` | `*/30 * * * *` (every 30m) | `run-enrichment-queue` Edge Function |
| `cleanup-orphaned-media` | `0 * * * *` (hourly) | `cleanup-orphaned-media` Edge Function |

> **Note**: pg_cron setup is conditional (`IF EXISTS pg_extension`). May require manual enablement on Supabase dashboard.

---

## 3. Data Ingestion Pipeline

```
Ticketmaster API ──> ingest-ticketmaster ──> event_ingest_raw
                                                  |
                                            (DB trigger)
                                                  |
                                                  v
                                      event_normalization_jobs
                                                  |
                                      normalize-raw-events
                                                  |
                                                  v
                                           explore_items
                                                  |
                                      (auto-queued if no hook_line)
                                                  |
                                                  v
                                         enrichment_queue
                                                  |
                                      run-enrichment-queue
                                      (calls Claude API)
                                                  |
                                                  v
                                    explore_items (enriched)
                                    - hook_line
                                    - tags[]
                                    - availability_json
                                    - price_bucket
```

### 3.1 Source: Ticketmaster

- **File**: `supabase/functions/ingest-ticketmaster/index.ts`
- **API**: Ticketmaster Discovery API v2
- **Default location**: Potsdam, NY (44.6697, -74.9814), 50-mile radius
- **Lookahead**: 90 days
- **Deduplication**: SHA256 hash of raw JSON (`raw_hash`), upsert on `(source_id, external_id)`
- **Rate limiting**: 250ms between pages, max 5 pages per run

### 3.2 Source: Curated CSV (Manual Seed)

- **Migration**: 017 (seeds 100+ explore_items directly)
- **Categories**: Outdoor, Nightlife, Winter Activities, Arts & Culture, Sports & Recreation, Food & Drink, Anchor
- **Data**: Hand-curated activities for Potsdam/North Country region
- **No adapter needed**: Inserted directly via SQL

### 3.3 Normalization

- **File**: `supabase/functions/normalize-raw-events/index.ts`
- **Pattern**: Adapter registry (`_shared/source-adapters/`)
- **Supported adapters**: `api_ticketmaster` (only one implemented)
- **Adapter**: `_shared/source-adapters/ticketmaster.ts` - Maps Ticketmaster fields to `explore_items` schema
- **Mapping highlights**:
  - Ticketmaster segments -> categories (Music, Sports, Arts & Theatre, Film, Miscellaneous)
  - Price ranges -> price_bucket ($0=free, <$30=$, <$75=$$, else=$$$)
  - Venue extraction: name, address, town, lat/lng
  - XP calculation: base 50 + boosts for major venues (+25) and category (Sports +25, Music +20), cap 100
  - Anchor detection: touring artists with 50+ shows, playoff/championship keywords

### 3.4 LLM Enrichment

- **Individual**: `supabase/functions/enrich-explore-item/index.ts`
- **Batch worker**: `supabase/functions/run-enrichment-queue/index.ts`
- **LLM provider**: `_shared/llm-provider.ts` - Anthropic Claude (primary), OpenAI GPT (fallback)
- **Default model**: `claude-3-haiku-20240307`
- **Schema**: `_shared/enrichment-schema.ts`
- **What it enriches**:
  - `hook_line`: 10-20 word compelling description
  - `tags[]`: From 55-tag taxonomy (outdoors, live_music, family_friendly, etc.)
  - `availability_json`: Structured availability (type, available_days, available_times, available_seasons, next_occurrence, recurrence, confidence)
  - `price_bucket`: Inferred from title/description/category
- **Skip logic**: Items already having good hook_line + tags + availability_json are skipped
- **Cost**: ~$0.12 to process all ~100 items

---

## 4. Client Architecture

### 4.1 Navigation Structure

```
app/
  _layout.tsx              -- Root layout (AuthContext, fonts, theme)
  (tabs)/
    _layout.tsx            -- Tab navigator (explore, feed, profile)
    explore.tsx            -- Main explore tab
    feed.tsx               -- Social feed (friends' posts)
    profile.tsx            -- Current user profile
    event/[id].tsx         -- Explore item detail
    post/[id].tsx          -- Post detail
    user/[id].tsx          -- Other user profile
  checkin/
    camera.tsx             -- Dual-camera check-in
  events.tsx               -- Events list
```

### 4.2 Explore Tab (`app/(tabs)/explore.tsx`)

The main discovery surface. Features:
- **Quick filter chips**: Today, Tonight, This Weekend, Free, Outdoors, Live Music
- **Advanced filters**: Category, Price, Time Window, Distance, Sort
- **Postable Now section**: Items within ~0.62 miles and currently happening/available
- **Main list**: Paginated explore_items with distance, sorting, filtering
- **RSVP integration**: Shows who's going, friend count badges

### 4.3 Query Architecture

**File**: `src/lib/exploreQuery.ts`

Two query paths:
1. **RPC path** (when date range active): Calls `filter_explore_items()` for availability-aware filtering
2. **Fallback path** (no date range or RPC unavailable): Direct Supabase query builder on `explore_items`

Both paths apply:
- Category mapping (filter IDs -> DB category values)
- Tag-to-category mapping for quick filters
- Client-side distance filtering via Haversine formula
- Client-side distance sorting

**Category mapping** (`CATEGORY_ID_TO_DB`):
```
outdoors -> ["Outdoor"]
music -> ["Arts & Culture"]
sports -> ["Sports & Recreation"]
arts -> ["Arts & Culture"]
entertainment -> ["Arts & Culture", "Nightlife"]
community -> ["Anchor"]
food -> ["Food & Drink"]
nightlife -> ["Nightlife"]
```

### 4.4 Postable Now System

**File**: `src/lib/postableNow.ts`

Determines if an item is currently "postable" based on:
1. **Distance**: Within 0.62 miles (1000m) of user
2. **Time**: Event in progress, starting within 60 min, or activity currently available
3. **Availability JSON**: Uses enriched availability data (days, times, seasons)
4. **Fallback**: Schedule text parsing for "daily", "year-round", day-of-week mentions

Priority ranking: in_progress (10) > starting_soon (20) > always_available (30) > nearby (40)

### 4.5 Filter System

**File**: `src/config/exploreFilters.ts`

- **Quick Filters** (chips): Presets that set multiple criteria. Currently 6 active: Today, Tonight, This Weekend, Free, Outdoors, Live Music
- **Advanced Filters**: Category (9 options), Price (5 tiers), Time Window (7 options), Distance (5 + any)
- **Sort Options**: Soonest, Featured (priority), Nearest (distance)
- **State**: Managed via `ExploreFilterState` interface with defaults (50mi distance, soonest sort, page 0, size 20)

### 4.6 Key Hooks

| Hook | Purpose |
|------|---------|
| `useExploreFilters` | Filter state management for explore tab |
| `useExploreItemRSVP` | RSVP toggle for explore items |
| `useEventRSVP` | RSVP toggle for legacy events |
| `usePosts` | Feed posts with joins (profiles, reactions, comments) |
| `useUserPosts` | Posts by a specific user |
| `useProfile` | Current user profile data |
| `useFriendship` | Friend request/accept/decline |
| `useFriendsList` | List of accepted friends |
| `useFriendRequests` | Pending friend requests |

### 4.7 Key Components

| Component | Purpose |
|-----------|---------|
| `Avatar` | User avatar with fallback initials |
| `ReactionBar` | Emoji reaction picker (6 emojis) |
| `CommentSheet` | Bottom sheet for post comments |
| `FriendsSheet` | Friends list bottom sheet |
| `FriendRequestsSheet` | Pending requests management |
| `FriendsGoingSheet` | Who's attending an event |
| `UserSearchSheet` | Search users to add friends |
| `Toast` | In-app toast notifications |

### 4.8 Contexts

| Context | Purpose |
|---------|---------|
| `AuthContext` (`src/contexts/AuthContext.tsx`) | Supabase auth state, session management |
| `LocationContext` (`src/context/LocationContext.tsx`) | User location via expo-location |

---

## 5. Storage

- **Bucket**: `posts`
- **Structure**: `{user_id}/{post_id}-{back|front}.jpg`
- **Cleanup**: `cleanup-orphaned-media` Edge Function deletes files >1 hour old with no matching post record
- **Scheduled**: Hourly via pg_cron

---

## 6. Auth & Security

- **Provider**: Supabase Auth (email/password)
- **RLS**: Enabled on all user-facing tables
- **Service role**: Used by Edge Functions for ingestion/enrichment (bypasses RLS)
- **Profile search**: Locked down via SECURITY DEFINER function (migration 024) - only returns id, username, avatar_url
- **Privacy**: Private fields (bio, xp, streak) only visible to self or accepted friends

---

## 7. Environment Variables (Edge Functions)

| Variable | Used By |
|----------|---------|
| `SUPABASE_URL` | All Edge Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | All Edge Functions |
| `TICKETMASTER_API_KEY` | ingest-ticketmaster |
| `ANTHROPIC_API_KEY` | enrich-explore-item, run-enrichment-queue |
| `OPENAI_API_KEY` | (fallback) enrich-explore-item, run-enrichment-queue |

---

## 8. Migration Inventory

| # | File | Purpose |
|---|------|---------|
| 001 | `create_profiles.sql` | Profiles, events, auth trigger |
| 002 | `create_event_rsvps.sql` | Event RSVPs |
| 003 | `create_posts.sql` | Posts table |
| 004 | `fix_posts_and_events.sql` | Add lat/lng to events, fix posts schema |
| 005 | `add_potsdam_events.sql` | Seed Potsdam events |
| 006 | `fix_foreign_keys.sql` | Fix FK constraints |
| 010 | `add_reactions_comments.sql` | Reactions + comments |
| 011 | `add_friendships.sql` | Friendships table |
| 012 | `add_profile_avatar_bio.sql` | Avatar + bio columns |
| 013 | `add_friendship_status.sql` | Friendship status enum |
| 014 | `add_xp_streak_progression.sql` | XP, streak, gamification triggers |
| 015 | `fix_streak_timezone.sql` | Streak timezone fix |
| 016 | `fix_current_streak.sql` | Streak calculation fix |
| 017 | `event_ingestion_architecture.sql` | Full ingestion pipeline: sources, raw, normalization, explore_items, 100+ seed items |
| 018 | `add_llm_enrichment_fields.sql` | Tags, enrichment queue, claim/complete/apply functions |
| 019 | `add_explore_item_rsvps.sql` | RSVPs for explore_items |
| 020 | `add_ticketmaster_source.sql` | Ticketmaster source, scheduling helpers, pg_cron jobs |
| 021 | `add_availability_json.sql` | Availability JSON column, helper functions |
| 022 | `add_availability_filter_function.sql` | Server-side filter/count RPCs |
| 023 | `upgrade_enrichment_pipeline.sql` | Add price_bucket to enrichment, upgrade claim_enrichment_job return type, re-queue all items |
| 023 | `add_posts_explore_item_id.sql` | Add explore_item_id FK to posts (NOTE: duplicate number) |
| 024 | `fix_profiles_rls_privacy.sql` | Secure profile search RPC |
| 025 | `add_orphaned_media_cleanup_job.sql` | Media cleanup cron job |
| 026 | `document_posts_fk_intent.sql` | Document posts FK design intent |

> **Warning**: Two migration files are numbered 023. The `upgrade_enrichment_pipeline.sql` was created later and may conflict. Renumber to 027+ recommended.

---

## 9. File Index

### Supabase Functions
- `supabase/functions/ingest-ticketmaster/index.ts`
- `supabase/functions/normalize-raw-events/index.ts`
- `supabase/functions/enrich-explore-item/index.ts`
- `supabase/functions/run-enrichment-queue/index.ts`
- `supabase/functions/cleanup-orphaned-media/index.ts`
- `supabase/functions/_shared/llm-provider.ts`
- `supabase/functions/_shared/enrichment-schema.ts`
- `supabase/functions/_shared/source-adapters/ticketmaster.ts`
- `supabase/functions/_shared/source-adapters/index.ts`

### Client Source
- `src/lib/exploreQuery.ts` - Query builder
- `src/lib/postableNow.ts` - Postable now logic
- `src/lib/supabase.ts` - Supabase client
- `src/config/exploreFilters.ts` - Filter config
- `src/config/constants.ts` - App constants
- `src/config/theme.ts` - Theme
- `src/types/database.ts` - TypeScript types
- `src/contexts/AuthContext.tsx` - Auth context
- `src/context/LocationContext.tsx` - Location context
- `src/utils/location.ts` - Distance calculations
- `src/utils/avatar.ts` - Avatar helpers
- `src/utils/haptics.ts` - Haptic feedback
- `src/utils/scrollToTop.ts` - Scroll utilities

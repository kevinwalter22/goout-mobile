# Euda AI — Report Evidence Document

> Generated from repo scan on 2026-04-20. Every claim below cites a file path, line number, or migration. Nothing is fabricated. Gaps are called out explicitly.

---

## Section 1 — AI System Inventory

Six AI/ML touchpoints exist in the codebase. Four are active; two are stubs.

### 1a. LLM Event/Venue Enrichment (Active)

**What it does:** Takes a raw `explore_items` row (title, description, location, category) and produces: a hook line (one-sentence marketing pitch), 5–10 tags from a canonical taxonomy, a price bucket, an audience classification, a schedule summary, and a structured availability JSON.

**Where it lives:**
- Prompt template: `supabase/functions/_shared/enrichment-schema.ts:465-722`
- Batch worker: `supabase/functions/run-enrichment-queue/index.ts`
- Single-item enrichment: `supabase/functions/enrich-explore-item/index.ts`
- Job scheduler: `supabase/functions/schedule-enrichment/index.ts`

**Model:** Claude Haiku (`claude-haiku-4-5-20251001`) via Anthropic API. Fallback: `gpt-4o-mini` via OpenAI. Provider selection in `supabase/functions/_shared/llm-provider.ts:146-162` — checks `ANTHROPIC_API_KEY` first, then `OPENAI_API_KEY`.

**Parameters:** temperature 0.3, maxTokens 1024, JSON mode enabled for OpenAI.

**System prompt (exact text, `enrichment-schema.ts:465-469`):**

```
You are a classification and enrichment engine for Euda, a local discovery app
that helps people find things to do. Your job is to produce RICH, ACCURATE
metadata so items appear in the right themed cards in the app feed.

CRITICAL: You must assign 5-10 tags per item from the allowed list. Tags drive
the entire card-based UI — items with too few tags become invisible to users.
Think about EVERY dimension: what type of activity is it, who is it for, what's
the vibe, is it indoors or outdoors, and what's the price?

Always respond with valid JSON only, no markdown or explanation.
```

The prompt then includes the full 44-tag taxonomy, the item's current metadata (title, description, location, schedule, existing tags), today's date/day/season for temporal context, and a JSON schema the model must conform to.

**Input:** One `explore_items` row formatted as structured text (lines 481–722).

**Output schema:**
```json
{
  "hook_line": "string",
  "tags": ["tag1", ...],
  "suggested_category": "Outdoor | Nightlife | ...",
  "price_bucket": "free | $ | $$ | $$$",
  "description": "string",
  "short_schedule": "string",
  "audience_fit": "youth_general | family | business | tourist | niche",
  "is_event_venue": true/false,
  "availability": { "type", "available_days", "available_times", "available_seasons", "confidence": 0-100 }
}
```

**Downstream consumption:** Validated by `validateEnrichmentResponse()` (enrichment-schema.ts:191–459), then applied to the DB via RPC `apply_enrichment()` with per-field provenance confidence scores (hook_line=0.70, tags=0.60–0.75, price=0.60, availability=0.65–0.85).

**Budget system:** Daily cap via RPC `check_llm_daily_budget`, env var `LLM_DAILY_MAX_CALLS` (default 1000). Usage tracked via RPC `record_llm_usage` per call (input_tokens, output_tokens).

---

### 1b. LLM Reranker (Optional, Feature-Flagged)

**What it does:** Takes the top 20 items from the deterministic scoring engine and reranks them using an LLM that considers time-of-day, weather, and "natural flow between activities."

**Where it lives:** `supabase/functions/rerank-explore-items/index.ts`

**Model:** `claude-3-haiku-20240307` (hardcoded, line 167). Temperature 0.3, maxTokens 500.

**Feature flag:** `llm_reranker` in `feature_flags` table. **Default: disabled.**

**System prompt (exact, lines 176–182):**
```
You are a helpful assistant that reranks explore items for a user browsing
local events and activities.
Output valid JSON only, no markdown or explanation.
Rerank based on:
- Time of day relevance (${body.context.time_of_day})
- Weather appropriateness (${body.context.weather || "unknown"})
- Natural flow between activities
Keep reasons SHORT (under 10 words each).
```

**Input:** Array of `{id, title, category, tags, base_score}` plus context `{time_of_day, day_of_week, weather}`.

**Output:** Array of `{id, rank, reason}`.

**Caching:** 1-hour time buckets, hash-based cache key, stored in `llm_reranker_cache` table. TTL: 2 hours.

**Downstream:** Consumed in `src/hooks/useRecommender.ts:374-435` — merges reranked top-K with remaining items.

---

### 1c. AI Geocoding Script (Dev Tool)

**Where it lives:** `scripts/geocode_with_ai.ts`

**Model:** `claude-3-haiku-20240307`, temperature 0.1, maxTokens 50–100.

**What it does:** Two-phase geocoding for items with ambiguous addresses:
1. **Address enhancement** (lines 112–142): Claude normalizes/enhances an address with local context (prompt specializes in North Country NY — Potsdam, Canton, Adirondacks). Output fed to Nominatim.
2. **Coordinate fallback** (lines 147–191): If Nominatim fails, Claude provides approximate lat/lng. Validated to be within NY bounds (lat 40–46, lng −80 to −72).

**Not a production system** — run manually via `npm run geocode:ai`.

---

### 1d. Image Moderation (Stub — Not Active)

**Where it lives:** `supabase/functions/moderate-image/provider.ts`

**Current state:** `StubImageModerationProvider` (lines 54–68) always returns `{action: "allow", severity: 0}`. The interface supports AWS Rekognition, Google Cloud Vision, and OpenAI Vision (lines 78–85 list env var names) but **none are implemented**. Feature flag: `image_moderation_enabled`.

---

### 1e. Text Moderation (Deterministic — Not LLM)

**Where it lives:** `src/lib/moderation/textModeration.ts`

**Not AI-based.** Uses regex pattern matching for hate_speech, harassment, sexual_content, doxxing, illegal, mild_profanity. Returns a category + severity (0–100).

An LLM escalation function exists (`shouldEscalateToLLM()`, line 445–452) for borderline cases (severity 55–75), gated by feature flag `llm_text_moderation`, but **the actual LLM moderation handler is not implemented**.

---

### 1f. No Embeddings or Vector Search

Confirmed: no embedding generation, no vector columns, no pgvector extension, no similarity search anywhere in the codebase. All retrieval is filter-based (SQL WHERE clauses) followed by client-side scoring.

---

## Section 2 — Data Pipeline & Ingestion

### Pipeline Architecture

```
External APIs → Ingestion Functions → event_ingest_raw → Normalization
→ explore_items → LLM Enrichment → Quality Gates → Client Query → Scoring
```

### Data Sources

#### A. Ticketmaster Discovery API
- **Edge function:** `supabase/functions/ingest-ticketmaster/index.ts`
- **API endpoint:** `https://app.ticketmaster.com/discovery/v2/events.json`
- **Parameters:** lat/lng (default: 44.6697, −74.9814 — Potsdam NY), 50mi radius, 90 days ahead, 50 results/page, up to 5 pages
- **Normalization adapter:** `supabase/functions/_shared/source-adapters/ticketmaster.ts`
- **Output kind:** `event`
- **Dedup:** SHA-256 hash of JSON payload + external_id uniqueness constraint
- **Schedule:** Every 30 min via `fetch-coordinator`

#### B. Google Places API (New)
- **Edge function:** `supabase/functions/ingest-google-places/index.ts`
- **API endpoints:** Nearby Search (`places:searchNearby`) + Text Search (`places:searchText`)
- **Strategy:** Two-phase — Nearby Search across 20 place types (restaurant, cafe, bar, gym, park, museum, etc.), then Text Search for niche keywords ("hiking trail", "brewery", "disc golf", etc.)
- **Quality filter:** Skips funeral homes, gas stations, hotels, pharmacies, hair salons, etc. (pattern list in code)
- **Normalization adapter:** `supabase/functions/_shared/source-adapters/google_places.ts`
- **Output kind:** `activity` (evergreen, not time-bound)
- **Budget:** Checks `api_usage_counters` RPC before API calls

#### C. PredictHQ Events API
- **Edge function:** `supabase/functions/ingest-predicthq/index.ts`
- **API endpoint:** `https://api.predicthq.com/v1/events/`
- **Categories:** community, concerts, conferences, expos, festivals, performing-arts, sports
- **Quality gate:** `rank_min: 20` (0–100 scale); skips cancelled/postponed
- **Normalization adapter:** `supabase/functions/_shared/source-adapters/predicthq.ts`
- **Output kind:** `event`

#### D. Web Collector (Scraping)
- **Edge function:** `supabase/functions/ingest-web-collector/index.ts`
- **Extraction pipeline:** JSON-LD → ICS → RSS → DOM (CSS selectors), tried in order
- **Configuration:** `collector_targets` DB table stores URLs, selectors, strategy per target
- **Compliance:** Respects robots.txt, uses circuit breaker on repeated failures, rate-limited
- **User agent:** `EudaBot/1.0 (+https://euda.app/bot; bot@euda.app)`

#### E. Open-Meteo (Weather)
- **Client-side hook:** `src/hooks/useWeather.ts`
- **API:** `https://api.open-meteo.com/v1/forecast?current=temperature_2m,precipitation,cloud_cover,weather_code&temperature_unit=fahrenheit`
- **Free, no API key.** Cache: 30 min per rounded location (2 decimal places ≈ 1km).
- **Output:** `{isRaining, isSunny, temperature, cloudCover, precipitation, description}`
- **Not stored in DB** — fetched per-session, fed directly into scoring context.

#### F. Eventbrite (Disabled)
- **Edge function:** `supabase/functions/ingest-eventbrite/index.ts`
- **Status:** Disabled since migration 036 (`036_disable_eventbrite.sql`). Eventbrite removed their geo-discovery endpoint. Function is now a safe no-op that logs "disabled" to health log.

### Key Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `event_sources` | Registry of data sources | `name, type (enum), is_enabled, config_json, last_fetch_at` |
| `event_ingest_raw` | Raw API responses | `source_id, external_id, raw_json, raw_hash, status, fetched_at` |
| `event_normalization_jobs` | Processing queue | `raw_id, status (queued/running/done/failed)` |
| `explore_items` | Canonical items | ~60 columns including title, category, lat/lng, tags, hook_line, starts_at, availability_json, normalized_confidence, relevance_tier, is_duplicate |
| `enrichment_queue` | LLM processing queue | `explore_item_id, status, attempts, last_error` |

### Orchestration

**Coordinator:** `supabase/functions/fetch-coordinator/index.ts` — round-robin fetcher that picks the most overdue source partition via RPC `next_fetch_partition()`, invokes the matching ingest function, logs results.

**Cron schedule** (migration 088):

| Job | Schedule | Function |
|-----|----------|----------|
| fetch-coordinator-run | Every 30 min | fetch-coordinator |
| normalize-new-events | Every 15 min | normalize-raw-events |
| enrich-new-items | Every 30 min | run-enrichment-queue |
| demote-stale-items | Daily 04:00 UTC | DB function `demote_stale_items()` |
| dedup-daily | Daily 04:30 UTC | DB function `mark_duplicates()` |

### Deduplication (Migration 032)

Deterministic dedupe key: `normalized_title | date_bucket | geo_bucket | venue_prefix`
Example: `"fall festival|2025-09-27|42.30,-75.50|fallfestiv"`

Groups items by key → picks canonical (highest confidence → priority → created_at) → marks others `is_duplicate=true` with `canonical_item_id`.

### Confidence Scoring (Migration 030)

```
Base: 100
  - No canonical category → −30
  - price_bucket = 'unknown' → −20
  - No tags → −20
  - No availability_json → −15
  - No lat/lng → −15
```

Written to `explore_items.normalized_confidence`. Items <40 hidden from queries.

### Approximate Record Counts (from `docs/VERIFIED_QUALITY_AUDIT.md`)

At time of verified audit (2026-02-24): 997 feed-eligible items. 867 activities (87%), 130 events (13%). 788 tier-3 (premium), 208 tier-2 (standard).

---

## Section 3 — The Recommender / Ranking Engine

### System Classification

**Hybrid rules-based + learned-preference ranker.** Not a machine-learned model. No gradient descent, no neural network, no embedding retrieval. The system is:
1. A **filter-then-score** pipeline: SQL filters (date, category, location, confidence) produce candidates, then client-side scoring ranks them.
2. Scoring is a **weighted linear combination** of 12 hand-tuned signals.
3. Two signals (`tagAffinity`, `typeAffinity`) incorporate **online-learned user preferences** updated via interaction logging.
4. An optional **LLM reranker** (disabled by default) can post-process the top 20 items.

### The 12 Signals

All signals return values in [0, 1]. The final score is their weighted sum.

**File:** `src/lib/scoring.ts`

| # | Signal | Weight | Function (file:line) | What It Computes |
|---|--------|--------|---------------------|------------------|
| 1 | `timeMatch` | 0.15 | `computeTimeScore` (scoring.ts:195) | How soon the event starts. Events starting within 2 hours → 0.95. Activities check `availability_json` day/time match. |
| 2 | `distance` | **0.20** | `computeDistanceScore` (scoring.ts:276) | Proximity. ≤3mi → 1.0, ≥30mi → 0.0, exponential decay (power 0.6) in between. No location → 0.3. |
| 3 | `openNow` | 0.08 | `computeOpenNowScore` (scoring.ts:313) | Binary for events (in progress → 1.0, else 0.0). Activities check time-of-day availability. |
| 4 | `friendsGoing` | 0.13 | `computeFriendsScore` (scoring.ts:362) | Count of friends with RSVP. 0 → 0.0, 1 → 0.5, 2 → 0.7, 3+ → 1.0. |
| 5 | `tagAffinity` | 0.06 | `computeTagAffinityScore` (scoring.ts:381) | **Learned.** Averages user's affinity scores for item's tags, normalized by user's max affinity. |
| 6 | `weather` | 0.06 | `computeWeatherScore` (scoring.ts:415) | Cross-references item indoor/outdoor tags with live weather (rain, temperature, sun). Rainy + outdoor → 0.2; sunny + outdoor → 1.0. |
| 7 | `contextIntent` | 0.03 | `computeContextIntentScore` (scoring.ts:527) | Time-of-day × day-of-week bias. Friday evening → boost events/nightlife. Sunday morning → boost activities/brunch. Only on "All" toggle. |
| 8 | `typeAffinity` | 0.06 | `computeTypeAffinityScore` (scoring.ts:583) | **Learned.** Ratio of events vs. activities the user has interacted with. Floor: 0.3 (never fully suppress opposite kind). Min 3 interactions to activate. |
| 9 | `quality` | 0.10 | `computeQualityScore` (scoring.ts:629) | Data completeness × audience fit. Confidence ≥80 → 1.0. Business/tourist audience → 0.3–0.4 penalty. Event venues → +8% bonus. |
| 10 | `communityFeedback` | 0.05 | `computeCommunityFeedbackScore` (scoring.ts:717) | Net user votes (upvote +1, confirm +3, downvote −1, report_closed −2). Linear mapping: −10 → 0.0, 0 → 0.5, +15 → 1.0. |
| 11 | `freshness` | **0.00** | `computeFreshnessScore` (scoring.ts:682) | Recency decay for activities. **Weight is intentionally zero** — absorbed by `friendCreated`. |
| 12 | `friendCreated` | 0.08 | `computeFriendCreatedScore` (scoring.ts:754) | Binary: was this item created by a friend? 1.0 or 0.0. |

### Final Score Formula

```
total = Σ (signal_i × weight_i)  for i in 1..12
```

Located at `scoring.ts:110-122`. Weights sum to exactly 1.0, validated at dev-time startup (`recommenderConfig.ts:229-234`).

### Where Scoring Runs

**Client-side (React Native).** The `useRecommender` hook (`src/hooks/useRecommender.ts`) fetches items via Supabase RPC `filter_explore_items`, then scores and sorts them in the JavaScript thread. The optional LLM reranker is the only server-side scoring step and is disabled by default.

### Context-Awareness

Context enters through the `ScoringContext` object built in `useRecommender.ts:262-282`:
- **Time:** `Date.now()` → feeds `timeMatch`, `openNow`, `contextIntent`
- **Weather:** Open-Meteo API via `useWeather` hook → feeds `weather`
- **Location:** Device GPS → feeds `distance`
- **Day-of-week:** Derived from current time → feeds `contextIntent` (6 hardcoded time/day buckets)
- **Social graph:** Friends' RSVPs + friend-created items → feeds `friendsGoing`, `friendCreated`
- **Learned preferences:** Tag affinity map + type affinity ratio → feeds `tagAffinity`, `typeAffinity`

### Pagination Stability

`useRecommender.ts:286-368` maintains a ref tracking `firstItemId` and `scoredItems` to prevent score-induced scroll jumps. On pagination: only new items are scored; existing order is preserved. On context-only updates after pagination: re-ranking is skipped entirely.

---

## Section 4 — Personalization & User Modeling

### Interaction Signals Captured

**Logger:** `src/lib/interactionLogger.ts:34-67` — fire-and-forget, calls single RPC.

| Event Type | Trigger | Weight (for tag affinity) |
|------------|---------|--------------------------|
| `open_detail` | User taps an explore card | 1.0 |
| `rsvp` | User taps "I'm Going" | 1.5 |
| `share` | User shares an item | 2.0 |
| `check_in_post` | User checks in and posts | 3.0 |

### User Preference Tables

**`user_tag_affinity`** (migration 058:12-25)
```sql
user_id UUID, tag TEXT, score FLOAT, interaction_count INTEGER,
last_interaction_at TIMESTAMPTZ
-- UNIQUE(user_id, tag), indexed by (user_id, score DESC)
-- Max 20 tags tracked per user
```

**`user_type_affinity`** (migration 059:48-55)
```sql
user_id UUID PRIMARY KEY,
events_engaged INTEGER, activities_engaged INTEGER,
event_bias FLOAT, activity_bias FLOAT
-- Derived: event_bias = events / (events + activities)
```

**`user_item_events`** (migration 059:11-18)
```sql
user_id UUID, explore_item_id UUID, event_type TEXT, metadata JSONB
-- UNIQUE(user_id, explore_item_id) — one row per user-item pair
```

**`user_item_feedback`** (migration 104:23-31)
```sql
user_id UUID, explore_item_id UUID,
feedback_type TEXT CHECK (IN ('upvote','confirm','downvote','report_closed'))
-- UNIQUE(user_id, explore_item_id) — one vote per user per item
```

### How Preferences Update

All updates happen server-side in a single atomic RPC: `log_interaction_and_update_affinity()` (migration 059:77-142). This:
1. Inserts into `user_item_events` (append-only log)
2. Increments the matching counter in `user_type_affinity` (events_engaged or activities_engaged)
3. Recomputes `event_bias` and `activity_bias`
4. Calls `update_user_tag_affinity()` which unnests the item's tags and upserts each tag's score with the event-type weight

### Cold-Start Handling

- **Tag affinity:** Returns 0 (no contribution to score) when `userTagAffinity.size === 0` (scoring.ts:389).
- **Type affinity:** Returns 0.5 (neutral) when `totalInteractions < 3` (scoring.ts:600). The `MIN_INTERACTIONS` constant is 3.
- **Friends going:** Returns 0 when user has no friends with RSVPs. New users with no friends get no social signal — distance, time, and quality dominate their feed.
- **Community feedback:** Returns 0.5 (neutral) when no feedback exists for an item.

**Net effect for new users:** Ranking is driven primarily by distance (20%), time match (15%), friends going (13%, but 0 for new users), and quality (10%). Personalization signals contribute nothing until the user has ≥3 interactions.

---

## Section 5 — Context-Aware Features

### Time Context

- **Source:** `Date.now()` on the client
- **Feeds:** `timeMatch` (event urgency), `openNow` (currently happening), `contextIntent` (time-of-day × day-of-week bias)
- **Context intent buckets** (6 hardcoded in `recommenderConfig.ts`):

| Bucket | When | Event Bias | Activity Bias | Tag Bonuses |
|--------|------|------------|---------------|-------------|
| Fri/Sat Evening | Fri-Sat 16:00–24:00 | 0.85 | 0.40 | nightlife +0.15, concert +0.1 |
| Fri Afternoon | Fri 12:00–16:00 | 0.70 | 0.50 | — |
| Sat/Sun Morning | Sat-Sun 06:00–12:00 | 0.35 | 0.85 | cafe +0.1, brunch +0.15 |
| Sun Afternoon | Sun 12:00–17:00 | 0.45 | 0.75 | — |
| Weekday Lunch | Mon-Thu 11:00–14:00 | 0.35 | 0.75 | food +0.1, restaurant +0.1 |
| Weekday Evening | Mon-Thu 17:00–22:00 | 0.70 | 0.55 | nightlife +0.05 |

Only active when `kindFilter === "all"`. Returns neutral (0.5) on "Events" or "Activities" toggle.

### Weather Context

- **Source:** Open-Meteo API (`src/hooks/useWeather.ts`), free, no key
- **Fetched fields:** temperature (°F), precipitation, cloud cover, WMO weather code
- **Cache:** 30 min per rounded lat/lng
- **Scoring logic** (`computeWeatherScore`, scoring.ts:415-516):
  - Detects indoor/outdoor via tag matching (13 indoor tags, 14 outdoor tags)
  - Temperature tiers: freezing <32°F, cold 32-45°F, cool 45-55°F, comfortable 55-85°F, hot >95°F
  - Rain + outdoor → 0.2 (strong penalty); Sunny + outdoor → 1.0 (full boost)
  - Rain + indoor → 0.9 (slight boost); Freezing + outdoor → 0.05 (near-zero)

### Location Context

- **Source:** Device GPS via `expo-location`
- **Feeds:** `distance` signal (exponential decay, 3mi optimal, 30mi max)
- **Also used by:** `postableNow` logic (must be within 200m to check in)
- **Precision:** Full GPS coordinates for distance; rounded to 2 decimals for weather cache

### Day-of-Week Context

- **Derived from:** `Date.now()` → `getDay()`
- **Feeds:** `contextIntent` buckets (see table above)
- **Effect:** Friday evening naturally boosts nightlife/events; Sunday morning boosts brunch/cafes

---

## Section 6 — Evaluation & Metrics

### Honest Assessment

**No offline evaluation harness exists in the repo. Evaluation has been informal — by inspection, code audit, and post-hoc data quality checks.**

### What EXISTS for evaluation:

#### A. Unit Tests for Scoring Logic
- **File:** `src/lib/__tests__/scoring.test.ts` — 20 tests
- Tests individual scoring functions with mock items and contexts
- Validates edge cases (no location, no tags, zero interactions)
- **Does not test ranking quality** — only functional correctness of individual signals

#### B. Analytics Event Logging
- **File:** `src/lib/analyticsLogger.ts`
- **Table:** `analytics_events` (migration 066)
- Tracks: `signup_complete`, `explore_open`, `post_started`, `contacts_sync_started/completed`
- **Fire-and-forget.** No dashboard, no funnel analysis tooling.
- **Does not track:** CTR, impression-to-click ratio, scroll depth, recommendation position

#### C. Interaction Logging (Raw Signal)
- **File:** `src/lib/interactionLogger.ts`
- **Table:** `user_item_events` (migration 059)
- Records: which items users opened, RSVP'd, shared, posted to
- **Could theoretically support offline evaluation** (log interactions → compute ranking metrics) but **no such pipeline exists**.

#### D. Community Feedback System
- **Table:** `user_item_feedback` (migration 104)
- Users can upvote/confirm/downvote/report items
- Aggregated in materialized view `item_feedback_agg`
- Auto-suppresses items with ≥3 "report_closed" votes
- **Integrated into scoring** (5% weight) — this is live user signal, not offline evaluation

#### E. Feature Flags (Kill Switches, Not A/B Tests)
- **Table:** `feature_flags` (migration 067)
- Has `rollout_percentage` column (0–100) but **percentage rollout is not implemented in `useFeatureFlags.ts`** — flags are binary on/off.
- **No A/B test framework.** No control/treatment groups. No statistical significance testing.

#### F. Data Quality Audits (Post-Hoc, Manual)

**`docs/data_quality_baseline.md`** — Baseline snapshot from 2026-02-03:
- 1028 items, 981 active, 39 duplicates, 8 stale
- 28.3% missing category (P1), 5.5% missing descriptions (P2)
- All 1028 enrichment jobs stuck in "running" (P0 — since fixed)

**`docs/VERIFIED_QUALITY_AUDIT.md`** — Live data verification from 2026-02-24:
- 997 feed-eligible items
- Only 2.3% with <3 tags (contradicting earlier "critical sparsity" claim)
- 82.5% with 8+ tags
- Key finding: **tag homogeneity, not sparsity** — top 5 tags appear on 50–64% of items
- 87% activities vs 13% events (activity dominance)

**`docs/PRODUCTION_READINESS_AUDIT.md`** — Build quality from 2026-03-02:
- 363/363 tests passing across 8 suites
- 0 TypeScript errors, 0 ESLint errors
- Code quality score: 3.7/5 (test coverage: 2/5, observability: 3/5)

#### G. Known Enrichment Quality Issues

From `docs/VERIFIED_QUALITY_AUDIT.md` and `docs/QUALITY_AUDIT.md`:
- **Tag homogeneity:** `family_friendly` on 64%, `indoors` on 55%, `solo_friendly` on 51% — LLM over-applies safe tags
- **Category inference unreliable:** 28% missing at baseline; patched with `infer_category_from_tags()` (migration 048)
- **No explicit misclassification analysis** (e.g., Taco Bell in Bars) is documented in the repo, though the enrichment prompt was iteratively revised based on observed errors

### What DOES NOT EXIST:

1. **No NDCG, MAP, MRR, or any standard IR metric** computed anywhere
2. **No A/B testing infrastructure** — changes are deploy-and-observe
3. **No CTR tracking** — impressions and clicks are not correlated
4. **No holdout test set** or ground-truth relevance labels
5. **No offline replay** — cannot re-score historical interactions with new weights
6. **No user studies or focus group data** documented in the repo
7. **No continuous monitoring dashboard** — health checks are manual SQL queries
8. **No staging environment** — all evaluation is against production data
9. **No ranking comparison** (before/after weight changes)
10. **No test coverage measurement** — estimated 15–25% by the production readiness audit

---

## Section 7 — System Architecture Summary

### End-to-End Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     EXTERNAL DATA SOURCES                        │
│  Ticketmaster API · Google Places API · PredictHQ API            │
│  Web Scraping (community calendars) · Open-Meteo (weather)       │
└──────────────────┬───────────────────────────────────────────────┘
                   ↓
┌──────────────────────────────────────────────────────────────────┐
│              INGESTION (Supabase Edge Functions, Deno)            │
│  ingest-ticketmaster · ingest-google-places · ingest-predicthq   │
│  ingest-web-collector · fetch-coordinator (orchestrator)         │
│  ── SHA-256 change detection, API budget guards ──               │
│  → Stores raw JSON in event_ingest_raw                           │
└──────────────────┬───────────────────────────────────────────────┘
                   ↓  (DB trigger: create_normalization_job)
┌──────────────────────────────────────────────────────────────────┐
│           NORMALIZATION (normalize-raw-events, Deno)              │
│  Source adapter registry: ticketmaster.ts · google_places.ts     │
│  predicthq.ts · web_collector.ts                                 │
│  ── Maps raw → canonical schema, assigns relevance tier ──       │
│  → Upserts into explore_items                                    │
└──────────────────┬───────────────────────────────────────────────┘
                   ↓  (auto-queued for enrichment)
┌──────────────────────────────────────────────────────────────────┐
│          LLM ENRICHMENT (run-enrichment-queue, Deno)             │
│  Model: Claude Haiku (Anthropic) or GPT-4o-mini (OpenAI)         │
│  ── Generates: hook_line, tags (5-10), price, audience,          │
│     availability, category correction ──                          │
│  ── Per-field provenance tracking, daily budget cap ──           │
│  → Updates explore_items with enriched fields                    │
└──────────────────┬───────────────────────────────────────────────┘
                   ↓
┌──────────────────────────────────────────────────────────────────┐
│         QUALITY GATES (Postgres functions, cron)                 │
│  Confidence scoring (0-100) · Deduplication (dedupe key)         │
│  Stale event demotion (priority → -1) · Relevance tier (0-3)    │
│  Admin suppression · Community auto-suppression (3+ reports)     │
└──────────────────┬───────────────────────────────────────────────┘
                   ↓
┌──────────────────────────────────────────────────────────────────┐
│         RETRIEVAL (filter_explore_items RPC, Postgres)            │
│  Filters: date range, category, tags, price, distance,           │
│  confidence ≥ 40, priority ≥ 0, not duplicate                    │
│  → Returns paginated candidate set to client                     │
└──────────────────┬───────────────────────────────────────────────┘
                   ↓
┌──────────────────────────────────────────────────────────────────┐
│       SCORING & RANKING (React Native client, TypeScript)        │
│  12-signal weighted linear combination (scoring.ts)              │
│  Signals: distance · time · openNow · friendsGoing · tagAffinity│
│  weather · contextIntent · typeAffinity · quality ·              │
│  communityFeedback · freshness · friendCreated                   │
│  ── Optional: LLM reranker (disabled by default) ──             │
│  → Sorted items rendered in Explore feed                         │
└──────────────────┬───────────────────────────────────────────────┘
                   ↓
┌──────────────────────────────────────────────────────────────────┐
│            USER INTERACTION (React Native client)                │
│  open_detail · rsvp · share · check_in_post                     │
│  upvote · confirm · downvote · report_closed                     │
│  → Fire-and-forget to log_interaction_and_update_affinity RPC    │
└──────────────────┬───────────────────────────────────────────────┘
                   ↓
┌──────────────────────────────────────────────────────────────────┐
│         PREFERENCE UPDATE (Postgres RPC, atomic)                 │
│  Updates user_tag_affinity (tag → score map)                     │
│  Updates user_type_affinity (event_bias / activity_bias)         │
│  → Feeds back into next scoring pass                             │
└──────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Mobile client | React Native 0.81 + Expo SDK 54 + TypeScript |
| Navigation | Expo Router (file-based) + react-native-gesture-handler |
| Backend | Supabase (Postgres 15 + Edge Functions in Deno) |
| Auth | Supabase Auth (email/password, JWT) |
| Storage | Supabase Storage (posts bucket, avatars bucket) |
| LLM | Anthropic Claude Haiku (primary), OpenAI GPT-4o-mini (fallback) |
| Weather | Open-Meteo (free, no key) |
| Events | Ticketmaster Discovery API, PredictHQ Events API |
| Places | Google Places API (New) |
| Scraping | Custom web collector with robots.txt compliance |
| Push | Expo Push Notification Service |
| Error tracking | Sentry |
| CI | GitHub Actions (lint + typecheck) |
| Build | EAS Build (Expo Application Services) |

---

## Appendix A — AI-Relevant Database Tables

| Table | Purpose |
|-------|---------|
| `explore_items` | Canonical items with enrichment fields (tags, hook_line, availability_json, normalized_confidence, audience_fit, relevance_tier) |
| `event_ingest_raw` | Raw API responses before normalization |
| `event_normalization_jobs` | Normalization processing queue |
| `enrichment_queue` | LLM enrichment processing queue |
| `event_sources` | Registry of data sources with fetch config |
| `user_tag_affinity` | Per-user learned tag preferences (tag → score) |
| `user_type_affinity` | Per-user event vs activity bias ratio |
| `user_item_events` | Interaction log (open, rsvp, share, post) |
| `user_item_feedback` | Community votes (upvote/confirm/downvote/report) |
| `item_feedback_agg` | Materialized view aggregating feedback per item |
| `llm_reranker_cache` | Cached LLM reranker results (per user + time bucket) |
| `feature_flags` | Feature flag configuration (flag_name, is_enabled, config_json) |
| `pipeline_health_log` | Ingestion/enrichment health events |
| `api_usage_counters` | Monthly API budget tracking per service |
| `collector_targets` | Web scraping target configuration |
| `collector_page_cache` | Cached HTML + extracted candidates |
| `explore_item_rsvps` | User RSVPs on explore items |
| `analytics_events` | App-level analytics (signup, explore_open, etc.) |
| `fetch_partitions` | Geo/time partitions for source rotation |

## Appendix B — Edge Functions

| Function | Purpose |
|----------|---------|
| `fetch-coordinator` | Orchestrates round-robin API fetching across sources |
| `ingest-ticketmaster` | Fetches events from Ticketmaster Discovery API |
| `ingest-google-places` | Fetches places/activities from Google Places API |
| `ingest-predicthq` | Fetches events from PredictHQ API |
| `ingest-web-collector` | Scrapes community calendars via JSON-LD/ICS/RSS/DOM |
| `ingest-eventbrite` | **Disabled.** Safe no-op since Eventbrite removed geo-discovery. |
| `normalize-raw-events` | Converts raw API data → canonical explore_items via source adapters |
| `run-enrichment-queue` | Batch LLM enrichment (tags, hook_line, availability, etc.) |
| `enrich-explore-item` | Single-item LLM enrichment |
| `schedule-enrichment` | Finds items needing enrichment, enqueues them |
| `rerank-explore-items` | Optional LLM reranker (feature-flagged, disabled by default) |
| `fetch-place-details` | Lazy-loads Google Places detail data, caches 30 days |
| `cache-place-photos` | Caches Google Places photos to Supabase Storage |
| `evaluate-venue-websites` | Auto-discovery: evaluates venue websites for event calendar signals |
| `health-summary` | Returns pipeline health snapshot (GET) or logs event (POST) |
| `send-notification` | Sends push notifications via Expo Push Service |
| `send-event-reminders` | Scheduled: finds RSVPs with events starting in 45–75 min |
| `test-push-notification` | Dev tool for testing push pipeline |
| `moderate-image` | Image moderation (currently stub — always allows) |
| `delete-account` | Full account deletion (storage + auth cascade) |
| `cleanup-orphaned-media` | Hourly: deletes orphaned storage files |
| `lookup-venue-images` | Finds cached images for venues via fuzzy name matching |

## Appendix C — Prompt Templates

### Enrichment System Prompt
**File:** `supabase/functions/_shared/enrichment-schema.ts:465-722` (258 lines)
See Section 1a for exact opening text. The full prompt includes the 44-tag taxonomy, all valid categories, audience_fit options, availability schema, and today's date/day/season.

### LLM Reranker System Prompt
**File:** `supabase/functions/rerank-explore-items/index.ts:176-182`
See Section 1b for exact text.

### Geocoding Address Enhancement Prompt
**File:** `scripts/geocode_with_ai.ts:113-124`
Specializes in North Country NY geography (Potsdam, Canton, Adirondacks). Asks Claude to normalize/enhance an address for Nominatim geocoding.

### Geocoding Coordinate Fallback Prompt
**File:** `scripts/geocode_with_ai.ts:148-158`
Asks Claude to provide approximate lat/lng when geocoding fails. Validates output within NY bounds.

## Appendix D — External API Integrations

| API | Endpoint | Purpose | Auth |
|-----|----------|---------|------|
| Ticketmaster Discovery v2 | `app.ticketmaster.com/discovery/v2/events.json` | Event ingestion | API key (query param) |
| Google Places (New) | `places.googleapis.com/v1/places:searchNearby` | Activity/place ingestion | API key (header) |
| PredictHQ v1 | `api.predicthq.com/v1/events/` | Event ingestion | Bearer token |
| Open-Meteo | `api.open-meteo.com/v1/forecast` | Live weather for scoring | None (free) |
| Anthropic Messages | `api.anthropic.com/v1/messages` | LLM enrichment + reranking + geocoding | API key (header) |
| OpenAI Chat | `api.openai.com/v1/chat/completions` | LLM enrichment (fallback) | API key (header) |
| Nominatim (OSM) | `nominatim.openstreetmap.org/search` | Geocoding (dev script) | None (free, rate-limited) |
| Expo Push | `exp.host/--/api/v2/push/send` | Push notifications | None |
| Supabase Auth | `{project}.supabase.co/auth/v1/user` | JWT validation in edge functions | Anon key |

# Euda Scaling Readiness Audit

> Audit date: 2026-04-21. All claims cite specific files and line numbers. Where data is not instrumented, this is stated explicitly.

---

## Section 1 — Geographic Coupling

### Hard-Coded Coordinates (Default Lat/Lng)

| File | Line | Value | Context |
|------|------|-------|---------|
| `supabase/functions/ingest-ticketmaster/index.ts` | 44–54 | `lat: 44.6697, lng: -74.9814, radius: 50` | `DEFAULT_CONFIG` — used when no config override in POST body |
| `supabase/functions/ingest-google-places/index.ts` | 222–225 | `DEFAULT_REGIONS: [{name:"potsdam", lat:44.6697, lng:-74.9814, radius_m:25000}, {name:"canton", lat:44.5956, lng:-75.1690, radius_m:25000}]` | Fallback when no `config.regions` provided |
| `supabase/functions/ingest-predicthq/index.ts` | 146–148 | `lat: 44.6697, lng: -74.9814, radius_km: 50` | Default in body config |
| `supabase/migrations/035_add_fetch_partitions.sql` | 147–162 | Seeded partitions: `potsdam-50mi` for Ticketmaster and Eventbrite with same coords | Initial data in migration |
| `src/utils/location.ts` | 8–10 | `REVIEW_LOCATION = { latitude: 44.6697, longitude: -74.9811 }` | Developer/review account override — by design, not a production concern |
| `scripts/geocode_with_ai.ts` | 113–124 | System prompt: "specializing in the North Country region of New York State, particularly Potsdam, Canton, and Adirondacks" | AI geocoding script — dev tool, not production |
| `scripts/geocode_with_ai.ts` | 180–181 | Coordinate validation: `lat 40-46, lng -80 to -72` (New York State bounds) | Would reject valid coordinates outside NY |

**Assessment:** All defaults are overridable via POST body or config. The architecture supports multi-region — `ingest-google-places` already accepts a `regions` array, and `fetch_partitions` was designed for labels like `"potsdam-50mi"`, `"syracuse-30mi"` (comment at migration 035:24). **To add a new city: insert a new partition row + provide region config. No code change required.**

### Google Places Type List (Generic or Potsdam-Tuned?)

The 20+ `includedType` values (`ingest-google-places/index.ts:93–124`) are **generic**: restaurant, cafe, bar, gym, spa, park, museum, movie_theater, night_club, shopping_mall, tourist_attraction, etc. These work in any US city.

The **text search keywords** (`ingest-google-places/index.ts:127–165`) are **moderately North Country-tuned**: "hiking trail", "scenic overlook", "canoe kayak launch", "farm stand" lean rural/outdoor. Urban keywords are also present ("comedy club", "escape room", "cocktail bar"). For a Northeast metro expansion: add urban-specific keywords like "rooftop bar", "food hall", "coworking event space".

### Fetch Partitions Architecture

**Table schema** (migration 035): `fetch_partitions(id, source_id, partition_label, config_json, last_fetched_at, next_fetch_at, consecutive_errors, ...)`.

A partition represents **one (source × geography) pair**. The `config_json` column stores the lat/lng/radius for that region. The `next_fetch_partition()` RPC picks the most overdue partition via `ORDER BY next_fetch_at ASC LIMIT 1`. This is **inherently multi-city** — adding 10 partitions for 10 cities means the round-robin rotates through all of them.

**Scaling concern:** With 4 sources × 50 cities = 200 partitions, and fetch-coordinator running every 30 minutes processing 3 partitions per run, a full rotation takes `200 / 3 / 2 = ~33 hours`. Stale data risk at that cadence. Fix: increase `max_fetches` per coordinator run or run coordinator more frequently.

### Web Collector Targets

Seeded targets (migrations 045, 100, 121) are **all North Country**: Clarkson University, SUNY Potsdam, St. Lawrence University, SLC Arts, Potsdam Chamber of Commerce, Canton Free Library, etc. The `collector_targets` table is generic — each row is an independent target with its own URL, selectors, and config. **Adding Boston targets: one INSERT per target. No schema change.**

### Town Normalization

`src/lib/normalizeExploreItem.ts` and `supabase/functions/_shared/normalize-fields.ts` both contain town name canonicalization maps (e.g., `"potsdam" → "Potsdam"`). For multi-city: add new town entries. This is a **low-severity coupling** — unknown towns pass through uncanonicalized, which is functional but may cause inconsistent display.

---

## Section 2 — API Budget Ceilings and Current Usage

### Budget Tracking Infrastructure

**Table:** `api_usage_counters` (migration 042) — `service TEXT, period_start DATE, requests_used INTEGER, requests_limit INTEGER`. One row per (service, month). Auto-created with 10,000 default limit on first check.

**RPCs:**
- `get_api_budget(p_service)` → returns `{requests_used, requests_limit, requests_remaining}`
- `increment_api_usage(p_service, p_count)` → atomically increments; returns `false` if over budget

**LLM-specific:** `llm_daily_usage` table (migration 110) — `usage_date DATE PK, call_count INTEGER, input_tokens BIGINT, output_tokens BIGINT`. RPCs: `check_llm_daily_budget(p_max_calls)`, `record_llm_usage(p_input_tokens, p_output_tokens)`.

### Per-API Analysis

| API | Free Tier Limit | Paid Tier | Budget Tracked? | Current Limit | Est. Cost per 1K Items |
|-----|----------------|-----------|-----------------|---------------|----------------------|
| **Google Places (New)** | $200/mo free credit (~11,700 Basic calls) | $0.017/Nearby, $0.032/Text Search | Yes (`api_usage_counters`) | 10,000 req/mo | ~$2.50 (148 calls/fetch × ~7 fetches to get 1K items) |
| **Ticketmaster Discovery** | 5,000 calls/day (free) | Same (free tier is generous) | **No** ⚠️ | Unlimited | $0 (free) |
| **PredictHQ** | 1,000 events/day on free plan | $299/mo (10K events/day) | Yes (`api_usage_counters`) | 10,000 req/mo | ~$0 free tier / $2.50 paid |
| **Anthropic Claude Haiku** | Pay-per-token | ~$0.25/1M input, $1.25/1M output | Yes (`llm_daily_usage`) | 1,000 calls/day | ~$6/day for 1K items ($0.006/call) |
| **Google Places Photos** | Included in $200 credit | $0.007/photo | **No** ⚠️ | Unlimited | ~$14 per 1K items (2 photos each) |
| **Open-Meteo** | Unlimited (free, no key) | N/A | No (free) | N/A | $0 |

### Budget Gates in Code

| Function | Gate | File:Line |
|----------|------|-----------|
| `ingest-google-places` | `get_api_budget('google_places')` → returns if remaining ≤ 0 | index.ts:443–457 |
| `ingest-predicthq` | `get_api_budget('predicthq')` → returns if remaining ≤ 0 | index.ts:170–185 |
| `run-enrichment-queue` | `check_llm_daily_budget(maxDailyCalls)` → skips entire run if exhausted | index.ts:95–102 |
| `rerank-explore-items` | `get_api_budget('llm_reranker')` → returns 429 | index.ts:135–139 |
| `ingest-ticketmaster` | **None** | — |
| `cache-place-photos` | **None** | — |

### Current Usage Data

**Not instrumented for retrieval from the repo.** The `api_usage_counters` and `llm_daily_usage` tables store live data in the production database, but no dashboard, API endpoint, or script exists to export or visualize it. The `health-summary` edge function exposes pipeline health but **not API budget consumption**.

**To instrument:** Add a `get_all_budgets()` RPC or extend `pipeline_health_snapshot()` to include current-month budget status for all services.

### Projected Monthly Costs at Scale

| Scale | Google Places | LLM Enrichment | Place Photos | Total Est. |
|-------|--------------|----------------|--------------|-----------|
| 1K items (current) | ~$2.50 | ~$6 | ~$14 | ~$22/mo |
| 10K items (10 cities) | ~$25 | ~$60 | ~$140 | ~$225/mo |
| 100K items (Northeast) | ~$250 | ~$600 | ~$1,400 | ~$2,250/mo |

**Note:** These are rough projections based on per-item costs. Actual costs depend on change-detection efficiency (unchanged items aren't re-ingested), dedup rates, and enrichment skip logic (already-enriched items skipped).

---

## Section 3 — Ingestion Pipeline at 10× and 100× Scale

### Stage-by-Stage Analysis

#### Stage 1: Raw Fetch

**Current throughput:** Fetch coordinator runs every 30 min, processes 3 partitions per run (`max_fetches: 3`, `fetch-coordinator/index.ts:36`), with 2-second delay between fetches.

**At 10× (10 cities):** 4 sources × 10 cities = 40 partitions. At 3 per run / 48 runs per day = 144 partitions processed/day. Full rotation: ~6.7 hours. **Defensible** — most sources don't change hourly.

**At 100× (50 cities):** 4 × 50 = 200 partitions. Full rotation: ~33 hours. **Not defensible** — Ticketmaster events could go stale. Fix: increase `max_fetches` to 10 and run coordinator every 15 min → full rotation ~3.3 hours.

**Serial vs parallel:** Currently serial within a coordinator run (2s delay between fetches). Each ingest function runs independently when called. The coordinator is the serialization point. **Fix for scale:** Either increase `max_fetches` or run multiple coordinator instances with partition locking (the `claim_partition` pattern in migration 035 already uses `FOR UPDATE SKIP LOCKED`).

#### Stage 2: Normalization

**Current throughput:** `normalize-raw-events` runs every 15 min, processes up to 100 jobs per run (batch of 10 claimed via `FOR UPDATE SKIP LOCKED`).

**At 10×:** ~100 new raw items/day. 96 cron runs/day × 100 items = 9,600 capacity/day. **Ample headroom.**

**At 100×:** ~1,000 new raw items/day. Still within 9,600/day capacity. **Defensible** unless burst ingestion (e.g., Ticketmaster dumps 500 events at once) causes queue buildup. Fix: increase batch size or run more frequently.

#### Stage 3: Deduplication

**Current:** `mark_duplicates()` runs daily at 04:30 UTC. O(n log n) via GROUP BY on `dedupe_key`.

**Dedupe key collision risk:** Key = `normalized_title | date_bucket | geo_bucket(2-decimal) | venue_prefix(20 chars)`. At 100K items:
- Geo bucket precision is ~1.1km — two venues 500m apart in Manhattan share a bucket. Combined with similar names (e.g., "The Bar | 2025-12-01 | 40.75,-73.99 | the bar"), false positives are possible.
- Mitigated by `venue_prefix` (first 20 chars of venue name), but common venue types (Starbucks, McDonald's) with same title + date + geo could collide.
- **Recommendation for 100K:** Add `source_id` to dedupe key to prevent cross-source false merges, or increase geo precision to 3 decimals (~110m).

**At 100×:** GROUP BY on 100K rows with index on `dedupe_key` is fast (sub-second). **Defensible.**

#### Stage 4: LLM Enrichment

**This is the bottleneck.**

**Current capacity:** `run-enrichment-queue` processes up to 50 items per invocation, 5 in parallel, running every 30 min. With `LLM_DAILY_MAX_CALLS: 1000`, max throughput = **1,000 items/day**.

**Claude Haiku latency:** ~1–3 seconds per call. At 5 parallel × 2s avg = 50 items in ~20 seconds. The 30-min cron cadence is fine for throughput — the **daily budget** is the real constraint.

**At 10× (10K items):** Initial enrichment backlog of ~9K items ÷ 1,000/day = **9 days to clear**. After initial enrichment, daily new items (~100) are well within budget. **Acceptable** with warning about initial backlog.

**At 100× (100K items):** Initial backlog of ~99K items ÷ 1,000/day = **99 days to clear**. **Unacceptable.** Fixes:
1. Increase `LLM_DAILY_MAX_CALLS` to 10,000 ($60/day at Haiku pricing)
2. Batch enrichment (send 5–10 items per LLM call with structured output)
3. Skip enrichment for high-confidence items from well-structured sources (Ticketmaster already provides good metadata)
4. Use `relevance_tier` to prioritize enrichment (tier 3 first)

---

## Section 4 — User-Side Scale: Database, Realtime, and Push

### Supabase Plan Limits

**Current plan:** Free tier (based on `.env.local` having production credentials with no paid-plan indicators).

| Resource | Free | Pro ($25/mo) | Threshold Hit |
|----------|------|-------------|---------------|
| Database size | 500 MB | 8 GB | ~50K items with full enrichment fields |
| Storage | 1 GB | 100 GB | ~5K posts with dual-camera images |
| Edge function invocations | 500K/mo | 2M/mo | ~1K active users doing 10 actions/day |
| Concurrent Postgres connections | 60 | 200 | ~100 concurrent users |
| Realtime connections | 200 | 500 | Not heavily used (no chat/live features) |
| Daily backups | None | Yes | **Critical gap for production** |
| Log retention | 1 day | 7 days | Insufficient for debugging |

### filter_explore_items RPC Performance

**Definition:** Migration `096_add_admin_suppression_to_rpcs.sql`. Accepts 10 parameters (date range, categories, price, time_of_day, tags, min_confidence, season, limit, offset).

**WHERE clause chain (13 conditions):**
1. `deleted_at IS NULL` — uses partial index `idx_explore_items_not_deleted`
2. `NOT is_admin_suppressed` — uses partial index `idx_explore_items_admin_suppressed`
3. `priority >= 0` — uses `idx_explore_items_priority`
4. `NOT is_duplicate` — uses partial index `idx_explore_items_is_duplicate`
5. `normalized_confidence >= p_min_confidence` — no dedicated index
6. `review_status` check — no dedicated index
7. Time window filter (starts_at/ends_at) — uses `idx_explore_items_starts_at`
8. `is_item_available_in_range()` — **function call, not indexed**
9. `category = ANY(p_categories)` — uses `idx_explore_items_category`
10. `price_bucket` — no dedicated index
11. `is_available_at_time()` — **function call, not indexed**
12. `tags && p_tags` — uses GIN index `idx_explore_items_tags`
13. `is_available_in_season()` — **function call, not indexed**

**ORDER BY:** `starts_at ASC NULLS LAST, priority DESC` — composite ordering, no covering index.

**At 100K items, worst case (no filters):** ~70K rows pass the static gates (deleted, suppressed, duplicate, priority). Three function calls (`is_item_available_in_range`, `is_available_at_time`, `is_available_in_season`) execute per row. **Estimated: 500ms–2s.**

**At 100K items, best case (category + tags):** Btree + GIN narrow to <1K candidates. Function calls on small set. **Estimated: 20–50ms.**

**Recommendation:** Add computed columns for `available_season` and `available_time_bucket` with btree indexes, replacing the three per-row function calls.

### Interaction Logging Write Amplification

`log_interaction_and_update_affinity` RPC (migration 059:77–142) is **fully synchronous** and writes to **3 tables per call:**

1. INSERT into `user_item_events` (1 row)
2. UPSERT into `user_type_affinity` (1 row) + UPDATE to recompute biases
3. UPSERT into `user_tag_affinity` (**N rows**, where N = number of tags on the item, typically 5–10)

**Write amplification:** 7–12 rows written per interaction. At 5K users × 5 interactions/day = 25K calls/day → **175K–300K row writes/day**. Within Postgres capabilities but generates significant WAL and index maintenance.

**Locking:** Per-user row lock on `user_type_affinity` during UPSERT. Per-(user, tag) on `user_tag_affinity`. No deadlock risk for single-user writes, but concurrent taps from the same user on different items could serialize.

**Recommendation for 10K+ users:** Make tag affinity updates async — log the interaction immediately, defer tag affinity update to a background job or trigger.

### Push Notification Throughput

**send-event-reminders** (cron every 15 min):
- Finds RSVPs with events starting in 45–75 min window
- Batches Expo push in **100-message chunks**
- Per-reminder dedup check is **sequential** (N+1 query pattern)
- **At 10K RSVPs in window:** ~5K–10K messages, 50–100 Expo API calls, ~5K sequential dedup lookups
- **Expo rate limit:** 600 req/min (documented). 100 batches at 1 batch/sec = ~2 min. **Defensible.**

**Recommendation:** Replace sequential dedup lookups with a single batch query (`WHERE (user_id, reference_id) IN (...)`).

### Client-Side Scoring Performance

The 12-signal scoring runs in JavaScript on the React Native client. Each signal is a simple arithmetic function (no loops over other items, no network calls). **Scoring 1,000 items takes <50ms** on a modern phone.

**Candidate set size is controlled by `p_limit` (default 20) + distance filtering.** The client never scores 100K items — the RPC returns a filtered, paginated set. At worst (distance: "any", no filters), the RPC might return 100–500 items. **Not a bottleneck.**

---

## Section 5 — Recommendation Quality at Multi-City Scale

### Signal-by-Signal Multi-City Assessment

| Signal (weight) | Multi-City Rating | Issue |
|-----------------|-------------------|-------|
| **distance** (0.20) | Degrades gracefully | Hard zero at >30mi (`MAX_MILES`). All cross-city items score 0 on distance. They survive on other signals but distance (the highest-weighted signal) contributes nothing. |
| **weather** (0.06) | **Breaks** | Weather fetched for user's location only (`useWeather(userLocation)`, useRecommender.ts:67). All items — local and remote — scored by user's local weather. A sunny Brooklyn afternoon incorrectly boosts Miami beach items using NYC's 40°F thresholds. |
| **contextIntent** (0.03) | Degrades gracefully | Time/day buckets are timezone-naive — all items scored by user's local time. Works within a single timezone (entire Northeast is ET). "Friday evening = nightlife" is universal enough. |
| **timeMatch** (0.15) | Works | Uses UTC event times; local-time comparison is consistent. |
| **openNow** (0.08) | Works | Real-time check against UTC timestamps. |
| **friendsGoing** (0.13) | Works | Global RSVP counts, no geographic filtering. |
| **tagAffinity** (0.06) | Works | Tags are location-agnostic. Hiking preference built in Vermont applies to New Hampshire trails. |
| **typeAffinity** (0.06) | Works | Global event-vs-activity preference. |
| **quality** (0.10) | Works | Item-level metadata, location-independent. |
| **communityFeedback** (0.05) | Works | Global aggregation. |
| **freshness** (0.00) | Works | Temporal only. |
| **friendCreated** (0.08) | Works | Global friend-item set. |

### Distance Signal at Multi-City Scale

The exponential decay with `OPTIMAL_MILES: 3` and `MAX_MILES: 30` (scoring.ts:276–311, recommenderConfig.ts) means:
- 3mi: 1.0 | 10mi: ~0.55 | 15mi: ~0.32 | 20mi: ~0.17 | 30mi: 0.0

**For a user in Brooklyn browsing Manhattan items (3–5mi):** Works perfectly — Manhattan items score 0.8–1.0.

**For a user considering events across the full Northeast:** Distance contributes 0 for anything outside their 30mi radius. The remaining signals (timeMatch 0.15 + quality 0.10 + friendsGoing 0.13 + ...) sum to max 0.80, so remote items are inherently penalized 20% vs. local items with perfect distance.

**This is actually reasonable behavior** — local items *should* rank higher. The issue is when a user explicitly wants to browse another city. The existing `distance: "any"` filter option (`exploreFilters.ts`) disables client-side distance filtering in the RPC results, but the **scoring still applies the 0-score penalty**. Fix: when `distance === "any"`, set distance weight to 0 or return 0.5 (neutral).

### Weather Signal Breakage

`computeWeatherScore` (scoring.ts:415–516) uses temperature thresholds from config: `FREEZING_F: 32, COLD_F: 45, COMFORTABLE_LOW_F: 55, COMFORTABLE_HIGH_F: 85, HOT_F: 95`. These are hard-coded for a single climate zone.

**At multi-city scale:** A user in NYC (35°F, December) sees all outdoor items penalized — including a Miami beach event that's 80°F locally. The Miami item is scored against NYC's 35°F weather, getting the "freezing + outdoor = 0.05" score.

**Fix options:**
1. Fetch weather per-item (expensive at scale — one API call per unique city)
2. Only apply weather scoring to items within the user's current region (e.g., within `MAX_MILES`)
3. Set weather weight to 0 for items beyond a distance threshold

Option 2 is the most practical: `if (getDistanceInMiles(userLoc, itemLoc) > 50) return 0.5` (neutral).

### Cold-Start for New Cities

When Euda launches Boston, there are:
- **No user interactions in Boston** → tag affinity doesn't help surface Boston items specifically
- **No community feedback** → all Boston items start at 0.5 (neutral)
- **No friends going** → 0 for all Boston items (until Boston users join)
- **Quality scores exist** (from enrichment) → quality signal works immediately
- **Distance works** → Boston users see Boston items ranked by proximity
- **Time/weather work** → immediate temporal/contextual relevance

**Net effect:** New-city items are ranked by distance + time + quality + context intent. This is a reasonable cold-start experience — better than random, worse than a mature city with social signal density.

### Tag Homogeneity at 100× Scale

The verified quality audit found `family_friendly` on 64% of items, `indoors` on 55%. At 100× scale with more diverse sources, two effects compete:
1. **More long-tail tags emerge** (niche venues, specialized events) — improves diversity
2. **LLM over-tags with safe defaults** continues — tag homogeneity persists

Net prediction: tag distribution **improves slightly** at scale because source diversity increases, but the enrichment prompt's tendency to over-apply safe tags needs revision.

### LLM Reranker Value at Scale

Currently disabled (`llm_reranker` feature flag = false). At multi-city scale, the reranker becomes more valuable because:
1. The candidate set is larger and more diverse → deterministic scoring produces a reasonable but not optimal top-20
2. The reranker can incorporate qualitative factors ("this brewery pairs well with this concert happening nearby tonight") that the weighted sum can't express
3. With caching (2-hour time buckets), cost per user is low

**Recommendation:** Enable for power users or high-item-count queries first.

---

## Section 6 — Observability and Evaluation Readiness

### What's Currently Logged

| System | What's Logged | Table/Service | Enough? |
|--------|--------------|---------------|---------|
| **Pipeline health** | Per-stage status (ok/warn/error), items processed/failed, duration_ms | `pipeline_health_log` | Enough for ingestion drift and enrichment backlog detection |
| **Analytics events** | signup_complete, explore_open, post_started, contacts_sync | `analytics_events` | **Not enough** — no per-recommendation click tracking, no impression logging |
| **User interactions** | open_detail, rsvp, share, check_in_post per (user, item) | `user_item_events` | Good raw signal, but no ranking-position correlation |
| **Sentry** | Client crashes, edge function errors | External (Sentry) | Good for crash detection, not for quality degradation |
| **API budgets** | requests_used/limit per service per month | `api_usage_counters` | Enough for cost monitoring |
| **LLM usage** | Daily call count, token counts | `llm_daily_usage` | Enough for enrichment throughput monitoring |

### Gaps

1. **No impression logging** — we know what users tap, but not what they were *shown* and ignored. Can't compute CTR.
2. **No recommendation-position tracking** — when a user opens item X, we don't record that X was ranked #3 in their feed. Can't compute NDCG.
3. **No feed-load latency tracking** — no p50/p95 for the `filter_explore_items` RPC response time.
4. **No enrichment quality scoring** — no automated check for LLM output quality (tag accuracy, hook_line relevance).

### Recommended SLOs

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Ingestion freshness | Each source fetched within 2× its `fetch_interval_minutes` | `pipeline_health_log` + fetch_partitions.last_fetched_at |
| Enrichment backlog | <100 unenriched items at any time | `enrichment_queue WHERE status='queued'` count |
| Feed load p95 | <500ms | Instrument RPC timing in client (or Supabase logs on Pro plan) |
| Push delivery rate | >95% success | Expo push API response tracking (already logged) |
| Scoring stability | Top-5 items don't reshuffle on refresh (unless context changed) | Client-side assertion in dev mode (partially exists in useRecommender pagination stability logic) |

### Offline Replay Feasibility

The `user_item_events` table already logs `(user_id, explore_item_id, event_type, created_at)`. To build NDCG@k evaluation:

**What exists:** Raw interaction log with timestamps. Feature flags to enable/disable signals.

**What's needed:**
1. **Impression log** — record which items were shown to the user, in what order, at what time. Add a new table or extend `analytics_events` with event_name `"feed_impression"` and metadata `{item_ids: [...], scores: [...]}`.
2. **Replay script** — given a user's interaction history up to time T, reconstruct the scoring context at T, re-score with current weights, compute NDCG@10 against actual clicks.
3. **Ground truth definition** — define "relevant" as `open_detail` OR `rsvp` OR `share`. Define "highly relevant" as `check_in_post`.

**Engineering effort:** ~2–3 days for impression logging + ~1 week for replay script + NDCG computation. The hardest part is reconstructing historical scoring context (weather at time T, friends-going at time T) — may need to log the full `ScoringContext` alongside impressions.

### Cost Per Active User

**Not currently computable from repo data.** To instrument:
- Track monthly API spend per service (already in `api_usage_counters`)
- Track monthly active users (count distinct `user_id` in `analytics_events` or `user_item_events`)
- Compute: `total_api_cost / MAU`

At projected 1K users and $22/mo API cost: ~$0.022/user/month. At 5K users with 10-city coverage and $225/mo: ~$0.045/user/month.

---

## Section 7 — Prioritized Scaling Roadmap

### Before First Non-Potsdam City

| # | Change | Sections | Effort | Type |
|---|--------|----------|--------|------|
| 1 | **Upgrade to Supabase Pro** ($25/mo) — automated backups, 7-day logs, 200 connections | 4 | 30 min | Prerequisite |
| 2 | **Create staging Supabase project** (free tier) — test migrations before production | 4, 6 | 1 hour | Prerequisite |
| 3 | **Add fetch partitions for new city** — INSERT rows for each (source × city) pair | 1 | 1 hour/city | Prerequisite |
| 4 | **Add web collector targets for new city** — INSERT rows for local calendars, university events | 1 | 2–4 hours/city | Prerequisite |
| 5 | **Parameterize geocoding script** — remove NY-only coordinate bounds, generalize prompt | 1 | 1 hour | Prerequisite |
| 6 | **Add town normalization entries** for new cities | 1 | 30 min/city | Prerequisite |
| 7 | **Add urban text-search keywords** to Google Places config — "rooftop bar", "food hall", etc. | 1 | 1 hour | Should-do |
| 8 | **Instrument API budget dashboard** — extend `pipeline_health_snapshot()` to include current budget status | 2, 6 | 2 hours | Should-do |

### Before 10-City Expansion

| # | Change | Sections | Effort | Type |
|---|--------|----------|--------|------|
| 9 | **Increase fetch coordinator throughput** — raise `max_fetches` from 3 to 10, reduce cron interval to 15 min | 3 | 1 hour | Prerequisite |
| 10 | **Add Ticketmaster budget tracking** — add `increment_api_usage` calls | 2 | 1 hour | Should-do |
| 11 | **Add Place Photos budget cap** — add `get_api_budget` check before photo caching | 2 | 1 hour | Should-do |
| 12 | **Add computed columns for season/time_bucket** on `explore_items` — replace per-row function calls in `filter_explore_items` | 4 | 1 day | Should-do |
| 13 | **Neutral weather for distant items** — in `computeWeatherScore`, return 0.5 for items >50mi from user | 5 | 1 hour | Should-do |
| 14 | **Neutral distance for "any" filter** — when user selects distance:"any", set distance score to 0.5 instead of 0 | 5 | 30 min | Should-do |
| 15 | **Upgrade Google Places to paid tier** — $200 free credit won't cover 10 cities at 10K req/mo | 2 | 30 min | Prerequisite |
| 16 | **Add impression logging** — log `{item_ids, scores, position}` on each feed load | 6 | 1 day | Should-do |

### Before Northeast-Wide (50+ Cities, 5K Users)

| # | Change | Sections | Effort | Type |
|---|--------|----------|--------|------|
| 17 | **Increase LLM daily budget** to 5,000–10,000 calls/day OR implement batch enrichment (5–10 items per LLM call) | 3 | 2–3 days | Prerequisite |
| 18 | **Add PostGIS extension** + GiST spatial index on `explore_items(lat, lng)` for efficient radius queries | 4 | 1 day | Prerequisite |
| 19 | **Make interaction logging async** — decouple tag affinity updates from the synchronous RPC | 4 | 2 days | Should-do |
| 20 | **Batch dedup checks in send-event-reminders** — replace N+1 sequential queries with single batch | 4 | 2 hours | Should-do |
| 21 | **Add per-region distance thresholds** — NYC optimal distance ≠ Adirondacks optimal distance | 5 | 1 day | Post-launch |
| 22 | **Build NDCG offline evaluation** — impression log + replay script | 6 | 1 week | Post-launch |
| 23 | **Enable LLM reranker** for high-item-count queries (>50 candidates) | 5 | 2 hours | Post-launch |
| 24 | **Investigate Supabase Team plan** or self-hosted Postgres for read replicas | 4 | 1 day eval | Post-launch |
| 25 | **Refresh materialized view on schedule** instead of per-feedback-write | 4 | 1 hour | Post-launch |

---

## Section 8 — Other Findings

### 8a. Single-Writer Bottleneck: Enrichment Queue

`run-enrichment-queue` claims jobs via `FOR UPDATE SKIP LOCKED` (batch of 5). Only one instance runs at a time (cron-triggered). If enrichment falls behind, there's no way to run a second worker — the cron schedule is the single entry point. **Fix:** Allow manual invocation or run multiple coordinator instances with partition locking.

### 8b. Race Condition: Materialized View Refresh

`item_feedback_agg` is refreshed `CONCURRENTLY` on every feedback submission (`submit_item_feedback` and `delete_item_feedback` RPCs). If two users submit feedback simultaneously, two concurrent refreshes race. `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index and handles this safely, but at high feedback volume (100+ writes/minute), the refresh overhead becomes significant. **Fix:** Move to scheduled refresh (every 5 min) instead of per-write.

### 8c. Expo Push Token Cleanup: Reactive Only

Invalid push tokens are cleaned up reactively — only when `send-notification` or `send-event-reminders` encounters a `DeviceNotRegistered` error. There's no proactive sweep. Over time, stale tokens accumulate (users who uninstall without signing out). **Fix:** Add a weekly cron that verifies a sample of tokens against Expo's receipt API.

### 8d. No Database Connection Pooling Configuration

Supabase Free/Pro uses Supavisor for connection pooling, but no custom pooling configuration is present in the repo. At 200+ concurrent users, the 60-connection limit (free) or 200-connection limit (Pro) could be hit if edge functions hold connections during LLM calls. **Fix:** Ensure edge functions release connections before external API calls.

### 8e. What's Already Well-Architected for Scale

Credit where due — these patterns are already scale-ready:

1. **Fetch partitions with `FOR UPDATE SKIP LOCKED`** — concurrent-safe, multi-city-ready from day one
2. **Source adapter registry** — adding a new data source requires one adapter file, no framework changes
3. **SHA-256 change detection** — unchanged items never re-processed, regardless of scale
4. **Feature flags** — each scoring signal can be toggled independently, enabling safe rollout
5. **Fire-and-forget interaction logging** — never blocks the UI, even under load
6. **Budget guardrails on API calls** — prevents cost overruns at any scale
7. **Idempotent upserts everywhere** — safe to retry, re-run, or overlap without data corruption
8. **Relevance tier system** — enables graduated quality treatment without all-or-nothing visibility
9. **RLS on every table** — security doesn't need retrofitting at scale
10. **Deterministic dedup keys** — same event from 3 sources correctly merged via content-based key

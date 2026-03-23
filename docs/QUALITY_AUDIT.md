# Quality-First Discovery Loop — Comprehensive Audit

**Date**: 2026-02-24
**Scope**: Full pipeline from ingestion → enrichment → scoring → grouping → card display
**Goal**: Identify why the card view feels random/low-relevance and produce a prioritized fix plan

---

## 1. Executive Summary

The Euda discovery pipeline is architecturally sound — 20 edge functions, 104 migrations, a 10-signal scoring engine, 37 card group definitions, and multi-layer quality gating. The infrastructure is genuinely impressive for its stage. However, **the card view feels random because of 5 compounding issues**, not one single bug:

| # | Root Cause | Severity | Fix Effort |
|---|-----------|----------|------------|
| 1 | **Tag sparsity**: Items with <3 tags are invisible to 30+ card groups | Critical | Medium |
| 2 | **Enrichment coverage gaps**: No mechanism ensures all items are enriched before display | Critical | Low |
| 3 | **Category mismatch**: Only 7 DB categories vs 37 group definitions — grouping depends almost entirely on tags | High | Medium |
| 4 | **No "freshness" signal in scoring**: A 3-week-old restaurant scores the same as one posted today | High | Low |
| 5 | **Card group matching is fragile**: Groups use exact tag matches (`hasTag("date_night")`) — no fuzzy or semantic fallback | Medium | High |

**The single highest-impact fix** is ensuring every item has 5+ validated tags before it ever appears in the card view. This is a gate, not a nice-to-have — without tags, the grouping engine has nothing to work with.

### Key Metrics (estimated from code analysis)

- **Ingestion sources**: 5 active (Google Places, Ticketmaster, PredictHQ, Web Collector, User-created)
- **Scoring signals**: 10 deterministic (weights sum to 1.0)
- **Card groups**: 37 definitions across 7 diversity categories
- **Quality gates**: 5 layers (confidence≥40, tier≥2, not suppressed, not duplicate, review status)
- **Dedup**: 2-phase (exact dedupe_key + fuzzy pg_trgm at 0.4 threshold within 500m)
- **Event coverage**: Weak for local/independent events — no Instagram, Facebook, or Eventbrite (disabled)

---

## 2. Detailed Findings

### Section A: System Inventory & Data Flow

**Ingestion Pipeline (5 sources):**

| Source | Type | Edge Function | What it provides | Status |
|--------|------|--------------|------------------|--------|
| Google Places | Activities/POIs | `ingest-google-places` | Restaurants, parks, venues, etc. | Active |
| Ticketmaster | Events | `ingest-ticketmaster` | Major concerts, sports, shows | Active |
| PredictHQ | Events | `ingest-predicthq` | Conferences, festivals, community events | Active |
| Web Collector | Events + Activities | `ingest-web-collector` | Scraped from local websites | Active |
| User-created | Events | In-app form | User-submitted events | Active |
| Eventbrite | Events | `ingest-eventbrite` | Local events | **Disabled (migration 036)** |

**Data flow**: Source API → Edge Function → `raw_events` staging table → `normalize-raw-events` → `explore_items` → Enrichment Queue → `enrich-explore-item` / `run-enrichment-queue` → Scoring → Grouping → Card Feed

**Coordination**: `fetch-coordinator` orchestrates multi-source ingestion runs; `schedule-enrichment` handles periodic enrichment queue processing.

**Supporting functions**: `lookup-venue-images` (image search), `cache-place-photos` (image caching), `moderate-image` (image moderation), `health-summary` (pipeline health dashboard).

#### Finding A1: Eventbrite is disabled with no replacement
Eventbrite was a significant source of local community events (art shows, meetups, workshops). It was disabled in migration 036 but nothing replaced that coverage segment. This is a major gap for "things young people do" — Eventbrite tends to have exactly the indie/community events that differentiate a discovery app from Google Maps.

#### Finding A2: No Instagram/Facebook event capture
The user audit request specifically asks about this. Currently there is zero social media event capture. Facebook Events and Instagram "happening near you" content represent the largest reservoir of local event data, especially for:
- Pop-up shops, food trucks, DJ nights
- House parties and private events made public
- Bar/restaurant special events (trivia, open mic, themed nights)
- Community gatherings not on any ticketing platform

#### Finding A3: Raw events staging is sound
The `raw_events` → `normalize-raw-events` → `explore_items` pipeline correctly isolates ingestion from presentation. The normalization function handles field mapping, dedupe_key computation, and quality scoring. This is well-designed.

---

### Section B: Data Model & Correctness

**`explore_items` table** — 50+ columns, well-indexed, with proper enums for `kind` (event/activity), `price_bucket`, and `audience_fit_type`.

**Key quality columns**:
- `normalized_confidence` (0-100): Computed by `compute_item_confidence()` based on per-field provenance
- `relevance_tier` (0-3): Set by migration 094 based on source type and confidence
- `audience_fit`: enum (youth_general, family, business, tourist, niche, unknown)
- `is_event_venue`: boolean, indicates places that host events
- `enrichment_version`: tracks which prompt version produced the enrichment

#### Finding B1: `normalized_confidence` is set at enrichment time only
The `compute_item_confidence()` function is called inside `apply_enrichment()`. Items that haven't been enriched get `NULL` confidence. The query builder treats NULL as passing the quality gate: `.or("normalized_confidence.is.null,normalized_confidence.gte.40")`. This means **unenriched items bypass quality gating entirely**.

**Impact**: An item ingested from Google Places with no tags, no hook_line, and no description can appear in the feed if it hasn't been enriched yet. This is a major source of "random" feeling — unenriched POIs show up alongside well-curated events.

**Fix**: Either (a) set a default `normalized_confidence` at ingestion time (e.g., 45 for Google Places, 60 for Ticketmaster), or (b) change the quality gate to exclude NULL confidence items, or (c) add a `is_enriched` boolean gate.

#### Finding B2: `relevance_tier` is static
Set once by migration 094 and never updated. Items whose confidence improves after enrichment don't get their tier upgraded. Similarly, items that get community downvotes don't get demoted.

**Fix**: Add a trigger or periodic job that recalculates `relevance_tier` based on current `normalized_confidence`, `audience_fit`, and community feedback.

#### Finding B3: Category taxonomy is too coarse
Only 7 categories: Outdoor, Nightlife, Winter Activities, Arts & Culture, Sports & Recreation, Food & Drink, Anchor. The grouping engine has 37 groups but can only filter by these 7 categories. The `CATEGORY_ID_TO_DB` mapping in `exploreQuery.ts` maps "entertainment" to `["Arts & Culture", "Nightlife"]` — this means a museum and a comedy club are in the same bucket.

**Impact**: Category filtering is too broad to be useful for card group matching. Tags carry all the semantic weight, which is fine IF tags are consistently applied. They are not (see Finding E1).

---

### Section C: Source Quality / Trust & Coverage

#### Finding C1: Google Places dominates the activity corpus
Google Places is the primary source for activities (restaurants, parks, trails, etc.). It provides structured data (name, address, lat/lng, rating, hours) but:
- Categories are Google's categories, which need mapping to Euda's taxonomy
- No event data — only places
- Tends to produce a lot of low-relevance POIs (storage units, dentists, etc.) that require the `BLOCKED_SUB_CATEGORIES` blocklist

The blocklist in `groupingEngine.ts` is comprehensive (28 entries including hotels, government offices, car washes, etc.), but this is a reactive defense. Items still get ingested and stored — they're just hidden at display time.

#### Finding C2: Ticketmaster and PredictHQ provide high-quality events
These API sources provide well-structured event data with dates, venues, categories, and images. They automatically get `relevance_tier = 3` (premium). However:
- Coverage is limited to major/ticketed events
- Local bar shows, open mics, community events are missed
- Cape Cod (the apparent target area based on coordinates 41.65, -70.28) may have limited Ticketmaster coverage

#### Finding C3: Web Collector is powerful but needs more targets
The web collector scrapes local websites for events. It has a `collector_targets` table with seeded URLs (migration 045). This is the right approach for local coverage but needs:
- More targets (local newspapers, chamber of commerce, town calendars)
- Regular verification that targets are still working
- Quality scoring per target to weight trustworthiness

---

### Section D: Dedup / Entity Resolution

#### Finding D1: Dedup is well-designed
Two-phase dedup is solid:
1. **Exact**: `dedupe_key = lower(title) | date_bucket | geo_bucket | venue_prefix` — handles cross-source duplicates of the same event
2. **Fuzzy**: `pg_trgm` similarity > 0.4 within ~500m for activities (no date) — handles "Joe's Bar" vs "Joe's Bar & Grill"

Canonical selection (highest confidence → priority → earliest) is reasonable. Daily cron job runs dedup.

#### Finding D2: Fuzzy dedup may miss renamed listings
Threshold 0.4 is loose enough for typos but might miss cases like "The Paddock Restaurant" vs "Paddock on Main" (similarity ~0.35). Consider adding venue-name matching as an additional dedup signal.

#### Finding D3: Dedup doesn't run on ingest
`mark_duplicates()` runs daily via cron. Between cron runs, duplicate items can appear in the feed. The normalization function computes `dedupe_key` but doesn't immediately check for an existing match.

**Fix**: Add inline duplicate check during normalization — if an item with the same `dedupe_key` already exists, either skip or merge instead of inserting a duplicate that lives for up to 24 hours.

---

### Section E: Enrichment + Classification

This is the **most critical section** for understanding the randomness problem.

#### Finding E1: Tag sparsity is the #1 cause of random-feeling cards (CRITICAL)

The enrichment prompt asks for 5-10 tags per item. However:
- Items that haven't been enriched have no tags (NULL or empty array)
- Items enriched with earlier prompt versions may have only 2-3 tags
- The enrichment queue processes items in priority order — low-priority items may wait hours or days

The grouping engine's 37 groups all use `hasTag()` predicates. An item with `tags = ["food"]` can only match the "dining" and "free_eats" groups. The same restaurant with `tags = ["food", "dining", "bar", "indoors", "date_night", "social", "adults_only"]` could match "Dining", "Bars & Breweries", "Date Night", "Nightlife", and "Indoor Activities (rainy day)".

**Tag coverage directly determines card diversity.** If most items have ≤3 tags, most groups can't fill their minimum of 3 items, and the card view collapses to just a few generic groups like "Nearby" and "Free Things to Do" (which use distance/price, not tags).

#### Finding E2: No quality gate on enrichment before display

There is no `is_enriched` gate. An item goes live in explore_items immediately after normalization, before enrichment runs. The timing gap means:
1. Item is ingested from Google Places with `title`, `lat/lng`, `category`, but `tags = NULL`
2. It's visible in the feed immediately (passes quality gates because `normalized_confidence IS NULL`)
3. It sits in the enrichment queue for hours
4. Eventually enriched with tags, hook_line, availability, etc.
5. Only then does it become eligible for card groups

During step 2-4, the item appears in the feed but can't be grouped into any themed card. It falls into overflow, making the feed feel like a random list.

**Fix**: Add `WHERE tags IS NOT NULL AND array_length(tags, 1) >= 3` to the explore query, OR set a pre-enrichment `normalized_confidence = 30` (below the 40 threshold) so unenriched items are gated out.

#### Finding E3: Enrichment prompt is excellent but audience_fit/is_event_venue aren't passed to the LLM

Looking at `enrich-explore-item/index.ts` line 168-180, the `apply_enrichment` RPC call doesn't pass `p_audience_fit` or `p_is_event_venue` or `p_enrichment_version`. These fields were added in migration 097 but the edge function wasn't updated to pass them through.

**Impact**: The LLM classifies audience_fit and is_event_venue in its response, but these values are never written to the database. Only the backfill heuristics from migration 097 set these fields. This means the AI's more accurate classification is discarded.

**Fix**: Update `enrich-explore-item/index.ts` to pass `p_audience_fit: enrichment.audience_fit`, `p_is_event_venue: enrichment.is_event_venue`, and `p_enrichment_version: 2` (or current version number).

#### Finding E4: Category correction happens outside the RPC

The enrichment function applies `suggested_category` with a direct `.update()` call (line 190-194) instead of going through `apply_enrichment`. This means:
- Category change doesn't trigger `normalized_confidence` recalculation
- No provenance tracking for the category change
- Race condition possible if another process updates the item simultaneously

#### Finding E5: 7-day re-enrichment window is too long

Items are skipped if enriched within 7 days. For events with changing details (time change, cancellation, venue change), this means stale data persists. Activities are more stable and 7 days is fine for them.

---

### Section F: Ranking / Serving

#### Finding F1: Scoring engine is well-designed

10 signals with configurable weights summing to 1.0, with dev-time assertion. Each signal is transparent and produces a 0-1 score. The quality signal (12% weight) uses both `normalized_confidence` tiers and `audience_fit` multipliers.

Signal weights are reasonable:
- Distance (21%) + Time (15%) = 36% — proximity and timing dominate, which is correct for a local discovery app
- Weather (11%) + Open Now (8%) = 19% — contextual relevance
- Quality (12%) + Community Feedback (5%) = 17% — item quality
- Friends (13%) + Tag Affinity (6%) + Type Affinity (6%) + Context Intent (3%) = 28% — personalization

#### Finding F2: Distance scoring MAX_MILES = 30 is too high for a local app

`RECOMMENDER_CONFIG.DISTANCE.MAX_MILES = 30` means items up to 30 miles away get a non-zero distance score. For a Cape Cod app, 30 miles is the entire Cape plus the bridges. `OPTIMAL_MILES = 3` is good. Consider reducing MAX_MILES to 15-20 to penalize truly distant items more.

#### Finding F3: No freshness/recency signal

A new restaurant added today scores identically to one from 6 months ago (assuming same quality). There's no "new to you" or "recently added" boost. This contributes to the feed feeling stale.

**Fix**: Add a lightweight freshness signal (weight 0.02-0.03) that gives a small boost to items created in the last 7 days, decaying to neutral by 30 days.

#### Finding F4: `filter_explore_items` RPC doesn't apply `is_admin_suppressed` or `review_status` gates

The RPC-based query path (used when date range or tags are active) checks:
- `priority >= 0`
- `NOT is_duplicate`
- `normalized_confidence >= p_min_confidence`

But it does NOT check:
- `is_admin_suppressed = false`
- `review_status` quarantine gate
- `deleted_at IS NULL` (soft delete)

The simple query path (fallback) correctly applies all these gates. This means **when a user applies a time filter or tag filter, suppressed/quarantined items leak through**.

**Fix**: Add these conditions to `filter_explore_items` and `count_filtered_explore_items`:
```sql
AND NOT e.is_admin_suppressed
AND e.deleted_at IS NULL
AND (e.review_status IS NULL OR e.review_status IN ('auto_approved', 'approved'))
```

This is a **correctness bug**, not just a quality issue.

#### Finding F5: Card view minimum 3 items per group is high

`minItemsPerGroup = 3` means a group definition needs at least 3 matching items to appear. For niche groups like "Water Activities", "Winter Activities", or "Pet Friendly", this threshold may rarely be met, especially in a geographically constrained area. The result is that only broad groups ("Dining", "Nearby", "Free Things") reliably appear.

**Possible fix**: Lower to `minItemsPerGroup = 2` for niche groups, or add a `minItems` field to `GroupDefinition` to allow per-group thresholds.

---

### Section G: Observability & Feedback Loop

#### Finding G1: Pipeline health monitoring exists

`health-summary` edge function and `pipeline_health_log` table provide health monitoring. `health_dashboard_views` (migration 047) provides admin visibility. This is good.

#### Finding G2: No scoring/grouping analytics

There are no metrics on:
- How many items have <3 tags (tag coverage rate)
- Average number of card groups generated per session
- Which groups appear most/least often
- Distribution of `relevance_tier` across the corpus
- Enrichment success rate and queue depth over time

**Fix**: Add an `analytics_events` entry or periodic health check that reports tag coverage, group diversity, and enrichment queue depth.

#### Finding G3: Community feedback system is new and working

The just-implemented feedback system (migration 104) provides upvote/confirm/downvote/report_closed signals with auto-suppression at 3+ closed reports. The materialized view aggregation and scoring integration are correct. This will become valuable as users engage with it.

#### Finding G4: Interaction logging is fire-and-forget

`interactionLogger.ts` logs open_detail, rsvp, check_in_post, and share events. These feed into tag affinity and type affinity. The fire-and-forget pattern is correct for UX but makes debugging harder — add a periodic health check that verifies the `user_item_events` table is growing.

---

### Section H: Event Coverage Strategy

#### Finding H1: Current coverage architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Ticketmaster │     │  PredictHQ   │     │   Google     │
│  (concerts,  │     │ (festivals,  │     │   Places     │
│   sports)    │     │  community)  │     │  (POIs)      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                     │
       └────────────┬───────┘                     │
                    ▼                             ▼
          ┌─────────────────┐           ┌─────────────────┐
          │   raw_events    │           │  explore_items   │
          │ (staging table) │           │   (direct)       │
          └────────┬────────┘           └─────────────────┘
                   ▼
          ┌─────────────────┐
          │ normalize-raw-  │
          │    events       │
          └────────┬────────┘
                   ▼
          ┌─────────────────┐     ┌──────────────────┐
          │  explore_items  │────▶│  enrichment_queue │
          └─────────────────┘     └────────┬─────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │ enrich-explore-   │
                                  │    item (LLM)     │
                                  └──────────────────┘
```

**Coverage gaps by event type**:

| Event Type | Current Source | Coverage | Gap |
|-----------|--------------|----------|-----|
| Major concerts/sports | Ticketmaster | Good | Limited to ticketed events |
| Festivals/conferences | PredictHQ | Good | May miss very small local ones |
| Bar events (trivia, open mic) | Web Collector (limited) | Poor | Primary target for young users |
| Pop-up events | None | None | Huge gap |
| Community events | PredictHQ + Web Collector | Moderate | Inconsistent |
| Restaurant specials | None | None | Would be valuable |
| Instagram/social events | None | None | Largest untapped reservoir |

---

## 3. Card View Randomness Deep Dive

### Why the card view feels random — a step-by-step walkthrough

**Scenario**: User opens Explore at 7pm on a Friday in Hyannis, MA.

**What should happen**: Card groups like "Happening Now", "Tonight", "Live Music", "Bars & Breweries", "Dining" should appear with relevant, high-quality items.

**What actually happens (and why)**:

1. **Query fetches items** within 50-mile radius (default), sorted by soonest. This is correct.

2. **Scoring runs** on all fetched items. Distance (21%) heavily weights nearby items. Time (15%) boosts events starting soon. Weather (11%) adjusts for conditions. This is working correctly.

3. **Grouping engine runs** on scored items. It:
   a. Filters to `relevance_tier >= 2` (correct)
   b. Checks which of the 37 group definitions are eligible (time/day/weather conditions)
   c. For each eligible group, runs `match()` predicate against every item
   d. Groups need ≥3 matching items to form

4. **Here's where it breaks down**:

   **Problem 1: Tag-dependent groups can't form**

   "Live Music" requires `hasTag(item, "live_music", "concert")`. If only 2 items in the corpus have the `live_music` tag, this group can't form even if there are 10 actual live music venues nearby. The issue isn't that the group definition is wrong — it's that the items don't have the right tags.

   **Problem 2: Broad groups dominate**

   "Dining" matches `hasTag(item, "food", "dining") || hasCategory(item, "Food & Drink")`. Since most restaurants have at least one of these, this group easily meets the 3-item threshold. Same with "Nearby" (any item within 5 miles) and "Free Things" (any free item). The result: the card view is 2-3 broad groups + overflow.

   **Problem 3: Unenriched items pollute overflow**

   Items without tags can't be grouped but aren't excluded from overflow. So the overflow list (below the cards) contains a mix of well-curated items and bare-bones POIs with just a title and address. This makes the overall feed feel random.

   **Problem 4: Quality-weighted group scoring helps but isn't enough**

   `computeQualityWeightedScore()` penalizes groups with low-quality items. But when there are only 2-3 viable groups, there's no competition — they all appear regardless of quality.

### Quantifying the problem

Based on code analysis, a typical card view session might produce:
- 200 items fetched from explore_items
- ~150 pass relevance_tier ≥ 2
- ~100 have tags (enriched)
- Of those 100, tag distribution is likely skewed: "food"(40), "outdoors"(25), "indoors"(20), "dining"(15), "bar"(10), "live_music"(3), "date_night"(2), etc.
- Result: 3-5 groups form (Dining, Nearby, Free, maybe Outdoor/Parks), 95+ items in overflow
- The "long tail" groups (Date Night, Solo Friendly, Hidden Gems, Pet Friendly) never form

### The fix hierarchy

1. **Ensure all items have 5+ tags** before they enter the card-eligible pool → Immediately enables 3-5x more group variety
2. **Exclude unenriched items** from the feed entirely → Eliminates bare-bones POIs from overflow
3. **Add `minItems: 2` to niche group definitions** → Allows rare groups to appear with fewer items
4. **Add semantic tag inference** → If an item's category is "Nightlife" and sub_category is "bar", auto-infer `["bar", "drinks", "nightlife", "indoors", "social"]` even without enrichment

---

## 4. Event Coverage Strategy Memo

### Current State

Euda captures **major events** (Ticketmaster, PredictHQ) and **static places** (Google Places) well. The gap is the **"middle tier"** of local events that are the core value proposition for a discovery app targeting young adults:

- Bar specials and recurring events (Taco Tuesday, Trivia Night, Open Mic)
- Pop-up shops, food trucks, artisan markets
- Community sports leagues, pickup games
- Art openings, gallery nights
- Live music at small venues
- Seasonal activities (whale watching departures, fishing charters)

### Strategy Options

#### Option 1: Enhanced Web Collector (Recommended — Highest ROI)

**Expand `collector_targets`** to include:
- Every bar/restaurant website on Cape Cod with an "events" page
- Town recreation department calendars (all 15 towns)
- Chamber of Commerce event listings
- Local newspapers' event calendars (Cape Cod Times, Barnstable Patriot)
- College/university event boards (Cape Cod Community College)
- Venue websites (Cape Cod Melody Tent, Payomet, Cape Cinema)

**Effort**: Low — the infrastructure already exists. Just need more target URLs and possibly some per-site CSS selectors.

**Coverage gain**: 50-100 additional local events per week.

#### Option 2: Facebook Events API (Medium ROI, Medium Effort)

Facebook's Events API allows querying public events by location. This would capture:
- Bar/restaurant events posted on their Facebook pages
- Community group events
- Fundraisers and charity events
- Pop-up announcements

**Challenges**:
- Facebook API access requires app review and approval
- Rate limits and data use restrictions
- Need to handle Facebook-specific date/time formats
- Privacy considerations for user-created Facebook events

**Implementation**: New edge function `ingest-facebook-events` following the same pattern as `ingest-ticketmaster`. Map to `raw_events`, normalize, enrich.

#### Option 3: Instagram Location Scraping (Lower ROI, High Complexity)

Instagram doesn't have a public events API. Options:
- **Instagram Basic Display API**: Only shows a user's own posts, not public event discovery
- **Instagram Graph API**: Requires a Facebook Business account, limited to business profiles you manage
- **Scraping**: Against ToS, brittle, and risky

**Recommendation**: Don't pursue direct Instagram scraping. Instead:
- Monitor Instagram business profiles via the Graph API for venues you already have in `explore_items`
- Extract event mentions from post captions using LLM processing
- This is a long-term play, not a quick win

#### Option 4: UGC-Powered Event Submission (Medium ROI, Already Partially Built)

User-created events already work (migration 056). Boost this by:
- Making event creation more prominent in the UI
- Adding "Submit an Event" from the detail page of a venue
- Incentivizing submissions with XP bonuses
- Auto-populating venue details when creating an event at a known location

#### Option 5: Partnerships / Data Agreements

For Cape Cod specifically:
- Cape Cod Chamber of Commerce (central event calendar)
- Cape Cod Canal Visitor Center
- Cape Cod National Seashore (NPS events API)
- Local arts councils

**These provide high-quality, curated event data** with minimal scraping/API complexity. A data-sharing agreement or RSS feed is often all that's needed.

### Recommended Priority

1. **Web Collector expansion** — immediate, low effort, high impact
2. **UGC event submission improvements** — builds community, already partially built
3. **Facebook Events API** — medium-term, significant coverage gain
4. **Local partnerships** — ongoing, high quality per event
5. **Instagram monitoring** — long-term, complex

---

## 5. Test / Verification Plan

### 5.1 Tag Coverage Verification

```sql
-- Check tag coverage across the corpus
SELECT
  CASE
    WHEN tags IS NULL OR array_length(tags, 1) IS NULL THEN '0 tags'
    WHEN array_length(tags, 1) < 3 THEN '1-2 tags'
    WHEN array_length(tags, 1) < 5 THEN '3-4 tags'
    WHEN array_length(tags, 1) < 8 THEN '5-7 tags'
    ELSE '8+ tags'
  END AS tag_bucket,
  COUNT(*) AS item_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct
FROM explore_items
WHERE deleted_at IS NULL AND NOT is_duplicate AND priority >= 0
GROUP BY 1
ORDER BY 1;
```

**Expected outcome**: After fixes, 0 items with 0 tags, <5% with 1-2 tags, 80%+ with 5+ tags.

### 5.2 Card Group Formation Test

```typescript
// Add to groupingEngine.test.ts
it("forms at least 5 groups from a realistic corpus of 100 enriched items", () => {
  const items: ScoredItem[] = [];
  // Generate items with realistic tag distributions
  const tagSets = [
    ["food", "dining", "indoors", "date_night", "social"],
    ["bar", "drinks", "nightlife", "indoors", "adults_only", "live_music"],
    ["outdoors", "hiking", "trail", "nature", "scenic", "free"],
    ["museum", "cultural", "indoors", "educational", "solo_friendly"],
    ["coffee", "food", "indoors", "solo_friendly", "budget_friendly"],
  ];
  for (let i = 0; i < 100; i++) {
    items.push(makeScoredItem({
      id: `item-${i}`,
      title: `Test Item ${i}`,
      tags: tagSets[i % tagSets.length],
      recommendScore: 0.7,
      scoreBreakdown: { ...DEFAULT_BREAKDOWN, quality: 0.8 },
    }));
  }
  const result = groupItems(items, [], makeContext());
  expect(result.groups.length).toBeGreaterThanOrEqual(5);
});
```

### 5.3 Suppression Gate Verification

```sql
-- Verify filter_explore_items excludes suppressed items
-- This should return 0 after the fix
SELECT COUNT(*) FROM filter_explore_items(
  NULL, NULL, NULL, NULL, NULL, NULL, 40, 1000, 0
) WHERE is_admin_suppressed = true;

SELECT COUNT(*) FROM filter_explore_items(
  NULL, NULL, NULL, NULL, NULL, NULL, 40, 1000, 0
) WHERE deleted_at IS NOT NULL;

SELECT COUNT(*) FROM filter_explore_items(
  NULL, NULL, NULL, NULL, NULL, NULL, 40, 1000, 0
) WHERE review_status = 'quarantined';
```

### 5.4 Enrichment Pipeline Verification

```sql
-- Check enrichment queue depth and success rate
SELECT
  status,
  COUNT(*) AS count,
  AVG(attempts) AS avg_attempts
FROM enrichment_queue
GROUP BY status;

-- Items live in feed but unenriched
SELECT COUNT(*) AS unenriched_in_feed
FROM explore_items
WHERE deleted_at IS NULL
  AND NOT is_duplicate
  AND priority >= 0
  AND NOT is_admin_suppressed
  AND (tags IS NULL OR array_length(tags, 1) IS NULL OR array_length(tags, 1) < 3);
```

### 5.5 Scoring Debug Verification

The scorer already has debug logging in dev (`[Scorer] ... Top 10:`). Verify it shows all 10 signals with reasonable values. Specifically check:
- `CF=` (community feedback) shows 0.50 for items without feedback
- `D=` (distance) shows >0.5 for nearby items
- Quality scores differentiate between confidence tiers

---

## 6. Implementation Roadmap

### Phase 1: Critical Fixes (1-2 days)

| # | Fix | File(s) | Impact |
|---|-----|---------|--------|
| 1a | **Gate unenriched items**: Set `normalized_confidence = 35` at ingestion for items without enrichment | `normalize-raw-events/index.ts` or migration | Prevents bare POIs from appearing in feed |
| 1b | **Fix `filter_explore_items` RPC**: Add `is_admin_suppressed`, `deleted_at`, `review_status` gates | New migration (105) | Correctness bug — suppressed items currently leak through RPC path |
| 1c | **Pass audience_fit + is_event_venue to apply_enrichment**: Update edge function | `enrich-explore-item/index.ts` lines 168-180 | AI classification actually gets saved |
| 1d | **Re-enrich items with <5 tags**: Queue items with `array_length(tags,1) < 5` for re-enrichment | Migration or one-time script | Immediately improves tag coverage |

### Phase 2: Card Quality (3-5 days)

| # | Fix | File(s) | Impact |
|---|-----|---------|--------|
| 2a | **Add semantic tag inference**: If category/sub_category exist, auto-infer baseline tags at ingestion time | `normalize-raw-events` or new function | Items have useful tags even before LLM enrichment |
| 2b | **Lower minItemsPerGroup for niche groups**: Add `minItems` to GroupDefinition, set to 2 for groups like date_night, pet_friendly, volunteer | `groupTaxonomy.ts`, `groupingEngine.ts` | More group variety in card view |
| 2c | **Add freshness signal to scoring**: Small 2-3% weight boost for recently created items | `scoring.ts`, `recommenderConfig.ts` | Feed feels more dynamic |
| 2d | **Recalculate relevance_tier periodically**: Add trigger or scheduled function | New migration | Tiers reflect current quality, not one-time backfill |

### Phase 3: Coverage Expansion (1-2 weeks)

| # | Fix | File(s) | Impact |
|---|-----|---------|--------|
| 3a | **Expand web collector targets**: Add 20-30 local event sources for Cape Cod | `collector_targets` table inserts | 50-100 more local events/week |
| 3b | **Re-enable or replace Eventbrite**: Either fix the Eventbrite integration or add an equivalent community event source | `ingest-eventbrite` or new function | Major coverage gap filled |
| 3c | **Improve UGC event creation flow**: Make event submission more discoverable, add venue auto-complete | `app/event/create.tsx` or similar | Community-sourced events |

### Phase 4: Advanced (2-4 weeks)

| # | Fix | File(s) | Impact |
|---|-----|---------|--------|
| 4a | **Facebook Events API integration** | New edge function | Largest untapped event source |
| 4b | **Scoring analytics dashboard**: Track tag coverage, group diversity, enrichment health | Admin page + new RPCs | Ongoing quality monitoring |
| 4c | **Inline dedup at ingestion**: Check for existing `dedupe_key` before inserting | `normalize-raw-events` | Eliminates 24h duplicate window |
| 4d | **Per-group min items in taxonomy**: Allow each GroupDefinition to specify its own minimum | `groupTaxonomy.ts`, `groupingEngine.ts` | Fine-grained group thresholds |

### Priority Matrix

```
                    High Impact
                        │
     ┌──────────────────┼──────────────────┐
     │                  │                  │
     │  1b (RPC gates)  │  1a (gate unen.) │
     │  1c (audience)   │  1d (re-enrich)  │
     │                  │  2a (tag infer)  │
     │                  │                  │
Low ─┼──────────────────┼──────────────────┼─ High
Effort│                  │                  │  Effort
     │                  │                  │
     │  2c (freshness)  │  3a (web expand) │
     │  2d (tier recalc)│  4a (Facebook)   │
     │                  │  3b (Eventbrite) │
     │                  │                  │
     └──────────────────┼──────────────────┘
                        │
                    Low Impact
```

**Start with the top-left quadrant**: Fix the RPC gates (1b), pass enrichment fields (1c), and add the unenriched item gate (1a). These are small, high-confidence changes that immediately improve quality. Then move to re-enrichment (1d) and tag inference (2a) for the biggest card-view improvement.

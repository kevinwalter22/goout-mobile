# Explore Pipeline Audit Report

## Part A: Current System Analysis

---

### 1. Data Sources & Ingestion Steps

| Source | Edge Function | Writes To | Kind | Items |
|--------|--------------|-----------|------|-------|
| Google Places | `ingest-google-places` | `event_ingest_raw` | activity | Bulk (24 types x 45 keywords x 2 regions) |
| Ticketmaster | `ingest-ticketmaster` | `event_ingest_raw` | event | ~50/page x 5 pages |
| PredictHQ | `ingest-predicthq` | `event_ingest_raw` | event | 10/page x 20 pages |
| Web Collector | `ingest-web-collector` | `event_ingest_raw` | event/activity | Variable |
| Eventbrite | `ingest-eventbrite` | (disabled) | - | 0 |

**Pipeline stages:**
1. `fetch-coordinator` picks the stalest source partition (round-robin)
2. Source-specific ingest function fetches raw data into `event_ingest_raw` (SHA256 hash dedup)
3. `normalize-raw-events` claims a normalization job, runs source adapter, upserts into `explore_items`
4. `run-enrichment-queue` LLM-enriches items missing hook_line/tags/availability
5. `mark_duplicates()` and `demote_stale_items()` run daily via pg_cron

---

### 2. Activities vs Events

| | Events | Activities |
|---|--------|-----------|
| `kind` | `"event"` | `"activity"` |
| `starts_at` | Required (specific date/time) | NULL (evergreen) |
| Demotion | Yes - `priority = -1` after 1 day past | Never demoted |
| Source | Ticketmaster, PredictHQ, Web Collector | Google Places, some Web Collector |
| Time filtering | Date range queries work | Always passes date filters (`starts_at IS NULL`) |

**Key problem:** Activities are never demoted or aged out. A hotel ingested today remains in the feed forever unless manually soft-deleted.

---

### 3. Category & Tag Assignment

**At ingestion (source adapters):**
- Google Places: `TYPE_CATEGORY_MAP` maps `primaryType` -> category (24 types). `TYPE_TAGS_MAP` assigns initial tags.
- Ticketmaster: Maps `classifications[0].segment` -> category.
- PredictHQ: Maps PHQ `category` -> canonical category.

**At enrichment (LLM):**
- LLM gets item data + 80-tag taxonomy, generates 5-10 tags.
- Can suggest category correction.

**Problem:** Google Places items often get *many* tags from the LLM (avg 5-10), which causes them to match more group card predicates. A hotel with tags `["restaurant", "bar", "dining", "nightlife", "lodging"]` matches food, nightlife, AND dining cards.

---

### 4. How Ranking is Computed

**Database-side:** Items sorted by `starts_at ASC` (events first), then `priority DESC`. The `priority` field (0-80) is set at ingestion based on source type, ratings, and type bonuses.

**Client-side (8 signals, weighted):**

| Signal | Weight | What it measures |
|--------|--------|-----------------|
| Distance | **28%** | Proximity to user (strongest!) |
| Time Match | 18% | How soon event starts |
| Weather | 15% | Indoor/outdoor fit for current weather |
| Friends Going | 14% | Social signal |
| Open Now | 10% | Currently available |
| Tag Affinity | 6% | User's historical tag preferences |
| Type Affinity | 6% | User's event vs activity preference |
| Context Intent | 3% | Time-of-day/day-of-week intent |

**What's NOT measured:** Item quality, confidence score, user rating, review count, or relevance to a "go out" app. A nearby hotel (distance=1.0, 28%) with decent weather fit (0.7, 15%) scores higher than a great restaurant 5 miles away.

---

### 5. Where Duplicates are Introduced

**Dedup key formula:** `normalized_title | date_bucket | geo_bucket | venue`

| Gap | Why duplicates survive |
|-----|----------------------|
| Title variations | "The Cape Cod House" vs "Cape Cod House Restaurant" produce different keys |
| Cross-source timing | Dedup runs daily at 4:30 AM; items ingested during the day coexist until then |
| Activity vs event | Same venue ingested as activity (Google) and event (Ticketmaster) have different date buckets (`nodate` vs `2026-03-15`) |
| Geo precision | 2-decimal rounding (~1.1km) can put nearby venues in different buckets |
| No cross-source ID | Google place_id, Ticketmaster event_id, PredictHQ phq_id are never cross-referenced |

**Fuzzy dedup exists** (`mark_fuzzy_duplicates()` with pg_trgm similarity > 0.4 + geo proximity < 500m) but only catches the most obvious cases.

---

### 6. Why Irrelevant POIs Survive Filtering

| Layer | What it catches | What slips through |
|-------|----------------|-------------------|
| `SKIP_TITLE_PATTERNS` (ingest) | Funeral homes, banks, dentists by name | Hotels named "Mountain View Lodge", generic motels |
| Migration 089 (sub_category) | church, clothing store, florist, pet store | Hotels/motels (lodging was removed from filter) |
| `normalized_confidence >= 40` | Very low quality items | Hotels with good Google ratings easily score 60+ |
| `review_status` quarantine | Web-collected low-confidence items | API-sourced items auto-approve |
| `is_duplicate` | Exact cross-source matches | Near-duplicates with slightly different names |

**The fundamental gap:** There is no "relevance for a discovery app" signal. A Holiday Inn with a 4.2 rating, full address, and coordinates gets confidence ~70 and passes every quality gate.

---

### 7. Top Recurring Junk Item Categories

Based on pipeline analysis, these are the most likely junk patterns:

| # | Pattern | Why it ranks high | Why it recurs across cards |
|---|---------|-------------------|--------------------------|
| 1-3 | Hotels/motels/inns | Nearby (28% weight), good Google rating, confidence 60+ | Tags match food_drink + general groups |
| 4-5 | Chain fast food | Very common, always nearby, open now | Tags match dining + walkable + budget cards |
| 6-7 | Gas station convenience stores | Nearby, open 24/7 | Match "nearby" + "budget_friendly" cards |
| 8-9 | Laundromats/dry cleaners | Nearby with good ratings | Match generic cards if tagged broadly |
| 10-12 | Automotive shops that passed title filter | Near user, decent confidence | Match "walkable" or "nearby" cards |
| 13-15 | Generic motels ingested as "activity" | Never demoted, always available | Match multiple cards via broad tags |
| 16-18 | Hair salons/barbershops | Nearby, highly rated | Match "nearby" + "walkable" cards |
| 19-20 | Real estate offices (if in Places results) | May pass all filters | Match via proximity scoring alone |

**Root cause:** Google Places Nearby Search for types like `restaurant`, `cafe`, `bar` also returns adjacent businesses. The LLM enrichment then assigns them reasonable-looking tags, giving them enough matches to appear in cards.

---

## Part B: Concrete Fixes

---

### Fix 1: Add Quality Signal to Recommender (HIGH IMPACT)

**Problem:** The 8 scoring signals don't include item quality. A hotel with confidence 45 scores the same as a curated restaurant with confidence 95, all else being equal.

**Solution:** Add a 9th signal `qualityScore` that uses `normalized_confidence`.

**Files to change:**
- `src/lib/scoring.ts` — add `computeQualityScore()` function
- `src/config/recommenderConfig.ts` — add `QUALITY` weight, rebalance weights

**Weight rebalance proposal:**
```
DISTANCE:       0.28 -> 0.22  (-0.06)
WEATHER:        0.15 -> 0.12  (-0.03)
TIME_MATCH:     0.18 -> 0.16  (-0.02)
FRIENDS_GOING:  0.14 -> 0.14  (same)
OPEN_NOW:       0.10 -> 0.08  (-0.02)
TAG_AFFINITY:   0.06 -> 0.06  (same)
TYPE_AFFINITY:  0.06 -> 0.06  (same)
CONTEXT_INTENT: 0.03 -> 0.03  (same)
QUALITY:        0.00 -> 0.13  (+0.13)  <-- NEW
Total:          1.00    1.00
```

**`computeQualityScore()` logic:**
```
confidence >= 80: 1.0
confidence 60-79: 0.7
confidence 40-59: 0.4
confidence < 40 or null: 0.2
```

---

### Fix 2: Reduce `maxGroupsPerItem` from 2 to 1 (HIGH IMPACT)

**Problem:** Same item appears in up to 2 different card groups.

**Solution:** Change `maxGroupsPerItem: 2` to `maxGroupsPerItem: 1` in `src/lib/groupingEngine.ts`.

**One-line change.** An item will appear in its highest-scoring matching group only.

---

### Fix 3: Add Item Suppression Table (MEDIUM IMPACT)

**Problem:** No way for users to dismiss/hide items they don't want to see.

**Solution:** New table + client integration.

**Migration (`092_item_suppression.sql`):**
```sql
CREATE TABLE IF NOT EXISTS explore_item_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  explore_item_id UUID NOT NULL REFERENCES explore_items(id) ON DELETE CASCADE,
  reason TEXT DEFAULT 'not_interested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, explore_item_id)
);

ALTER TABLE explore_item_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own suppressions"
  ON explore_item_suppressions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own suppressions"
  ON explore_item_suppressions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own suppressions"
  ON explore_item_suppressions FOR DELETE
  USING (auth.uid() = user_id);
```

**Client integration:**
- Fetch suppressed IDs on explore page mount
- Filter them out of both `items` and `postableNowCandidates`
- Add "Not Interested" option to item long-press menu or card swipe

---

### Fix 4: Raise Confidence Floor for Cards Mode (MEDIUM IMPACT)

**Problem:** Items with confidence 40-59 are mediocre but still appear in grouped cards.

**Solution:** In `exploreQuery.ts`, when fetching for cards mode (pageSize=200), raise the confidence floor to 55.

**Alternative (server-side):** Add `p_min_confidence` parameter to the RPC call, default 40 for list mode, 55 for cards mode.

This removes the bottom ~20% of items from cards without affecting list or map modes.

---

### Fix 5: Tighten Google Places Ingestion (MEDIUM IMPACT)

**Problem:** Too many irrelevant place types get ingested.

**Solution:** In `ingest-google-places/index.ts`, add more types to skip:

```typescript
const SKIP_TYPES = [
  "lodging", "hotel", "motel",
  "gas_station", "car_wash", "car_repair",
  "laundry", "dry_cleaner",
  "hair_salon", "beauty_salon",
  "real_estate_agency",
  "hardware_store",
  "convenience_store",
  "car_dealer",
  "pharmacy",
  "post_office",
  "school", "preschool",
  "veterinary_care",
];
```

Apply in `processPlaces()`: if any of the item's types are in `SKIP_TYPES`, skip it.

Also add corresponding patterns to migration 089 to clean up existing items.

---

### Fix 6: Add `relevance_tier` Stored Field (LOW EFFORT, HIGH LONG-TERM VALUE)

**Problem:** No stored signal for "is this appropriate for a discovery app?"

**Solution:** Add a server-side `relevance_tier` column.

**Migration (`093_relevance_tier.sql`):**
```sql
ALTER TABLE explore_items
  ADD COLUMN IF NOT EXISTS relevance_tier SMALLINT DEFAULT 2;
-- 3 = premium (curated, high-quality venues)
-- 2 = standard (API-sourced, passes quality gates)
-- 1 = marginal (low quality, may be irrelevant)
-- 0 = suppressed (don't show in cards, only in list/map if explicitly searched)
```

Set tier during normalization based on:
- Source type (curated CSV = 3, Ticketmaster = 3, Google Places = 2, Web = 1)
- Google rating >= 4.5 with >= 50 reviews → upgrade to 3
- Sub-category in low-value list → downgrade to 1

Use in card grouping: only tier >= 2 items appear in card groups. Tier 1 goes to overflow. Tier 0 hidden from cards entirely.

---

## Implementation Priority

| # | Fix | Impact | Effort | Touches |
|---|-----|--------|--------|---------|
| 1 | Quality signal in scoring | HIGH | Low | 2 files (scoring.ts, recommenderConfig.ts) |
| 2 | maxGroupsPerItem = 1 | HIGH | Trivial | 1 line (groupingEngine.ts) |
| 3 | Raise confidence floor for cards | MEDIUM | Low | 1 file (exploreQuery.ts or explore.tsx) |
| 4 | Tighten Google Places types | MEDIUM | Low | 1 file + 1 migration |
| 5 | Item suppression table | MEDIUM | Medium | 1 migration + 2 files (hook + explore.tsx) |
| 6 | Relevance tier | HIGH (long-term) | Medium | 1 migration + normalization adapters |

**Recommended order:** 1 -> 2 -> 4 -> 3 -> 5 -> 6

Fixes 1 and 2 alone will dramatically improve the card feed by pushing low-quality items down in score and eliminating repeated exposure.

# Euda Intelligence Engine — System Audit & Execution Plan

> **Generated**: 2026-01-29 | **Scope**: Non-destructive repo sweep
> **Reference spec**: `Intelligence_Engine.txt` (1,700 lines)
> **Constraint**: Fix-forward only. No modifying applied migrations. Minimal edits to `exploreQuery.ts`.

---

## A) AS-BUILT ARCHITECTURE MAP

### A.1 Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  SOURCES                                                             │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Ticketmaster API │  │ Curated SQL  │  │ (Planned: Eventbrite,  │  │
│  │ (every 6h cron)  │  │ (migration)  │  │  PredictHQ, Yelp)      │  │
│  └────────┬─────────┘  └──────┬───────┘  └────────────────────────┘  │
└───────────┼────────────────────┼─────────────────────────────────────┘
            │                    │
            v                    │
   ┌─────────────────┐          │
   │ event_ingest_raw │          │
   │ (raw_json, hash) │          │
   └────────┬─────────┘          │
            │ (DB trigger:       │
            │  auto_create_      │
            │  normalization_job)│
            v                    │
   ┌──────────────────────┐      │
   │ event_normalization_  │      │
   │ jobs (queue)          │      │
   └────────┬──────────────┘      │
            │ normalize-raw-events│
            │ (every 15m cron)    │
            v                    │
   ┌─────────────────────────────────────────┐
   │              explore_items               │ <── curated seed data
   │  (canonical table: ~100+ items)          │     inserted directly
   │                                          │
   │  KEY FILTER COLUMNS:                     │
   │  • category (TEXT — canonical enum)      │
   │  • price_bucket (ENUM: free/$/$$/$$$/?)  │
   │  • tags (TEXT[] — LLM-assigned)          │
   │  • availability_json (JSONB)             │
   │  • starts_at / ends_at (TIMESTAMPTZ)     │
   │  • lat, lng (FLOAT8)                     │
   │  • kind (ENUM: event | activity)         │
   │  • priority (INT — sort rank)            │
   │  • is_anchor, is_hidden_gem (BOOL)       │
   └────────┬────────────────────────────────┘
            │ (auto-queued if missing hook_line)
            v
   ┌─────────────────┐     ┌──────────────────────┐
   │ enrichment_queue │────>│ run-enrichment-queue  │
   │ (priority queue) │     │ (every 30m cron)      │
   └─────────────────┘     │                        │
                           │ Claude Haiku / OpenAI  │
                           │ → hook_line, tags[],   │
                           │   availability_json,   │
                           │   price_bucket          │
                           └──────────┬─────────────┘
                                      │
                                      v
                           ┌──────────────────────┐
                           │ apply_enrichment()    │
                           │ → updates explore_items│
                           └──────────────────────┘

CLIENT QUERY PATH:
┌─────────────────────────────────────────────────────────────────┐
│  useExploreFilters (hook)                                       │
│    → exploreQuery.ts                                            │
│      PATH A: filter_explore_items() RPC (when date range set)  │
│      PATH B: direct .from("explore_items") (no date range)     │
│    → client-side distance filter (Haversine)                   │
│    → client-side distance sort                                  │
│                                                                 │
│  postableNow.ts                                                 │
│    → availability_json check (days, times, seasons)             │
│    → distance check (≤0.62 mi)                                  │
│    → priority sorting                                            │
└─────────────────────────────────────────────────────────────────┘
```

### A.2 Tables Powering Filters

| Table | Column | Type | Used By Filter | Notes |
|-------|--------|------|----------------|-------|
| `explore_items` | `category` | TEXT | Category chips, RPC | 7 canonical values; mapped from filter IDs in `exploreQuery.ts` |
| `explore_items` | `price_bucket` | ENUM | "Free" chip, Price dropdown | LLM-inferred; many items still `unknown` |
| `explore_items` | `tags` | TEXT[] | "Outdoors"/"Live Music" chips | LLM-assigned; **two divergent taxonomies** (see §E) |
| `explore_items` | `starts_at` | TIMESTAMPTZ | Time window chips | NULL for activities; fallback path uses `.or()` |
| `explore_items` | `ends_at` | TIMESTAMPTZ | Postable Now | Often NULL; default 3h assumed by postableNow.ts |
| `explore_items` | `availability_json` | JSONB | RPC path, Postable Now | Contains type/days/times/seasons/next_occurrence |
| `explore_items` | `lat`, `lng` | FLOAT8 | Distance filter/sort | Client-side Haversine; no server-side distance |
| `explore_items` | `priority` | INT | "Featured" sort | Set by seed data + Ticketmaster adapter |
| `explore_items` | `kind` | ENUM | Postable Now logic | Not directly exposed as a filter chip |
| `explore_items` | `is_anchor` | BOOL | `getFeaturedEvents()` | Not exposed in filter UI |

### A.3 Edge Functions Inventory

| Function | Trigger | Schedule | Env Vars |
|----------|---------|----------|----------|
| `ingest-ticketmaster` | pg_cron | `0 */6 * * *` (6h) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TICKETMASTER_API_KEY` |
| `normalize-raw-events` | pg_cron | `*/15 * * * *` (15m) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `enrich-explore-item` | Manual/API | On-demand | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) |
| `run-enrichment-queue` | pg_cron | `*/30 * * * *` (30m) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) |
| `cleanup-orphaned-media` | pg_cron | `0 * * * *` (1h) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

### A.4 Database Triggers

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `on_auth_user_created` | `auth.users` | AFTER INSERT | `handle_new_user()` — auto-create profile |
| `auto_create_normalization_job` | `event_ingest_raw` | AFTER INSERT | `create_normalization_job()` — queue raw for normalization |
| `update_*_updated_at` | All tables | BEFORE UPDATE | `update_updated_at_column()` — timestamp |
| `on_post_created` | `posts` | AFTER INSERT | `award_xp_on_post()` — +10 XP |
| `on_post_created_streak` | `posts` | AFTER INSERT | `update_streak_on_post()` — maintain streak |

---

## B) CRITICAL BUG / ROBUSTNESS FINDINGS

### B-1 ⛔ CRITICAL: Duplicate migration number 023

**Files**: `023_add_posts_explore_item_id.sql` and `023_upgrade_enrichment_pipeline.sql`

Supabase CLI applies migrations in filename sort order. Two files with the same prefix will have **undefined execution order**. If `upgrade_enrichment_pipeline` runs first, it calls `DROP FUNCTION claim_enrichment_job()` which succeeds. If `add_posts_explore_item_id` runs first, it just adds a column. The real risk is **both have been applied manually in the dashboard** with no deterministic ordering guarantee for future environments.

**Impact**: Deploy blocker for any new environment setup.
**Fix**: Renumber `023_upgrade_enrichment_pipeline.sql` → `027_upgrade_enrichment_pipeline.sql` (next available number after 026).

---

### B-2 ⛔ CRITICAL: Divergent tag taxonomies (server vs client)

Two independent tag lists exist with **no shared source of truth**:

| Location | File | Tag Count | Unique Tags |
|----------|------|-----------|-------------|
| Server (LLM) | `_shared/enrichment-schema.ts` → `VALID_TAGS` | 79 | `theater`, `museum`, `nature`, `parks`, `scenic`, `trail`, `brewery`, `ice_skating`, `shopping`, `volunteer` |
| Client (normalize) | `src/lib/normalizeExploreItem.ts` → `CANONICAL_TAGS` | 55 | `festival`, `market`, `fair` |

**Impact**: LLM assigns tags that the client normalizer silently drops. Quick filter chips like "Outdoors" reference tags (`nature`, `parks`) that exist in the server list but NOT in the client canonical list. If client-side normalization ever runs, it will strip these tags.

**Fix**: See §E — Enrichment Normalization Contract.

---

### B-3 🔴 HIGH: Quick filter "Outdoors" and "Live Music" use category mapping, NOT tag search

**File**: [exploreQuery.ts:416-440](src/lib/exploreQuery.ts#L416-L440)

The "Outdoors" chip sends `tags: ["outdoors", "hiking", "nature", "parks"]`. But `mapTagsToCategories()` converts these to **category values** `["Outdoor"]`, not an actual tag-array search. Result:

- Items tagged `outdoors` but categorized as `Arts & Culture` → **excluded**
- Items categorized as `Outdoor` but tagged `hiking` only → **included** (correct but for wrong reason)
- The actual `tags` column is never queried by filters

**Impact**: Filter results are category-based, not tag-based. Tag enrichment provides no filtering value yet.

---

### B-4 🔴 HIGH: `is_available_at_time()` referenced but possibly undefined

**File**: [migration 022](supabase/migrations/022_add_availability_filter_function.sql) line 102

`filter_explore_items()` calls `is_available_at_time(e.availability_json, p_time_of_day)`. This function is defined in migration 021 (`add_availability_json.sql`). However, the query currently passes `p_time_of_day: null` always (line 273 of `exploreQuery.ts`), so this code path is dormant. If ever activated with a non-null value, it must be verified that migration 021 was applied.

**Impact**: Latent. Would cause runtime error if time-of-day filtering is enabled without verifying function exists.

---

### B-5 🔴 HIGH: "distance" sort in fallback query path is a no-op

**File**: [exploreQuery.ts:358-363](src/lib/exploreQuery.ts#L358-L363)

```typescript
case "distance":
  query = query
    .order("priority", { ascending: false })
    .order("starts_at", { ascending: true, nullsFirst: false });
  break;
```

The fallback query for "distance" sort orders by `priority` then `starts_at` — identical to "priority" sort. Actual distance sorting only happens client-side in `applyDistanceFilter()`. With pagination (20 items per page), this means:

- Page 1 gets the 20 highest-priority items, then sorts them by distance client-side
- Page 2 gets the next 20 by priority — which may include items **closer** than page 1

**Impact**: Distance-sorted pagination shows items in wrong order across pages.

---

### B-6 🟡 MEDIUM: `normalizeExploreItem.ts` is dead code

**File**: [src/lib/normalizeExploreItem.ts](src/lib/normalizeExploreItem.ts)

560 lines of normalization logic (category/price/tag/town synonym maps, confidence scoring, repair utilities). None of it is imported by any other file. The `normalizeCategory()`, `normalizePrice()`, `normalizeTags()` functions are never called. The `needsNormalizationRepair()` and `getRepairSuggestions()` helpers are unused.

**Impact**: No normalization runs on curated seed data or ingested items beyond what the LLM and Ticketmaster adapter provide. Inconsistent category/price/tag values in seed data persist unvalidated.

---

### B-7 🟡 MEDIUM: `normalized_confidence` column written nowhere

**File**: [migration 017](supabase/migrations/017_event_ingestion_architecture.sql) line 181

The `explore_items` table has `normalized_confidence INTEGER CHECK (0-100)` but no code writes to it. The Ticketmaster adapter doesn't set it. Seed data doesn't set it. `apply_enrichment()` doesn't set it. The client-side confidence formula in `normalizeExploreItem.ts` computes a value but never writes it anywhere.

**Impact**: No quality gate. All items served regardless of data completeness.

---

### B-8 🟡 MEDIUM: Stale data has no expiry mechanism

No mechanism detects or flags items where:
- `starts_at` is in the past (event already happened)
- `llm_enriched_at` is older than N days (enrichment may be stale)
- `availability_json.next_occurrence` is in the past

Past events remain visible in the main list alongside current activities.

---

### B-9 🟢 LOW: Price bucket count mismatch

The "Free" filter chip queries `price_bucket = 'free'`. But curated seed data (migration 017) sets `price_bucket` based on hand-written values. The LLM enrichment pipeline infers `price_bucket` but many items pre-enrichment still have `unknown`. The "Free" chip underreports available free items (trails, parks, etc.).

---

### B-10 🟢 LOW: Distance filter pagination count is inaccurate

**File**: [exploreQuery.ts:306-311](src/lib/exploreQuery.ts#L306-L311)

When distance filtering is active, the returned `count` is `filteredData.length` (just the current page's filtered count), not the true total. The UI shows "N items" which changes as you paginate.

---

## C) SPEC RECONCILIATION (Incremental)

### C.1 Layer-by-Layer Assessment

| Spec Layer | Status | What Exists | Near-Term Gap (fix-forward) |
|------------|--------|-------------|----------------------------|
| **L1: Discovery** | 🟡 20% | Ticketmaster adapter, source registry, curated CSV | No scheduled fetch rotation; Eventbrite/PredictHQ adapters stubbed but unimplemented |
| **L2: Extraction** | 🟡 25% | Ticketmaster field mapping, raw data store with SHA256 dedup | No schema validation on raw_json; no extraction confidence scoring |
| **L3: Validation** | 🔴 5% | `normalizeExploreItem.ts` exists but is dead code | Wire normalization into ingestion; add confidence threshold gate |
| **L4: Enrichment** | 🟡 40% | LLM pipeline (prompt, validation, queue, price_bucket) | Divergent tag taxonomy; no re-enrichment trigger; no confidence propagation |
| **L5: Resolution** | ⚫ 0% | Nothing | Title+location dedup detection (new migration) |
| **L6: Planning** | ⚫ 0% | Nothing | Out of scope for Wave 1-2 |
| **L7: Orchestration** | 🟡 30% | pg_cron for 4 jobs, enrichment queue with SKIP LOCKED | No health monitoring; no error alerting; no fetch rotation |

### C.2 Spec Principles vs Implementation

| Spec Principle | Spec Description | Current State | Recommended Action |
|---------------|------------------|---------------|-------------------|
| **Confidence Thresholds** | Items below threshold excluded from serving | `normalized_confidence` column exists but always NULL | Wire normalization to write confidence; add `WHERE normalized_confidence > 50` to RPC |
| **Validation Pipeline** | Category/price/tag normalization before serving | `normalizeExploreItem.ts` has synonym maps, never called | Call during ingestion (normalize-raw-events) and enrich (apply_enrichment trigger) |
| **Stale Detection** | Expire past events, refresh aging data | Nothing | Add pg_cron job: `UPDATE explore_items SET priority = -1 WHERE starts_at < NOW() - INTERVAL '1 day'` |
| **Deduplication** | Cross-source entity resolution | `UNIQUE(source_id, external_id)` prevents same-source dupes only | Add fuzzy title + location match detection (Wave 2) |
| **Source Health** | Monitor source freshness and error rates | `get_ingestion_stats()` exists but never called | Add health check endpoint (Wave 2) |

### C.3 What NOT to Build Yet

The spec describes layers 5-6 (Resolution, Planning) that require:
- Cross-source entity resolution with ML-based matching
- User preference learning and personalized ranking

These are out of scope. The current stack (pg_cron + Edge Functions + direct Supabase queries) is sufficient for layers 1-4 and 7 at the ~100-1000 item scale.

---

## D) EXECUTION PLAN — WAVE 1 + WAVE 2

### WAVE 1: Foundation + Correctness (8 tasks)

#### W1-1: Fix duplicate migration numbering

| | |
|---|---|
| **What** | Rename `023_upgrade_enrichment_pipeline.sql` → `027_upgrade_enrichment_pipeline.sql` |
| **Files** | `supabase/migrations/023_upgrade_enrichment_pipeline.sql` (rename) |
| **Migration** | No new migration (file rename only) |
| **Acceptance** | `ls supabase/migrations/023*` returns exactly 1 file. Migration sequence 001-027 has no gaps or dupes. |
| **Rollback** | Rename back. No DB impact. |
| **Risk** | None — file rename only. Already-applied migrations unaffected. |

---

#### W1-2: Create unified tag taxonomy (single source of truth)

| | |
|---|---|
| **What** | Create `src/config/tagTaxonomy.ts` exporting `CANONICAL_TAGS` as the single master list. Update both `enrichment-schema.ts` and `normalizeExploreItem.ts` to import from it. |
| **Files** | NEW: `src/config/tagTaxonomy.ts`; MODIFY: `supabase/functions/_shared/enrichment-schema.ts`, `src/lib/normalizeExploreItem.ts` |
| **Migration** | No |
| **Acceptance** | `VALID_TAGS` in enrichment-schema.ts === `CANONICAL_TAGS` in normalizeExploreItem.ts === export from tagTaxonomy.ts. No tag list divergence. |
| **Rollback** | Revert 3 files. No DB impact. |
| **Note** | The Edge Function (Deno) import path will differ from the client import path. Use a shared TypeScript file that both can reference, or duplicate with a lint rule. See §E for the exact tag list. |

---

#### W1-3: Wire tag-based filtering into `filter_explore_items` RPC

| | |
|---|---|
| **What** | Add `p_tags TEXT[] DEFAULT NULL` parameter to `filter_explore_items()` and `count_filtered_explore_items()`. Add `AND (p_tags IS NULL OR e.tags && p_tags)` clause (overlap operator). Update `exploreQuery.ts` to pass tags directly instead of mapping to categories. |
| **Files** | NEW: `supabase/migrations/028_add_tag_filter_to_rpc.sql`; MODIFY: `src/lib/exploreQuery.ts` (lines 266-277) |
| **Migration** | Yes — new migration with `CREATE OR REPLACE FUNCTION` |
| **Acceptance** | "Outdoors" chip returns items tagged `outdoors` OR `hiking` OR `nature` OR `parks` regardless of category. "Live Music" returns items tagged `live_music` or `concert`. |
| **Rollback** | Drop and recreate functions without `p_tags` parameter. |
| **Risk** | Medium — touches `exploreQuery.ts` (high-risk file). Change is additive: new parameter with NULL default means existing calls still work. |

---

#### W1-4: Fix distance sort pagination

| | |
|---|---|
| **What** | When `sort === "distance"` and `userLocation` is available, fetch a larger batch from DB (e.g., 100 items), sort client-side by distance, then paginate the sorted result. Alternative: add PostGIS `ORDER BY ST_Distance(...)` to RPC (requires PostGIS extension). |
| **Files** | MODIFY: `src/lib/exploreQuery.ts` (lines 349-363, 449-486) |
| **Migration** | No (client-only fix). If PostGIS approach: new migration. |
| **Acceptance** | Items on page 2 of distance-sorted results are all farther than items on page 1. |
| **Rollback** | Revert exploreQuery.ts changes. |
| **Risk** | Medium — touches high-risk file. Over-fetching approach is safer than PostGIS dependency. |

---

#### W1-5: Add stale item demotion

| | |
|---|---|
| **What** | New migration: create `demote_stale_items()` function that sets `priority = -1` for items where `starts_at < NOW() - INTERVAL '1 day'` and `kind = 'event'`. Schedule via pg_cron daily. |
| **Files** | NEW: `supabase/migrations/029_add_stale_demotion.sql` |
| **Migration** | Yes |
| **Acceptance** | Past events no longer appear at top of default sort. Activities unaffected. `SELECT count(*) FROM explore_items WHERE starts_at < NOW() AND priority >= 0` returns 0 after job runs. |
| **Rollback** | `UPDATE explore_items SET priority = 0 WHERE priority = -1;` then drop function + cron job. |

---

#### W1-6: Wire normalization into apply_enrichment (confidence write-back)

| | |
|---|---|
| **What** | After `apply_enrichment()` runs, compute `normalized_confidence` based on data completeness (has category? has price? has tags? has availability?). Write it to `explore_items.normalized_confidence`. |
| **Files** | NEW: `supabase/migrations/030_add_confidence_writeback.sql` — update `apply_enrichment()` to also compute and write `normalized_confidence` |
| **Migration** | Yes |
| **Acceptance** | After enrichment queue runs, `SELECT count(*) FROM explore_items WHERE normalized_confidence IS NOT NULL` matches enriched item count. |
| **Rollback** | `UPDATE explore_items SET normalized_confidence = NULL;` then restore old `apply_enrichment()`. |

---

#### W1-7: Add `WHERE normalized_confidence > 40` to RPC (quality gate)

| | |
|---|---|
| **What** | Add optional confidence threshold parameter to `filter_explore_items()`. Default to 40 (show everything with minimal data). Items with `normalized_confidence IS NULL` pass through (backwards compatible). |
| **Files** | MODIFY: migration 030 (same as W1-6, or separate migration 031) |
| **Migration** | Yes |
| **Acceptance** | Items with no category, no price, no tags, no availability are excluded from filter results. All existing enriched items still appear. |
| **Rollback** | Remove clause from RPC. |
| **Dependency** | W1-6 must be applied first. |

---

#### W1-8: Add `is_available_at_time()` verification test

| | |
|---|---|
| **What** | Verify `is_available_at_time()` from migration 021 exists and works. If it doesn't exist in the DB (migration was partially applied), create it in a new migration. Add a SQL test query. |
| **Files** | NEW (if needed): `supabase/migrations/031_ensure_time_function.sql` |
| **Migration** | Conditional — only if function is missing |
| **Acceptance** | `SELECT is_available_at_time('{"available_times": "anytime"}'::jsonb, 'morning')` returns TRUE. |
| **Rollback** | Drop function. |

---

### WAVE 2: Scale + Quality (7 tasks)

#### W2-1: Add Eventbrite source adapter

| | |
|---|---|
| **What** | Create `_shared/source-adapters/eventbrite.ts` following Ticketmaster adapter pattern. Add `api_eventbrite` to adapter registry. Create `ingest-eventbrite` Edge Function. |
| **Files** | NEW: `supabase/functions/_shared/source-adapters/eventbrite.ts`, `supabase/functions/ingest-eventbrite/index.ts`; MODIFY: `supabase/functions/_shared/source-adapters/index.ts` |
| **Migration** | Yes — INSERT into `event_sources` for Eventbrite |
| **Acceptance** | Calling `ingest-eventbrite` with valid API key inserts rows into `event_ingest_raw` with `source_id` matching Eventbrite source. |
| **Rollback** | Delete source row. Remove Edge Function files. |

---

#### W2-2: Cross-source dedup detection

| | |
|---|---|
| **What** | New migration: add function `detect_potential_duplicates()` that finds explore_items with similar titles (trigram similarity > 0.6) AND nearby locations (< 500m). Log to new `dedup_candidates` table for manual review. |
| **Files** | NEW: `supabase/migrations/032_add_dedup_detection.sql` |
| **Migration** | Yes — requires `pg_trgm` extension |
| **Acceptance** | If "Potsdam Farmers Market" exists from curated data and "Potsdam Farmer's Market" arrives from Eventbrite, they appear in `dedup_candidates`. |
| **Rollback** | Drop table and function. |

---

#### W2-3: Re-enrichment scheduler (refresh stale data)

| | |
|---|---|
| **What** | Modify `run-enrichment-queue` to also queue items where `llm_enriched_at < NOW() - INTERVAL '30 days'`. Add `priority = 5` (lower than fresh items). |
| **Files** | MODIFY: `supabase/functions/run-enrichment-queue/index.ts`; NEW migration to add re-queue function |
| **Migration** | Yes |
| **Acceptance** | Items enriched > 30 days ago appear in `enrichment_queue` with lower priority. Fresh items enriched first. |
| **Rollback** | Revert queue function. Existing enriched data unchanged. |

---

#### W2-4: Health monitoring endpoint

| | |
|---|---|
| **What** | New Edge Function `system-health` that calls `get_ingestion_stats()` and adds: queue depths, oldest un-enriched item age, source freshness, error rates. Return JSON summary. |
| **Files** | NEW: `supabase/functions/system-health/index.ts` |
| **Migration** | No |
| **Acceptance** | `curl $SUPABASE_URL/functions/v1/system-health` returns JSON with `sources`, `queues`, `enrichment`, `stale_items` sections. |
| **Rollback** | Delete Edge Function. |

---

#### W2-5: Seasonal filtering support in UI

| | |
|---|---|
| **What** | Add "Season" filter chip (Winter/Spring/Summer/Fall). Wire to `availability_json->'available_seasons'` check in RPC. |
| **Files** | MODIFY: `src/config/exploreFilters.ts` (add season type/options), `src/lib/exploreQuery.ts` (pass to RPC); NEW migration to add `p_season` param to `filter_explore_items()` |
| **Migration** | Yes |
| **Acceptance** | Selecting "Winter" shows only items with `availability_json.available_seasons` containing `winter` or `year_round`. |
| **Rollback** | Revert client files. Drop and recreate RPC without season param. |

---

#### W2-6: Wire normalizeExploreItem into ingestion

| | |
|---|---|
| **What** | Call `normalizeExploreItem()` in `normalize-raw-events` Edge Function before inserting into `explore_items`. Write `normalized_confidence` on insert. |
| **Files** | MODIFY: `supabase/functions/normalize-raw-events/index.ts`; need to make `normalizeExploreItem.ts` importable from Deno (extract pure logic to shared file) |
| **Migration** | No |
| **Acceptance** | Newly ingested Ticketmaster items have `normalized_confidence` > 0 and canonical category values on insert. |
| **Rollback** | Revert normalize-raw-events. Items still work without normalization. |
| **Note** | Requires extracting normalization maps to a file importable by both Deno (Edge Functions) and React Native (client). |

---

#### W2-7: Fetch rotation scheduling

| | |
|---|---|
| **What** | Create `run-fetch-rotation` Edge Function that checks `get_sources_due_for_fetch()` and calls the appropriate ingest function for each due source. Replace individual source cron jobs with a single rotation job. |
| **Files** | NEW: `supabase/functions/run-fetch-rotation/index.ts`; NEW migration to add cron job |
| **Migration** | Yes — replace individual cron entries with single rotation entry |
| **Acceptance** | A single cron job triggers fetch for all sources whose `fetch_interval_minutes` has elapsed since `last_fetch_at`. |
| **Rollback** | Restore individual cron jobs. Delete rotation function. |

---

## E) ENRICHMENT NORMALIZATION CONTRACT

### E.1 Problem Statement

Two tag taxonomies exist:

1. **Server-side** (`_shared/enrichment-schema.ts` → `VALID_TAGS`): 79 tags. Used by LLM enrichment to assign tags. Tags get written to `explore_items.tags`.

2. **Client-side** (`src/lib/normalizeExploreItem.ts` → `CANONICAL_TAGS`): 55 tags with synonym maps. Currently dead code — never called.

3. **Filter config** (`src/config/exploreFilters.ts`): Quick filter chips reference tags (`outdoors`, `hiking`, `nature`, `parks`, `live_music`, `concert`) that must exist in the canonical list.

4. **Query layer** (`src/lib/exploreQuery.ts` → `mapTagsToCategories()`): Maps filter tags to **categories**, not actual tag-array search. Tags in the DB are never queried.

### E.2 Canonical Tag List (Unified)

The following is the **single source of truth** for all tags. It merges both existing lists, removes duplicates, and adds tags referenced by filter chips.

```typescript
// src/config/tagTaxonomy.ts

export const CANONICAL_TAGS = [
  // ── Activity Types ──
  "outdoors", "indoors", "water_activity", "winter_activity",
  "hiking", "camping", "swimming", "skiing", "snowboarding",

  // ── Audience ──
  "family_friendly", "kids", "adults_only", "date_night",
  "solo_friendly", "group_activity",

  // ── Vibe ──
  "nightlife", "relaxing", "adventure", "cultural",
  "educational", "social", "fitness", "wellness",

  // ── Food & Drink ──
  "food", "drinks", "coffee", "dining", "bar",
  "brewery",                     // was server-only

  // ── Entertainment / Events ──
  "live_music", "concert",       // referenced by filter chips
  "festival", "market", "fair",  // was client-only
  "theater", "museum",           // was server-only

  // ── Nature & Outdoors ──
  "nature", "parks",             // referenced by "Outdoors" chip
  "scenic", "trail",             // was server-only

  // ── Venues ──
  "ice_skating",                 // was server-only

  // ── Other ──
  "free", "budget_friendly", "local_favorite", "seasonal",
  "pet_friendly", "accessible",
  "shopping", "volunteer",       // was server-only
] as const;

export type CanonicalTag = (typeof CANONICAL_TAGS)[number];
```

**Total: 51 tags** (deduplicated union of both lists).

### E.3 Canonical Category Mapping

Categories are TEXT in the DB (not an enum). The 7 canonical values:

```
"Outdoor" | "Nightlife" | "Winter Activities" | "Arts & Culture" |
"Sports & Recreation" | "Food & Drink" | "Anchor"
```

**Synonym map** (from `normalizeExploreItem.ts`, already complete):

| Input | → Canonical |
|-------|-------------|
| outdoor, outdoors, nature, hiking, parks, trails, camping, beach | Outdoor |
| nightlife, bars, clubs, late night | Nightlife |
| winter, skiing, snowboarding, ice skating, snow sports | Winter Activities |
| arts, culture, museum, gallery, theatre, theater, music, concert, live music, performance, art | Arts & Culture |
| sports, recreation, fitness, gym, athletic, games | Sports & Recreation |
| food, drink, restaurant, dining, cafe, coffee, brewery, winery, farmers market | Food & Drink |
| community, local, landmark, attraction | Anchor |

### E.4 Availability JSON Normalization Rules

The `availability_json` JSONB column must conform to this schema:

```typescript
interface Availability {
  type: "event" | "activity";           // REQUIRED

  // Activity fields (ignored for events)
  available_days?: DayOfWeek[];         // ["mon","tue",...] or ["daily"]
  available_times?: AvailableTimes      // {start:"09:00", end:"17:00"} | "anytime" | "daylight"
                  | "anytime"
                  | "daylight";
  available_seasons?: Season[];         // ["spring","summer",...] or ["year_round"]

  // Event fields (ignored for activities)
  next_occurrence?: string | null;      // ISO 8601 datetime
  recurrence?: RecurrenceType;          // "none" | "daily" | "weekly" | "monthly" | "annual"

  // Common
  typical_duration?: string;            // "2-3 hours", "full day", "multi-day"
  best_time_of_day?: TimeOfDay;         // "morning" | "afternoon" | "evening" | "anytime"

  // Quality
  confidence: number;                   // 0-100 (REQUIRED)
  source: "ai_enrichment" | "manual" | "api";  // REQUIRED
}
```

**Normalization rules:**
1. If `type` is missing, infer from `starts_at`: if non-null → `"event"`, else → `"activity"`
2. If `available_days` is missing for activities, default to `["daily"]`
3. If `available_seasons` is missing, default to `["year_round"]`
4. If `confidence` is missing, default to `70`
5. If `source` is missing, default to `"ai_enrichment"` (if from LLM) or `"manual"` (if from seed)
6. `next_occurrence` must be in the future. If in the past, set to `null` and flag for re-enrichment.

### E.5 Confidence Scoring Formula

```
confidence = 100
  - (no canonical category ? 30 : 0)
  - (price_bucket = 'unknown' ? 20 : 0)
  - (tags is empty ? 20 : 0)
  - (no availability_json ? 15 : 0)
  - (no lat/lng ? 15 : 0)

// Thresholds:
//   >= 70: Serve in all contexts (filter results, Postable Now, search)
//   40-69: Serve in main list but exclude from filter chips
//   < 40:  Hide from all lists; queue for re-enrichment
```

**Where to compute**: In `apply_enrichment()` SQL function (after enrichment) and in `normalize-raw-events` Edge Function (after ingestion).

**Where to store**: `explore_items.normalized_confidence` (already exists, currently NULL).

**Where to enforce**: `filter_explore_items()` RPC — add `AND (e.normalized_confidence IS NULL OR e.normalized_confidence >= $threshold)`.

### E.6 Implementation Order

1. **W1-2**: Create `tagTaxonomy.ts` with unified list
2. **W1-3**: Wire tag array search into RPC
3. **W1-6**: Add confidence write-back to `apply_enrichment()`
4. **W1-7**: Add confidence gate to RPC
5. **W2-6**: Wire `normalizeExploreItem` into ingestion
6. Re-run enrichment queue to populate confidence scores

---

## Appendix: File Reference

| File | Role | Risk Level |
|------|------|------------|
| `src/lib/exploreQuery.ts` | Query builder (two paths) | 🔴 HIGH — any change affects all filter results |
| `src/config/exploreFilters.ts` | Filter chip config | 🟡 MEDIUM — config-only, no query logic |
| `src/lib/postableNow.ts` | Postable Now computation | 🟡 MEDIUM — independent of main query |
| `src/lib/normalizeExploreItem.ts` | Normalization (dead code) | 🟢 LOW — currently unused |
| `src/hooks/useExploreFilters.ts` | Filter state hook | 🟡 MEDIUM — orchestrates query calls |
| `src/utils/location.ts` | Haversine distance | 🟢 LOW — pure math, well-tested |
| `supabase/functions/_shared/enrichment-schema.ts` | LLM prompt + validation | 🟡 MEDIUM — affects all enrichment output |
| `supabase/functions/run-enrichment-queue/index.ts` | Batch enrichment worker | 🟡 MEDIUM — touches DB via RPC |
| `supabase/functions/normalize-raw-events/index.ts` | Raw → explore_items | 🟡 MEDIUM — ingestion pipeline |
| `supabase/functions/_shared/source-adapters/index.ts` | Adapter registry | 🟢 LOW — just a map |

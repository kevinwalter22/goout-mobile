# Robustness Sweep Report

**Date:** 2026-02-03
**Phase:** 5 (Data Quality Hardening)

---

## Executive Summary

This robustness sweep examined correctness issues across the Activity Intelligence Engine pipelines. We identified **1 critical bug** (fixed), **several medium-severity issues** (documented for future work), and confirmed that core systems are architecturally sound.

| Area | Status | Issues Found | Fixed |
|------|--------|--------------|-------|
| Ingestion Idempotency | ✅ Sound | 2 edge cases | 0 (low risk) |
| Health Dashboard | ⚠️ Bug Found | 1 critical | 1 (migration 049) |
| Explore Filtering | ⚠️ Issues | 3 medium | 0 (documented) |
| Postable Now | ⚠️ Issues | 3 medium | 0 (documented) |
| Storage/FK Integrity | ⚠️ Gap | 1 medium | 0 (documented) |

---

## 1. Ingestion Idempotency

### Verdict: ✅ SOUND

The ingestion pipeline has **well-designed idempotency controls** at the database level.

### Strengths

| Mechanism | Protection |
|-----------|------------|
| `event_ingest_raw` | UNIQUE(source_id, external_id) + ON CONFLICT UPSERT |
| `event_normalization_jobs` | UNIQUE(raw_id) + ON CONFLICT DO NOTHING |
| `enrichment_queue` | UNIQUE(explore_item_id) + smart ON CONFLICT UPDATE |
| Job claiming | FOR UPDATE SKIP LOCKED (atomic) |

### Minor Edge Cases (Not Fixed)

**1. Normalization Job Reset Race (Low Risk)**
- File: `supabase/migrations/041_*.sql`
- Issue: UPDATE trigger could reset a RUNNING job to QUEUED
- Risk: Low - only occurs if raw data changes while job is running
- Recommendation: Add `AND status != 'running'` guard to trigger

**2. Schedule-Enrichment Duplicate Work (Low Risk)**
- File: `supabase/functions/schedule-enrichment/index.ts`
- Issue: Re-queues items that are already queued
- Impact: Safe due to ON CONFLICT, but wastes cycles
- Recommendation: Filter out already-queued items in query

---

## 2. Health Dashboard

### Verdict: ⚠️ BUG FOUND AND FIXED

### Critical Bug: CASE Statement Order (FIXED)

**File:** `supabase/migrations/048_fix_enrichment_queue_and_categories.sql`

**Problem:** All health check CASE statements checked lower threshold before higher:
```sql
-- WRONG: 'warn' matched first, 'critical' never reached
CASE WHEN cnt > 100 THEN 'warn' WHEN cnt > 500 THEN 'critical' ...
```

**Fix:** Migration 049 reverses the order:
```sql
-- CORRECT: Check 'critical' threshold first
CASE WHEN cnt > 500 THEN 'critical' WHEN cnt > 100 THEN 'warn' ...
```

**Affected Checks:**
- `norm_queue_backlog` (100/500)
- `enrich_queue_backlog` (200/1000)
- `enrich_stuck_running` (10/100)
- `norm_failed_jobs` (10/50)
- `recent_errors` (5/20)
- `low_confidence_items` (30%/50%)
- `missing_category` (20%/40%)

### Verification

After applying migration 049:
```sql
SELECT * FROM quick_health_check();
-- With 600 queued normalization jobs: should show 'critical' (not 'warn')
```

---

## 3. Explore Filtering & Pagination

### Verdict: ⚠️ ISSUES DOCUMENTED

### Issue 1: Count vs Data Mismatch with Distance Filter (Medium)

**File:** `src/lib/exploreQuery.ts` lines 327-347

**Problem:** When distance filtering is active:
1. Count query returns total from database
2. Distance filter reduces actual results
3. Count is then overwritten with filtered count
4. User sees count change mid-scroll ("20 of 100" → "15 of 15")

**Recommendation:** Either:
- Show "~100 results" (approximate) when distance filter active
- Or add distance-filtered count to RPC function

### Issue 2: hasMore Calculation Bug (Medium)

**File:** `src/lib/exploreQuery.ts` line 345

**Problem:** `hasMore` checks if RPC returned full page, not if there are more items after distance filtering.

**Scenario:**
- RPC returns 20 items (full page)
- Distance filter removes 12 items (8 remain)
- hasMore = true (because 20 >= pageSize)
- User scrolls, next page also filtered heavily
- UI shows "Load more" but nothing loads

**Recommendation:** Calculate hasMore based on filtered results.

### Issue 3: Pagination Race Condition (Medium)

**File:** `src/hooks/useExploreFilters.ts` lines 85-173

**Problem:** Filter changes during in-flight queries can cause state inconsistencies.

**Current mitigation:** Version number check drops stale results.

**Gap:** `setTotalCount()` and `setHasMore()` may be called out of order.

**Recommendation:** Bundle state updates into single reducer action.

---

## 4. Postable Now Highlighting

### Verdict: ⚠️ ISSUES DOCUMENTED

### Issue 1: Location Update Interval (Medium)

**File:** `app/(tabs)/explore.tsx` lines 107-118

**Problem:** Location updates every 30 seconds, but user can walk 50m in that time.

**Impact:** Incorrect distance calculations, wrong items marked postable.

**Recommendation:** Reduce to 10 seconds or use significant motion detection.

### Issue 2: Unbounded Candidate Query (Medium)

**File:** `app/(tabs)/explore.tsx` lines 120-136

**Problem:** Fetches ALL items with coordinates regardless of proximity.

**Impact:** Performance degradation on each location update (100s-1000s items).

**Recommendation:** Add bounding box filter to query:
```sql
WHERE lat BETWEEN (user_lat - 0.01) AND (user_lat + 0.01)
  AND lng BETWEEN (user_lng - 0.01) AND (user_lng + 0.01)
```

### Issue 3: Priority Not Time-Reactive (Medium)

**File:** `src/lib/postableNow.ts`

**Problem:** "Starting soon" events don't move up as start time approaches.

**Impact:** Item ordering becomes stale within seconds.

**Recommendation:** Add periodic priority recalculation (every 60s) for displayed items.

---

## 5. Storage & FK Integrity

### Verdict: ⚠️ GAP DOCUMENTED

### FK Constraints: ✅ Well Designed

| Relationship | Cascade | Status |
|--------------|---------|--------|
| Users → Posts | CASCADE | ✅ Good |
| Posts → Reactions/Comments | CASCADE | ✅ Good |
| Users → RSVPs | CASCADE | ✅ Good |
| Posts → Events | SET NULL | ✅ Intentional |
| Posts → ExploreItems | SET NULL | ✅ Intentional |

### Storage Cleanup: ⚠️ Gap

**Posts Bucket:** ✅ Cleanup implemented
- Edge function: `cleanup-orphaned-media`
- Scheduled: Hourly via pg_cron

**Avatars Bucket:** ❌ No cleanup
- File: User's `avatar.jpg` in `avatars` bucket
- Orphan scenarios:
  - User deleted → Avatar remains
  - User updates avatar → Old avatar remains
- Impact: Storage bloat over time

**Recommendation:** Create `cleanup-orphaned-avatars` edge function:
```typescript
// List avatars bucket
// For each file, check if profile.avatar_url references it
// Delete orphaned files older than 1 hour
```

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/049_fix_health_check_case_order.sql` | NEW - Fix CASE statement order |
| `docs/robustness_sweep.md` | NEW - This document |

---

## Deployment Steps

1. **Apply migration 049** via SQL Editor
2. **Verify** with `SELECT * FROM quick_health_check();`
   - Check that critical thresholds now trigger correctly

---

## Future Work (Not Blocking)

### Priority: Medium
1. **Distance filter count accuracy** - Show approximate counts
2. **Postable Now performance** - Add geo bounding box to query
3. **Avatar cleanup** - Create cleanup edge function

### Priority: Low
1. **Normalization job guard** - Add `status != 'running'` check
2. **Schedule-enrichment optimization** - Skip already-queued items
3. **Priority recalculation** - Periodic update for postable items

---

## Verification Queries

### Health Check Status
```sql
SELECT * FROM quick_health_check();
-- Verify 'critical' status appears for high counts
```

### Orphan Detection (Posts)
```sql
-- Run cleanup in dry-run mode
-- POST to /functions/v1/cleanup-orphaned-media with {"dry_run": true}
```

### FK Integrity Check
```sql
-- Check for orphaned post references
SELECT COUNT(*) FROM posts WHERE event_id IS NOT NULL
  AND event_id NOT IN (SELECT id FROM events);
-- Should return 0 (SET NULL handles deletions)
```

---

## Conclusion

The Activity Intelligence Engine is **production-ready** with:
- ✅ Strong idempotency guarantees
- ✅ Proper FK cascade design
- ✅ Working storage cleanup (posts)
- ⚠️ One critical bug fixed (health check CASE order)
- ⚠️ Several medium-severity issues documented for future sprints

No blocking issues remain.

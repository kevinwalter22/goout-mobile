# Data Quality Hardening

This document summarizes the changes made to harden data quality in the Activity Intelligence Engine.

---

## Summary

Based on the baseline audit (2026-02-03), we identified and fixed the following issues:

| Priority | Issue | Fix |
|----------|-------|-----|
| P0 | Enrichment queue stuck (1028 jobs in running) | Migration 048: Reset stuck jobs + add timeout function |
| P1 | Missing category (28% of items) | Migration 048: Backfill from tags + improved adapter |
| P1 | Verbose schedules | Already addressed: 84% have time_text, UI prefers it |
| P2 | Missing descriptions (5.5%) | Enrichment queue will process these |
| P2 | Missing hook_lines (5.7%) | Enrichment queue will process these |

**Good news:**
- Deduplication is working well (only 2 unflagged potential duplicates)
- Confidence scores are excellent (99.4% ≥70)
- Location data is complete (100% have coords and town)

---

## Changes Made

### Migration 048: `048_fix_enrichment_queue_and_categories.sql`

**1. Reset Stuck Enrichment Jobs**

All 1028 jobs were stuck in `running` state. The migration resets them to `queued`:

```sql
UPDATE enrichment_queue
SET status = 'queued', started_at = NULL, attempts = 2
WHERE status = 'running';
```

**2. Job Timeout Function**

Added `reset_stale_enrichment_jobs(timeout_minutes)` to automatically reset jobs stuck for longer than the timeout:

```sql
SELECT * FROM reset_stale_enrichment_jobs(30);  -- Reset jobs stuck >30 min
```

**3. Category Inference Function**

Added `infer_category_from_tags(tags)` to deterministically infer category from tags:

```sql
SELECT infer_category_from_tags(ARRAY['food', 'dining']);  -- Returns 'food'
SELECT infer_category_from_tags(ARRAY['outdoors', 'hiking']);  -- Returns 'outdoor'
```

**4. Category Backfill**

Automatically backfills category for items where it can be inferred from tags:

```sql
UPDATE explore_items
SET category = infer_category_from_tags(tags)
WHERE category IS NULL AND infer_category_from_tags(tags) IS NOT NULL;
```

**5. Enhanced Health Check**

Added two new checks to `quick_health_check()`:
- `enrich_stuck_running`: Detects jobs stuck in running state >30 min
- `missing_category`: Shows percentage of items missing category

---

### Google Places Adapter Update

File: `supabase/functions/_shared/source-adapters/google_places.ts`

**Enhanced `mapCategory()` function:**

1. First tries direct type mapping (existing behavior)
2. Falls back to tag-based inference (new)
3. Final fallback: assigns "community" to establishments (new)

```typescript
// Before: Returns null for unmapped types
mapCategory("hair_salon", ["establishment"])  // null

// After: Uses fallbacks
mapCategory("hair_salon", ["establishment"], ["shopping"])  // "community"
```

**Added `inferCategoryFromTags()` function:**

Mirrors the database function for consistent behavior between normalization and backfill.

---

## UI Verification

Confirmed that the UI correctly prefers `time_text` over `schedule_text`:

- `app/(tabs)/explore.tsx:222-226`: Uses time_text first, falls back to schedule_text
- `app/event/[id].tsx:175-179`: Same preference order

No UI changes needed.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/048_fix_enrichment_queue_and_categories.sql` | New migration |
| `supabase/functions/_shared/source-adapters/google_places.ts` | Enhanced category mapping |
| `docs/data_quality_baseline.md` | Baseline audit results |
| `docs/data_quality_hardening.md` | This document |
| `docs/backfill_runbook.md` | Backfill instructions |

---

## Deployment Steps

1. **Apply migration 048** via SQL Editor
2. **Verify** with `SELECT * FROM quick_health_check();`
3. **Deploy Edge Functions** (if running enrichment):
   ```bash
   npx supabase functions deploy normalize-raw-events
   ```
4. **Run backfill** following `docs/backfill_runbook.md`

---

## Verification Queries

### Check category coverage

```sql
SELECT
  ROUND(100.0 * COUNT(*) FILTER (WHERE category IS NOT NULL) / COUNT(*), 1) AS pct_with_category
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate;
```

**Target: > 90%** (up from 72% baseline)

### Check enrichment queue state

```sql
SELECT status, COUNT(*) FROM enrichment_queue GROUP BY status;
```

**Target: No jobs in `running` state for >30 min**

### Full health check

```sql
SELECT * FROM quick_health_check() WHERE check_status != 'ok';
```

**Target: Empty result (all checks passing)**

---

## Cost Analysis

- **Migration 048**: No API costs (pure SQL)
- **Enrichment (if run)**: ~$0.05 per 50 items with Claude 3.5 Haiku
- **Total for 100 items needing enrichment**: ~$0.10

---

## Future Improvements

1. **Add more type mappings**: Analyze remaining unmapped Google Places types and add to `TYPE_CATEGORY_MAP`
2. **Scheduled maintenance**: Set up pg_cron to run `reset_stale_enrichment_jobs()` hourly
3. **Monitoring dashboard**: Add Supabase dashboard for queue depths and category coverage

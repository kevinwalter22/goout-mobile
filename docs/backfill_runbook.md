# Data Quality Backfill Runbook

This runbook documents the steps to clean up and backfill existing data after applying migration 048.

---

## Prerequisites

1. Migration 048 has been applied (`048_fix_enrichment_queue_and_categories.sql`)
2. Edge Functions deployed (if running enrichment)
3. `ANTHROPIC_API_KEY` set in Supabase secrets (for LLM enrichment)

---

## Step 1: Apply Migration 048

Run the migration in Supabase SQL Editor:

```sql
-- Apply migration 048_fix_enrichment_queue_and_categories.sql
-- This will:
-- 1. Reset stuck enrichment jobs
-- 2. Create job timeout function
-- 3. Create category inference function
-- 4. Backfill categories from tags
```

**Expected output:**
- "Resetting X stuck enrichment jobs from running to queued"
- "After backfill: X items still missing category (out of Y active)"

---

## Step 2: Verify Enrichment Queue Reset

```sql
-- Check queue state after migration
SELECT status, COUNT(*) AS cnt
FROM enrichment_queue
GROUP BY status
ORDER BY status;
```

**Expected:**
- Most jobs should now be `queued` (not `running`)
- Some may be `done` or `failed` from previous runs

---

## Step 3: Verify Category Backfill

```sql
-- Check category coverage after backfill
SELECT
  COUNT(*) AS total_active,
  COUNT(*) FILTER (WHERE category IS NULL) AS missing_category,
  ROUND(100.0 * COUNT(*) FILTER (WHERE category IS NULL) / COUNT(*), 1) AS pct_missing
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate;
```

**Expected:**
- `pct_missing` should be significantly lower than 28% (baseline)
- Target: < 10% missing category

If still high, check which items are missing:

```sql
-- See what's still missing category
SELECT
  title,
  tags,
  es.type AS source_type
FROM explore_items ei
JOIN event_sources es ON ei.source_id = es.id
WHERE ei.priority >= 0 AND NOT ei.is_duplicate AND ei.category IS NULL
LIMIT 20;
```

---

## Step 4: Run Health Check

```sql
SELECT * FROM quick_health_check();
```

**Expected:**
- `enrich_queue_backlog`: Should show count of queued jobs
- `enrich_stuck_running`: Should be `ok` (0)
- `missing_category`: Should be lower than before

---

## Step 5: Run Enrichment Queue (Optional)

If items need LLM enrichment (missing descriptions, hook_lines, etc.):

```bash
# Run enrichment with cost controls
curl -X POST $SUPABASE_URL/functions/v1/run-enrichment-queue \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"max_items": 50, "batch_size": 5}'
```

**Monitor progress:**

```sql
-- Check enrichment progress
SELECT
  status,
  COUNT(*) AS cnt,
  MIN(created_at) AS oldest,
  MAX(updated_at) AS latest_update
FROM enrichment_queue
GROUP BY status;
```

**Cost estimate:**
- ~50 items × ~600 input tokens × ~300 output tokens
- Claude 3.5 Haiku: ~$0.05 per batch of 50

---

## Step 6: Run Deduplication (If Needed)

Check if there are unflagged duplicates:

```sql
-- Check for potential duplicates
SELECT COUNT(*) FROM (
  SELECT 1
  FROM explore_items a
  JOIN explore_items b ON a.id < b.id
    AND a.lat IS NOT NULL AND b.lat IS NOT NULL
    AND ABS(a.lat - b.lat) < 0.005 AND ABS(a.lng - b.lng) < 0.005
  WHERE a.priority >= 0 AND b.priority >= 0
    AND NOT a.is_duplicate AND NOT b.is_duplicate
    AND similarity(LOWER(a.title), LOWER(b.title)) > 0.5
  LIMIT 100
) sub;
```

If count > 0, run dedup:

```sql
SELECT * FROM mark_duplicates();
```

---

## Step 7: Final Verification

Run the comprehensive baseline query again:

```sql
SELECT jsonb_build_object(
  'active_items', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate),
  'missing_category', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate AND category IS NULL),
  'missing_description', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate AND description IS NULL),
  'missing_hook_line', (SELECT COUNT(*) FROM explore_items WHERE priority >= 0 AND NOT is_duplicate AND (hook_line IS NULL OR LENGTH(hook_line) < 10)),
  'enrichment_queue', (SELECT jsonb_object_agg(status, cnt) FROM (SELECT status, COUNT(*) AS cnt FROM enrichment_queue GROUP BY status) sub)
) AS post_backfill_metrics;
```

**Target metrics:**
| Metric | Baseline | Target |
|--------|----------|--------|
| missing_category | 28% (278) | < 10% |
| missing_description | 5.5% (54) | < 3% |
| missing_hook_line | 5.7% (56) | < 3% |
| enrichment_queue running | 1028 | 0 |

---

## Troubleshooting

### Enrichment jobs failing

Check error messages:

```sql
SELECT last_error, COUNT(*)
FROM enrichment_queue
WHERE status = 'failed'
GROUP BY last_error
ORDER BY COUNT(*) DESC
LIMIT 10;
```

Common issues:
- `LLM not configured`: Set `ANTHROPIC_API_KEY` in Supabase secrets
- Rate limit errors: Reduce `batch_size` or add delays
- Parse errors: LLM returned invalid JSON

### Jobs stuck in running again

Run the timeout reset:

```sql
SELECT * FROM reset_stale_enrichment_jobs(30);  -- 30 minute timeout
```

### Category still missing for many items

Check which Google Places types aren't mapped:

```sql
-- Find unmapped place types
SELECT
  eir.raw_json->>'primaryType' AS primary_type,
  COUNT(*) AS cnt
FROM event_ingest_raw eir
JOIN event_sources es ON eir.source_id = es.id
JOIN explore_items ei ON ei.source_id = eir.source_id AND ei.external_id = eir.external_id
WHERE es.type = 'api_google_places'
  AND ei.category IS NULL
GROUP BY 1
ORDER BY cnt DESC
LIMIT 20;
```

Consider adding these types to `TYPE_CATEGORY_MAP` in `google_places.ts`.

---

## Schedule Regular Maintenance

Add to pg_cron (if available) or run manually weekly:

```sql
-- Reset stale jobs
SELECT * FROM reset_stale_enrichment_jobs(30);

-- Run dedup
SELECT * FROM mark_duplicates();

-- Clean old health logs
SELECT cleanup_old_health_logs(30);
```

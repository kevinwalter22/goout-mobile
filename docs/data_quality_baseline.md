# Data Quality Baseline Audit

Generated: 2026-02-03

This document captures the current state of data quality in `explore_items` before any hardening changes.

---

## How to Use

Run each SQL query in the Supabase SQL Editor and paste the results into the corresponding section below.

---

## 1. Item Counts by Kind and Source

```sql
SELECT
  es.name AS source_name,
  es.type AS source_type,
  ei.kind,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE ei.priority >= 0 AND NOT ei.is_duplicate) AS active,
  COUNT(*) FILTER (WHERE ei.is_duplicate) AS duplicates,
  COUNT(*) FILTER (WHERE ei.priority < 0) AS stale
FROM explore_items ei
LEFT JOIN event_sources es ON ei.source_id = es.id
GROUP BY es.name, es.type, ei.kind
ORDER BY es.name, ei.kind;
```

**Results:**
```
(paste results here)
```

---

## 2. Missing Critical Fields

### 2a. Title Issues

```sql
SELECT
  COUNT(*) AS total_items,
  COUNT(*) FILTER (WHERE title IS NULL) AS title_null,
  COUNT(*) FILTER (WHERE TRIM(title) = '') AS title_empty,
  COUNT(*) FILTER (WHERE LENGTH(title) < 5) AS title_too_short
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate;
```

**Results:**
```
(paste results here)
```

### 2b. Location Data

```sql
SELECT
  COUNT(*) AS total_active,
  COUNT(*) FILTER (WHERE lat IS NULL OR lng IS NULL) AS missing_coords,
  COUNT(*) FILTER (WHERE town IS NULL) AS missing_town,
  COUNT(*) FILTER (WHERE location_name IS NULL) AS missing_location_name,
  COUNT(*) FILTER (WHERE address IS NULL) AS missing_address
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate;
```

**Results:**
```
(paste results here)
```

### 2c. Timing Data (Events)

```sql
SELECT
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE starts_at IS NULL AND availability_json IS NULL) AS missing_time_info,
  COUNT(*) FILTER (WHERE starts_at IS NULL) AS missing_starts_at,
  COUNT(*) FILTER (WHERE availability_json IS NULL) AS missing_availability,
  COUNT(*) FILTER (WHERE schedule_text IS NOT NULL AND LENGTH(schedule_text) > 50) AS verbose_schedule,
  COUNT(*) FILTER (WHERE time_text IS NOT NULL) AS has_time_text
FROM explore_items
WHERE kind = 'event' AND priority >= 0 AND NOT is_duplicate;
```

**Results:**
```
(paste results here)
```

### 2d. Categorization & Tags

```sql
SELECT
  COUNT(*) AS total_active,
  COUNT(*) FILTER (WHERE category IS NULL) AS missing_category,
  COUNT(*) FILTER (WHERE tags IS NULL OR array_length(tags, 1) IS NULL) AS missing_tags,
  COUNT(*) FILTER (WHERE tags IS NOT NULL AND array_length(tags, 1) > 0) AS has_tags,
  COUNT(*) FILTER (WHERE description IS NULL) AS missing_description,
  COUNT(*) FILTER (WHERE hook_line IS NULL OR LENGTH(hook_line) < 10) AS missing_hook_line
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate;
```

**Results:**
```
(paste results here)
```

### 2e. Quality Scores

```sql
SELECT
  COUNT(*) AS total_active,
  COUNT(*) FILTER (WHERE normalized_confidence IS NULL) AS missing_confidence,
  COUNT(*) FILTER (WHERE normalized_confidence < 40) AS low_confidence,
  COUNT(*) FILTER (WHERE normalized_confidence >= 40 AND normalized_confidence < 70) AS medium_confidence,
  COUNT(*) FILTER (WHERE normalized_confidence >= 70) AS high_confidence
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate;
```

**Results:**
```
(paste results here)
```

---

## 3. Confidence Histogram

```sql
SELECT
  CASE
    WHEN normalized_confidence IS NULL THEN 'NULL'
    WHEN normalized_confidence < 20 THEN '0-19'
    WHEN normalized_confidence < 40 THEN '20-39'
    WHEN normalized_confidence < 60 THEN '40-59'
    WHEN normalized_confidence < 80 THEN '60-79'
    ELSE '80-100'
  END AS confidence_bucket,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate
GROUP BY 1
ORDER BY 1;
```

**Results:**
```
(paste results here)
```

---

## 4. Duplicate Analysis

### 4a. Current Duplicate State

```sql
SELECT
  COUNT(*) AS total_items,
  COUNT(*) FILTER (WHERE is_duplicate) AS marked_duplicates,
  COUNT(*) FILTER (WHERE NOT is_duplicate) AS unique_items,
  COUNT(DISTINCT dedupe_key) FILTER (WHERE dedupe_key IS NOT NULL) AS distinct_dedupe_keys
FROM explore_items
WHERE priority >= 0;
```

**Results:**
```
(paste results here)
```

### 4b. Exact Duplicate Groups (by source_id + external_id)

```sql
SELECT COUNT(*) AS exact_dupe_violations
FROM (
  SELECT source_id, external_id
  FROM explore_items
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL
  GROUP BY source_id, external_id
  HAVING COUNT(*) > 1
) sub;
```

**Results:**
```
(paste results here)
```

### 4c. Potential Near-Duplicates Not Yet Caught

```sql
-- Items with same geohash bucket + similar title but different dedupe_key
-- (These might slip through current dedup)
SELECT
  a.id AS id_a,
  b.id AS id_b,
  a.title AS title_a,
  b.title AS title_b,
  similarity(LOWER(a.title), LOWER(b.title)) AS title_sim,
  a.is_duplicate AS a_dup,
  b.is_duplicate AS b_dup
FROM explore_items a
JOIN explore_items b
  ON a.id < b.id
  AND a.lat IS NOT NULL AND b.lat IS NOT NULL
  AND ABS(a.lat - b.lat) < 0.005
  AND ABS(a.lng - b.lng) < 0.005
WHERE
  a.priority >= 0 AND b.priority >= 0
  AND NOT a.is_duplicate AND NOT b.is_duplicate
  AND similarity(LOWER(a.title), LOWER(b.title)) > 0.4
ORDER BY title_sim DESC
LIMIT 20;
```

**Results:**
```
(paste results here)
```

### 4d. Events with Same Date/Time + Close Distance

```sql
-- Events that might be duplicates (same start within 60 min, close location)
SELECT
  a.id AS id_a,
  b.id AS id_b,
  a.title AS title_a,
  b.title AS title_b,
  a.starts_at AS starts_a,
  b.starts_at AS starts_b,
  ABS(EXTRACT(EPOCH FROM (a.starts_at - b.starts_at)) / 60) AS minutes_diff
FROM explore_items a
JOIN explore_items b
  ON a.id < b.id
  AND a.starts_at IS NOT NULL AND b.starts_at IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM (a.starts_at - b.starts_at))) < 3600  -- within 60 min
  AND a.lat IS NOT NULL AND b.lat IS NOT NULL
  AND ABS(a.lat - b.lat) < 0.005
  AND ABS(a.lng - b.lng) < 0.005
WHERE
  a.priority >= 0 AND b.priority >= 0
  AND NOT a.is_duplicate AND NOT b.is_duplicate
ORDER BY minutes_diff ASC
LIMIT 20;
```

**Results:**
```
(paste results here)
```

---

## 5. Tag Analysis

### 5a. Tag Distribution

```sql
SELECT tag, COUNT(*) AS usage_count
FROM explore_items, UNNEST(tags) AS tag
WHERE priority >= 0 AND NOT is_duplicate
GROUP BY tag
ORDER BY usage_count DESC
LIMIT 30;
```

**Results:**
```
(paste results here)
```

### 5b. Non-Canonical Tags Check

```sql
-- First, let's see all unique tags to identify non-canonical ones
SELECT DISTINCT UNNEST(tags) AS tag
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate
ORDER BY tag;
```

**Results:**
```
(paste results here)
```

---

## 6. Source-Specific Quality

### 6a. Google Places Quality

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE description IS NOT NULL) AS has_description,
  COUNT(*) FILTER (WHERE schedule_text IS NOT NULL) AS has_schedule,
  COUNT(*) FILTER (WHERE schedule_text IS NOT NULL AND LENGTH(schedule_text) > 50) AS verbose_schedule,
  COUNT(*) FILTER (WHERE time_text IS NOT NULL) AS has_short_schedule,
  AVG(normalized_confidence)::INTEGER AS avg_confidence
FROM explore_items ei
JOIN event_sources es ON ei.source_id = es.id
WHERE es.type = 'api_google_places'
  AND ei.priority >= 0 AND NOT ei.is_duplicate;
```

**Results:**
```
(paste results here)
```

### 6b. Curated CSV Quality

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE description IS NOT NULL) AS has_description,
  COUNT(*) FILTER (WHERE tags IS NOT NULL AND array_length(tags, 1) > 0) AS has_tags,
  COUNT(*) FILTER (WHERE normalized_confidence IS NOT NULL) AS has_confidence,
  AVG(normalized_confidence)::INTEGER AS avg_confidence
FROM explore_items ei
JOIN event_sources es ON ei.source_id = es.id
WHERE es.type = 'curated_csv'
  AND ei.priority >= 0 AND NOT ei.is_duplicate;
```

**Results:**
```
(paste results here)
```

---

## 7. Filter Correctness

### 7a. Items Per Category

```sql
SELECT
  category,
  COUNT(*) AS count,
  COUNT(*) FILTER (WHERE kind = 'event') AS events,
  COUNT(*) FILTER (WHERE kind = 'activity') AS activities
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate
GROUP BY category
ORDER BY count DESC;
```

**Results:**
```
(paste results here)
```

### 7b. Price Bucket Distribution

```sql
SELECT
  price_bucket,
  COUNT(*) AS count
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate
GROUP BY price_bucket
ORDER BY
  CASE price_bucket
    WHEN 'free' THEN 1
    WHEN 'cheap' THEN 2
    WHEN 'moderate' THEN 3
    WHEN 'expensive' THEN 4
    WHEN 'unknown' THEN 5
  END;
```

**Results:**
```
(paste results here)
```

### 7c. Town Distribution

```sql
SELECT
  town,
  COUNT(*) AS count
FROM explore_items
WHERE priority >= 0 AND NOT is_duplicate
GROUP BY town
ORDER BY count DESC
LIMIT 15;
```

**Results:**
```
(paste results here)
```

---

## 8. Enrichment Queue State

```sql
SELECT
  status,
  COUNT(*) AS count
FROM enrichment_queue
GROUP BY status
ORDER BY status;
```

**Results:**
```
(paste results here)
```

---

## Summary Findings (2026-02-03)

### Raw Baseline Data

```json
{
  "total_items": 1028,
  "active_items": 981,
  "duplicates_marked": 39,
  "stale_items": 8,
  "by_source": [
    {"kind": "event", "active": 18, "source": "curated_csv"},
    {"kind": "activity", "active": 212, "source": "curated_csv"},
    {"kind": "activity", "active": 748, "source": "api_google_places"},
    {"kind": "event", "active": 3, "source": "api_ticketmaster"}
  ],
  "missing_fields": {
    "description": 54,
    "category": 278,
    "hook_line": 56,
    "tags": 1,
    "town": 0,
    "coords": 0,
    "confidence": 0
  },
  "events_timing": {
    "total_events": 21,
    "missing_starts_at": 9,
    "verbose_schedule": 548,
    "has_time_text": 822
  },
  "confidence_histogram": [
    {"bucket": "70+", "count": 975},
    {"bucket": "<40", "count": 6}
  ],
  "potential_dupes_unflagged": 2,
  "enrichment_queue": {"running": 1028}
}
```

### Key Metrics Summary

| Metric | Value | % of Active |
|--------|-------|-------------|
| Total items | 1028 | - |
| Active items | 981 | 100% |
| Marked duplicates | 39 | 4.0% |
| Stale items | 8 | 0.8% |
| Missing descriptions | 54 | 5.5% |
| Missing category | 278 | **28.3%** |
| Missing hook_line | 56 | 5.7% |
| Missing tags | 1 | 0.1% |
| Verbose schedules | 548 | 55.9% |
| Has time_text | 822 | 83.8% |
| Low confidence (<40) | 6 | 0.6% |
| Missing coordinates | 0 | 0% |
| Missing town | 0 | 0% |
| Potential unflagged dupes | 2 | - |

### Source Distribution

| Source | Events | Activities | Total |
|--------|--------|------------|-------|
| curated_csv | 18 | 212 | 230 |
| api_google_places | 0 | 748 | 748 |
| api_ticketmaster | 3 | 0 | 3 |
| **Total** | **21** | **960** | **981** |

---

## TOP 5 Data Quality Problems (Ranked)

### P0 - CRITICAL: Enrichment Queue Stuck

**Issue**: All 1028 queue entries are in `running` status - none are completing.

**Impact**:
- No new enrichments happening
- Items missing descriptions/hook_lines won't get populated
- LLM pipeline is blocked

**Root Cause**: Likely jobs got claimed but never completed (process crash, timeout, or missing completion call).

**Fix**:
1. Reset stuck jobs: `UPDATE enrichment_queue SET status = 'queued', started_at = NULL WHERE status = 'running';`
2. Investigate why jobs aren't completing (check Edge Function logs)
3. Add job timeout mechanism

---

### P1 - Missing Category (278 items, 28%)

**Issue**: 278 items (28.3%) have NULL category.

**Impact**:
- Category filter chips don't show these items
- Users miss ~1/4 of content when filtering by category
- Likely mostly Google Places items (categories don't map cleanly)

**Fix**:
- Improve Google Places category mapping in normalization adapter
- Add fallback category inference from tags or place types
- Backfill existing items with inferred categories

---

### P1 - Verbose Schedules (548 items)

**Issue**: 548 items have schedule_text > 50 chars (verbose like "Monday: 8:00 AM - 8:00 PM; Tuesday: ...")

**Mitigating Factor**: 822 items (84%) already have `time_text` populated, so this is partially addressed.

**Impact**:
- Card displays show ugly long schedule strings
- Poor UX on explore cards

**Fix**:
- Ensure remaining items get `time_text` via enrichment
- Check if `time_text` is being used in UI (verify preference order)

---

### P2 - Missing Descriptions (54 items, 5.5%)

**Issue**: 54 items have NULL description.

**Impact**:
- Detail pages show blank description
- Lower quality experience

**Fix**:
- LLM enrichment should generate descriptions
- Deterministic fallback from raw data (Google Places editorialSummary)

---

### P2 - Missing Hook Lines (56 items, 5.7%)

**Issue**: 56 items have NULL or very short hook_line.

**Impact**:
- Card previews show generic or empty text
- Less engaging browse experience

**Fix**:
- LLM enrichment generates hook_line
- Ensure enrichment queue processes these

---

## Assessment

### What's Working Well
- ✅ **Deduplication**: Only 2 potential unflagged duplicates - current system is effective
- ✅ **Confidence scores**: 99.4% have confidence ≥70, only 6 items low confidence
- ✅ **Location data**: 100% have coordinates and town
- ✅ **Tags**: 99.9% have tags
- ✅ **time_text coverage**: 84% already have condensed schedules

### What Needs Attention
- ❌ **Enrichment queue stuck** - blocking all improvements
- ⚠️ **Category mapping** - 28% missing, breaks filters
- ⚠️ **Verbose schedules** - 548 items need condensing
- ⚠️ **Descriptions/hook_lines** - ~5% missing each

---

## Recommended Action Plan

### Immediate (P0)
1. **Fix enrichment queue** - Reset stuck jobs, investigate root cause

### Phase 2 Adjustments
Skip heavy dedupe work - current system catches 95%+ of duplicates. Only 2 items slipped through.

### Phase 3 Focus
1. Fix category mapping in Google Places adapter
2. Ensure enrichment generates descriptions + hook_lines
3. Verify time_text is displayed in UI

### Phase 4 Backfill
1. Re-run category inference on 278 items
2. Process enrichment queue for missing descriptions/hook_lines
3. Run single mark_duplicates() pass to catch remaining 2

---

## Next Steps

1. **Fix P0 immediately**: Reset enrichment queue
2. **Skip to Phase 3**: Dedupe is already working well
3. **Focus on category mapping**: Biggest filter-breaking issue
4. **Run backfill**: After fixes are in place

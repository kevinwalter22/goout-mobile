# LLM Enrichment System

This document describes the optional LLM enrichment system that enhances explore_items with AI-generated content.

## Overview

The enrichment system uses LLMs to:
- Generate compelling `hook_line` descriptions
- Add normalized `tags` for categorization
- Parse `schedule_text` into `recurrence` patterns
- Infer `starts_at`/`ends_at` from schedule information

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ enrichment_queue│────▶│ run-enrichment-  │────▶│   LLM Provider  │
│   (database)    │     │ queue (function) │     │ (Anthropic/     │
│                 │     │                  │     │  OpenAI)        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  explore_items   │
                        │  (enriched)      │
                        └──────────────────┘
```

## Database Schema

### New Fields on `explore_items`

| Column | Type | Description |
|--------|------|-------------|
| tags | TEXT[] | Normalized tags (e.g., ["outdoors", "family_friendly"]) |
| llm_enriched_at | TIMESTAMPTZ | When LLM enrichment was last performed |

### `enrichment_queue` Table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| explore_item_id | UUID | FK to explore_items |
| status | job_status | queued, running, done, failed |
| priority | INTEGER | Higher = processed first |
| attempts | INTEGER | Number of attempts |
| max_attempts | INTEGER | Max retries (default: 3) |
| last_error | TEXT | Error message if failed |

## Edge Functions

### `enrich-explore-item`

Enriches a single explore item by ID.

**Request:**
```json
{
  "explore_item_id": "uuid-here"
}
```

**Response:**
```json
{
  "success": true,
  "enrichment": {
    "hook_line": "A compelling description...",
    "tags": ["outdoors", "family_friendly"],
    "recurrence": "weekly",
    "next_occurrence": {
      "starts_at": "2024-01-15T10:00:00Z",
      "ends_at": null
    }
  },
  "usage": {
    "input_tokens": 245,
    "output_tokens": 89
  }
}
```

### `run-enrichment-queue`

Worker function that processes the enrichment queue in batches.

**Request (optional):**
```json
{
  "batch_size": 5,
  "max_items": 50,
  "dry_run": false
}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "processed": 25,
    "enriched": 20,
    "skipped": 3,
    "failed": 2
  },
  "tokens_used": {
    "input": 4500,
    "output": 1200
  },
  "results": [...]
}
```

## Environment Variables

### Required

Set these in your Supabase project settings under Edge Functions → Secrets:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (preferred) |
| `OPENAI_API_KEY` | OpenAI API key (fallback) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_MODEL` | claude-3-haiku-20240307 | Anthropic model to use |
| `OPENAI_MODEL` | gpt-4o-mini | OpenAI model to use |

**Note:** Only one LLM key is required. The system prefers Anthropic if both are set.

## Valid Tags

The system uses a controlled vocabulary for tags:

**Activity Types:**
- outdoors, indoors, water_activity, winter_activity
- hiking, camping, swimming, skiing, snowboarding

**Audience:**
- family_friendly, kids, adults_only, date_night
- solo_friendly, group_activity

**Vibe:**
- nightlife, relaxing, adventure, cultural
- educational, social, fitness, wellness

**Food & Drink:**
- food, drinks, coffee, dining, bar

**Other:**
- free, budget_friendly, local_favorite
- seasonal, pet_friendly, accessible

## Cost Optimization

The system is designed to minimize LLM costs:

1. **Priority-based processing** - Items missing hook_line are processed first
2. **Skip logic** - Items with existing good data are skipped
3. **Cheap models** - Uses Haiku/GPT-4o-mini by default
4. **Low temperature** - 0.3 for consistent, shorter outputs
5. **Max token limits** - 512 output tokens per request
6. **7-day cooldown** - Won't re-enrich recently processed items

### Estimated Costs

With Claude 3 Haiku (~$0.25/1M input, ~$1.25/1M output):
- ~$0.0003 per item enriched
- 1000 items ≈ $0.30

## Running Locally

### Prerequisites

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Start local Supabase:
   ```bash
   supabase start
   ```

3. Set environment variables:
   ```bash
   # Create .env file in supabase/functions/
   echo "ANTHROPIC_API_KEY=your-key-here" > supabase/functions/.env
   ```

### Deploy Functions

```bash
# Deploy all functions
supabase functions deploy enrich-explore-item
supabase functions deploy run-enrichment-queue

# Set secrets in production
supabase secrets set ANTHROPIC_API_KEY=your-key-here
```

### Run Locally

```bash
# Serve functions locally
supabase functions serve

# Test single item enrichment
curl -X POST http://localhost:54321/functions/v1/enrich-explore-item \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"explore_item_id": "your-item-id"}'

# Run queue worker
curl -X POST http://localhost:54321/functions/v1/run-enrichment-queue \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 5, "max_items": 10}'
```

## Production Setup

### 1. Deploy Functions

```bash
supabase functions deploy enrich-explore-item --project-ref your-project-ref
supabase functions deploy run-enrichment-queue --project-ref your-project-ref
```

### 2. Set Secrets

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref your-project-ref
# OR
supabase secrets set OPENAI_API_KEY=sk-... --project-ref your-project-ref
```

### 3. Set Up Cron Job (Optional)

Use Supabase pg_cron or an external scheduler to run the queue worker periodically:

```sql
-- Run every hour
SELECT cron.schedule(
  'run-enrichment-queue',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/run-enrichment-queue',
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{"batch_size": 10, "max_items": 50}'::jsonb
  );
  $$
);
```

Or use an external service like:
- GitHub Actions (scheduled workflow)
- Vercel Cron
- Railway Cron
- Render Cron

## Manual Enrichment

### Queue Specific Items

```sql
-- Queue a specific item with high priority
SELECT queue_for_enrichment('item-uuid-here', 10);

-- Queue all items missing hook_line
INSERT INTO enrichment_queue (explore_item_id, priority)
SELECT id, 5
FROM explore_items
WHERE hook_line IS NULL
  AND llm_enriched_at IS NULL
ON CONFLICT (explore_item_id) DO NOTHING;
```

### Check Queue Status

```sql
-- Queue summary
SELECT status, COUNT(*)
FROM enrichment_queue
GROUP BY status;

-- Failed items
SELECT eq.*, ei.title
FROM enrichment_queue eq
JOIN explore_items ei ON ei.id = eq.explore_item_id
WHERE eq.status = 'failed'
ORDER BY eq.updated_at DESC;
```

## Troubleshooting

### "LLM not configured"

Set either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in Edge Function secrets.

### "Failed to parse LLM response"

The LLM returned invalid JSON. Check the `last_error` in `enrichment_queue` for details. The system will retry up to 3 times.

### High token usage

1. Check for items with very long descriptions
2. Consider truncating input data
3. Use a cheaper model

### Items not being enriched

1. Check `enrichment_queue` for failed jobs
2. Verify item exists in `explore_items`
3. Check if `llm_enriched_at` is recent (7-day cooldown)

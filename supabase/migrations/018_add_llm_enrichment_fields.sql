-- ============================================================================
-- LLM Enrichment Fields
-- ============================================================================
-- Adds fields to explore_items for LLM-generated content and tracking
-- ============================================================================

-- Add tags array field for normalized categorization
ALTER TABLE explore_items ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Add timestamp for when LLM enrichment was performed
ALTER TABLE explore_items ADD COLUMN IF NOT EXISTS llm_enriched_at TIMESTAMPTZ;

-- Add index for finding items needing enrichment
CREATE INDEX IF NOT EXISTS idx_explore_items_needs_enrichment
ON explore_items(llm_enriched_at, normalized_confidence)
WHERE llm_enriched_at IS NULL;

-- Add index for tag-based queries
CREATE INDEX IF NOT EXISTS idx_explore_items_tags ON explore_items USING GIN(tags);

-- ============================================================================
-- Enrichment Queue Table
-- ============================================================================
-- Separate queue for LLM enrichment (distinct from normalization jobs)

CREATE TABLE IF NOT EXISTS enrichment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explore_item_id UUID NOT NULL REFERENCES explore_items(id) ON DELETE CASCADE,
  status job_status NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  -- Processing metadata
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Only one enrichment job per item
  UNIQUE(explore_item_id)
);

-- Indexes for enrichment queue
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status ON enrichment_queue(status);
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_priority ON enrichment_queue(priority DESC, created_at ASC)
  WHERE status = 'queued';

-- Enable RLS
ALTER TABLE enrichment_queue ENABLE ROW LEVEL SECURITY;

-- RLS policy - service role only
DROP POLICY IF EXISTS "Service role can manage enrichment_queue" ON enrichment_queue;
CREATE POLICY "Service role can manage enrichment_queue"
  ON enrichment_queue FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Auto-update trigger
DROP TRIGGER IF EXISTS update_enrichment_queue_updated_at ON enrichment_queue;
CREATE TRIGGER update_enrichment_queue_updated_at
  BEFORE UPDATE ON enrichment_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to queue items for enrichment (only if not already enriched)
CREATE OR REPLACE FUNCTION queue_for_enrichment(
  p_explore_item_id UUID,
  p_priority INTEGER DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO enrichment_queue (explore_item_id, priority)
  VALUES (p_explore_item_id, p_priority)
  ON CONFLICT (explore_item_id) DO UPDATE
  SET
    priority = GREATEST(enrichment_queue.priority, EXCLUDED.priority),
    status = CASE
      WHEN enrichment_queue.status = 'failed' THEN 'queued'::job_status
      ELSE enrichment_queue.status
    END,
    updated_at = NOW()
  WHERE enrichment_queue.status != 'done';
END;
$$ LANGUAGE plpgsql;

-- Function to claim next enrichment job (atomic)
CREATE OR REPLACE FUNCTION claim_enrichment_job()
RETURNS TABLE(
  job_id UUID,
  explore_item_id UUID,
  item_title TEXT,
  item_description TEXT,
  item_hook_line TEXT,
  item_category TEXT,
  item_schedule_text TEXT,
  item_time_text TEXT,
  item_recurrence TEXT,
  item_season TEXT,
  item_tags TEXT[]
) AS $$
DECLARE
  v_job_id UUID;
  v_explore_item_id UUID;
BEGIN
  -- Atomically claim the next queued job (highest priority first)
  UPDATE enrichment_queue
  SET status = 'running',
      started_at = NOW(),
      attempts = attempts + 1,
      updated_at = NOW()
  WHERE id = (
    SELECT id FROM enrichment_queue
    WHERE status = 'queued'
      AND attempts < max_attempts
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, enrichment_queue.explore_item_id INTO v_job_id, v_explore_item_id;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  -- Return job details with explore item data
  RETURN QUERY
  SELECT
    v_job_id,
    e.id,
    e.title,
    e.description,
    e.hook_line,
    e.category,
    e.schedule_text,
    e.time_text,
    e.recurrence,
    e.season,
    e.tags
  FROM explore_items e
  WHERE e.id = v_explore_item_id;
END;
$$ LANGUAGE plpgsql;

-- Function to complete an enrichment job
CREATE OR REPLACE FUNCTION complete_enrichment_job(
  p_job_id UUID,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE enrichment_queue
  SET
    status = CASE WHEN p_success THEN 'done' ELSE 'failed' END,
    completed_at = NOW(),
    last_error = p_error,
    updated_at = NOW()
  WHERE id = p_job_id;
END;
$$ LANGUAGE plpgsql;

-- Function to apply enrichment results to explore_item
CREATE OR REPLACE FUNCTION apply_enrichment(
  p_explore_item_id UUID,
  p_hook_line TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_recurrence TEXT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_ends_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE explore_items
  SET
    hook_line = COALESCE(p_hook_line, hook_line),
    tags = COALESCE(p_tags, tags),
    recurrence = COALESCE(p_recurrence, recurrence),
    starts_at = COALESCE(p_starts_at, starts_at),
    ends_at = COALESCE(p_ends_at, ends_at),
    llm_enriched_at = NOW(),
    updated_at = NOW()
  WHERE id = p_explore_item_id;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION queue_for_enrichment(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION claim_enrichment_job() TO service_role;
GRANT EXECUTE ON FUNCTION complete_enrichment_job(UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION apply_enrichment(UUID, TEXT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ============================================================================
-- Queue existing items that need enrichment
-- ============================================================================
-- Queue items missing hook_line or with low confidence

INSERT INTO enrichment_queue (explore_item_id, priority)
SELECT id,
  CASE
    WHEN hook_line IS NULL THEN 10
    WHEN normalized_confidence < 50 THEN 5
    ELSE 1
  END as priority
FROM explore_items
WHERE llm_enriched_at IS NULL
  AND (hook_line IS NULL OR normalized_confidence < 70)
ON CONFLICT (explore_item_id) DO NOTHING;

-- Migration 113: Deterministic category fix + vague description refresh
--
-- Root cause of lingering "board game session = Food & Drink":
--   Migration 111 re-queued items for LLM re-enrichment, but the
--   enrich-explore-item function skips items enriched within 7 days
--   (llm_enriched_at guard). Items enriched just before migration 111
--   ran were never actually re-enriched, so their wrong categories remain.
--
-- Fix strategy: Apply the same TITLE_KEYWORD_RULES from normalize-fields.ts
-- directly via SQL for all events already in the database, bypassing the
-- LLM entirely for the category assignment.
--
-- Additionally: clear stub descriptions (< 40 chars) and reset llm_enriched_at
-- to NULL so the next enrichment pass generates proper descriptions.

-- ============================================================================
-- PART 1: Fix gaming / social events miscategorized as Food & Drink
-- ============================================================================
-- Same keyword set as normalize-fields.ts TITLE_KEYWORD_RULES — "Arts & Culture".

UPDATE explore_items
SET
  category         = 'Arts & Culture',
  llm_enriched_at  = NULL,   -- bypass 7-day guard so enrichment improves tags/description
  updated_at       = NOW()
WHERE deleted_at IS NULL
  AND category = 'Food & Drink'
  AND kind     = 'event'
  AND title ~* '(board.?game|game.?night|trivia|bingo|karaoke|escape.?room|pub.?quiz'
             '|tabletop|dungeons|d&d|game.?show|open.?mic'
             '|comedy.?night|comedy.?show|stand.?up|improv'
             '|poetry.?slam|paint.{0,5}sip|craft.?night)';

-- ============================================================================
-- PART 2: Fix fitness events miscategorized as Food & Drink
-- ============================================================================
-- Same keyword set as normalize-fields.ts TITLE_KEYWORD_RULES — "Sports & Recreation".

UPDATE explore_items
SET
  category         = 'Sports & Recreation',
  llm_enriched_at  = NULL,
  updated_at       = NOW()
WHERE deleted_at IS NULL
  AND category = 'Food & Drink'
  AND kind     = 'event'
  AND title ~* '(yoga.?class|yoga.?session|pilates.?class|pilates.?session'
             '|fitness.?class|fitness.?session|run.?club|running.?club'
             '|cycling.?class|spin.?class|boot.?camp.?class|hiit.?class)';

-- ============================================================================
-- PART 3: Re-queue recategorized items for enrichment
-- ============================================================================
-- llm_enriched_at is now NULL, so the 7-day guard won't skip these.
-- Re-enrichment improves tags, hook_line, and description for the new category.

INSERT INTO enrichment_queue (explore_item_id, priority)
SELECT id, 95
FROM explore_items
WHERE deleted_at IS NULL
  AND llm_enriched_at IS NULL
  AND category IN ('Arts & Culture', 'Sports & Recreation')
  AND title ~* '(board.?game|game.?night|trivia|bingo|karaoke|escape.?room|pub.?quiz'
             '|tabletop|dungeons|d&d|game.?show|open.?mic'
             '|comedy.?night|comedy.?show|stand.?up|improv|poetry.?slam|paint.{0,5}sip|craft.?night'
             '|yoga.?class|yoga.?session|pilates|fitness.?class|run.?club|running.?club'
             '|cycling.?class|spin.?class)'
  AND NOT EXISTS (
    SELECT 1 FROM enrichment_queue eq
    WHERE eq.explore_item_id = explore_items.id
      AND eq.completed_at IS NULL
  )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 4: Clear stub descriptions so re-enrichment generates real ones
-- ============================================================================
-- apply_enrichment only writes description when description IS NULL
-- (CASE WHEN description IS NULL THEN p_description ELSE description END).
-- Events with stub descriptions (< 40 chars) or description = title
-- are cleared here so the next enrichment pass fills in proper content.
-- Scoped to events only; activity items often have brief intentional descriptions.

UPDATE explore_items
SET
  description     = NULL,
  llm_enriched_at = NULL,
  updated_at      = NOW()
WHERE deleted_at IS NULL
  AND kind = 'event'
  AND llm_enriched_at IS NOT NULL   -- only items that have been through enrichment before
  AND (
    -- Obvious stubs
    (description IS NOT NULL AND length(trim(description)) < 40)
    -- Description is verbatim copy of the title (enrichment copied title, nothing more)
    OR (description IS NOT NULL AND trim(lower(description)) = trim(lower(title)))
  );

-- Queue for re-enrichment (llm_enriched_at is now NULL — guard won't block these)
INSERT INTO enrichment_queue (explore_item_id, priority)
SELECT id, 70
FROM explore_items
WHERE deleted_at IS NULL
  AND kind            = 'event'
  AND description     IS NULL
  AND llm_enriched_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM enrichment_queue eq
    WHERE eq.explore_item_id = explore_items.id
      AND eq.completed_at IS NULL
  )
ON CONFLICT DO NOTHING;

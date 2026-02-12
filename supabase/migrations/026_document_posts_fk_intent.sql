-- Migration 026: Document Posts FK Constraint Intent
-- Clarifies that standalone posts (both event_id and explore_item_id NULL) are intentionally allowed

-- Add table comment documenting the FK design decision
COMMENT ON TABLE posts IS 'User posts with optional event/activity links. Posts can be:
1. Linked to an explore_item (via explore_item_id) - current flow from Explore tab
2. Linked to a legacy event (via event_id) - deprecated flow
3. Standalone (both NULL) - allowed for future features like "free posts"

No CHECK constraint is applied - both FKs being NULL is valid.';

-- Add column comments for clarity
COMMENT ON COLUMN posts.event_id IS 'Optional FK to legacy events table. NULL for standalone or explore_item posts.';
COMMENT ON COLUMN posts.explore_item_id IS 'Optional FK to explore_items table. NULL for standalone or legacy event posts.';

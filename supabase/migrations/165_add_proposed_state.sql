-- 165_add_proposed_state.sql
-- Adds the 'proposed' task state (agents draft here; only Kevin promotes proposed→ready).
-- Standalone migration because ADD VALUE must commit before 166's functions reference it.
--
-- ROLLBACK: enum values can't be dropped (harmless if left). To retire the loop, first
--   move any rows off it: update build_tasks set status='draft' where status='proposed';
alter type public.build_task_status add value if not exists 'proposed' after 'draft';

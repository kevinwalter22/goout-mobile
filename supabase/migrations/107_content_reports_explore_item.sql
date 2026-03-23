-- ============================================================================
-- Allow reporting explore items via the content_reports table (107)
-- ============================================================================
-- The moderation_flags table (078) already accepts 'explore_item' as a
-- target_type, but the client-facing content_reports table (069) did not.
-- This migration extends its CHECK constraint so users can flag listings
-- (spam, incorrect info, closed, etc.) via the existing ReportSheet UI.
-- ============================================================================

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_target_type_check;

ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'user', 'explore_item'));

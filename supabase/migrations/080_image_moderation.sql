-- Migration 080: Image Moderation Infrastructure
--
-- 1. Add avatar moderation columns to profiles
-- 2. Insert image_moderation_enabled feature flag (default ON)
--
-- Depends on: 078_moderation_primitives.sql (content_moderation_status enum)

-- ============================================================================
-- 1. Avatar moderation columns on profiles
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_moderation_status content_moderation_status
    NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS avatar_moderation_reason TEXT,
  ADD COLUMN IF NOT EXISTS avatar_moderated_at TIMESTAMPTZ;

-- ============================================================================
-- 2. Feature flag
-- ============================================================================

INSERT INTO public.feature_flags (flag_name, is_enabled)
VALUES ('image_moderation_enabled', true)
ON CONFLICT (flag_name) DO NOTHING;

-- ============================================================================
-- Verification (run manually):
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'profiles'
--     AND column_name LIKE 'avatar_moderation%';
--
--   SELECT flag_name, is_enabled FROM feature_flags
--   WHERE flag_name = 'image_moderation_enabled';
-- ============================================================================

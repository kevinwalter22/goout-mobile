-- Migration 012: Add avatar_url and bio to profiles
-- Adds support for profile pictures and user bios

-- Add avatar_url and bio columns to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS bio TEXT;

-- ============================================================================
-- MANUAL SETUP REQUIRED: Avatar Storage Bucket
-- ============================================================================
-- Storage bucket policies cannot be set via SQL migration.
-- Set up in Supabase Dashboard → Storage:
--
-- 1. Create bucket:
--    - Name: avatars
--    - Public bucket: checked
--    - File size limit: 5MB
--
-- 2. Add these policies (click Policies tab → New policy → For full customization):
--
--    INSERT policy "Users can upload their own avatar":
--    - Target roles: authenticated
--    - WITH CHECK: (storage.foldername(name))[1] = auth.uid()::text
--
--    UPDATE policy "Users can update their own avatar":
--    - Target roles: authenticated
--    - USING: (storage.foldername(name))[1] = auth.uid()::text
--    - WITH CHECK: (storage.foldername(name))[1] = auth.uid()::text
--
--    DELETE policy "Users can delete their own avatar":
--    - Target roles: authenticated
--    - USING: (storage.foldername(name))[1] = auth.uid()::text
--
--    SELECT policy "Anyone can view avatars":
--    - Target roles: public
--    - USING: true
-- ============================================================================

-- Migration 075: Harden Supabase Storage bucket policies
--
-- Finding: All bucket creation + policies were only in comments (created manually
-- via Dashboard). This migration codifies them as SQL for reproducibility and
-- ensures correct RLS on storage.objects.
--
-- Buckets:
--   posts          — public read, user-scoped write (uid folder)
--   avatars        — public read, user-scoped write (uid folder)
--   explore-images — public read, service-role write only
--
-- Path convention: {userId}/filename.jpg
-- Ownership check: (storage.foldername(name))[1] = auth.uid()::text

-- ============================================================================
-- 1. Ensure buckets exist with correct settings
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('posts', 'posts', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('explore-images', 'explore-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 2. Drop any existing permissive policies (clean slate)
-- ============================================================================

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END;
$$;

-- ============================================================================
-- 3. Posts bucket — public read, owner write
-- ============================================================================

-- Anyone can view post photos (bucket is public, but this covers API access too)
CREATE POLICY "posts: authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'posts');

-- Users can upload only to their own folder
CREATE POLICY "posts: owner insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can overwrite only their own files (upsert)
CREATE POLICY "posts: owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete only their own files
CREATE POLICY "posts: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- 4. Avatars bucket — public read, owner write
-- ============================================================================

CREATE POLICY "avatars: authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars: owner insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars: owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- 5. Explore-images bucket — public read, service-role write only
--    Edge functions (cache-place-photos, lookup-venue-images) upload via
--    service_role which bypasses RLS. No authenticated INSERT policy needed.
-- ============================================================================

CREATE POLICY "explore-images: authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'explore-images');

-- No INSERT/UPDATE/DELETE policies for authenticated on explore-images.
-- Only service_role (which bypasses RLS) can write to this bucket.

-- ============================================================================
-- 6. Service-role cleanup — delete-account and cleanup-orphaned-media
--    edge functions use service_role which bypasses RLS entirely.
--    No extra policies needed for service_role operations.
-- ============================================================================

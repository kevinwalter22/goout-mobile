-- Migration 115: Fix storage policies for UGC event cover images
--
-- Event images are stored at events/{userId}/{eventId}.jpg in the posts bucket.
-- The existing "posts: owner insert" policy allows only paths where the FIRST
-- folder segment is the user's own UUID (e.g. {userId}/filename.jpg).
-- Event images fail this check because their first segment is the literal
-- string "events", not the userId — causing the upload to be rejected silently.
--
-- Symptom: uploadEventImage() logs "[UploadEventImage] Failed" to console,
-- returns null, and image_url is never written to explore_items.
--
-- Fix: Add INSERT, UPDATE, and DELETE policies for the events/ subfolder,
-- verifying ownership via the SECOND path segment.

CREATE POLICY "posts: owner insert events folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = 'events'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- UPDATE is needed because uploadEventImage uses upsert: true
CREATE POLICY "posts: owner update events folder"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = 'events'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = 'events'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "posts: owner delete events folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = 'events'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

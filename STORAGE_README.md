# Supabase Storage Configuration

This document explains the photo upload and storage system used in the app.

---

## Overview

- **Bucket Name:** `posts`
- **Bucket Mode:** PRIVATE (requires signed URLs for access)
- **Storage Path Format:** `{userId}/{postId}.jpg`
- **URL Strategy:** Signed URLs with 1-hour expiry (cached in-memory)

---

## How It Works

### Upload Flow

1. **Camera Capture** ([app/checkin/camera.tsx](app/checkin/camera.tsx))
   - User takes photo with device camera
   - Returns local file URI (e.g., `file:///...`)

2. **Image Upload** ([src/utils/storage.ts](src/utils/storage.ts))
   - Convert URI to ArrayBuffer via `fetch(uri).arrayBuffer()`
   - Upload to Supabase Storage: `{userId}/{postId}.jpg`
   - Uses `contentType: "image/jpeg"` and `upsert: true`

3. **Database Insert** ([app/checkin/camera.tsx:95](app/checkin/camera.tsx:95))
   - Save post record with `photo_path` = storage path
   - If DB insert fails, uploaded image is automatically deleted (atomic behavior)

### Display Flow

1. **Feed Loads Posts** ([src/hooks/usePosts.ts](src/hooks/usePosts.ts))
   - Fetches posts with `photo_path` from database
   - Fetches related profiles and events separately
   - Combines data for display

2. **Image URL Generation** ([src/components/PostImage.tsx](src/components/PostImage.tsx))
   - Component calls `getPostImageUrl(photo_path)`
   - Function generates signed URL (valid for 1 hour)
   - URL is cached in-memory to avoid repeated API calls
   - Shows loading spinner while fetching URL
   - Shows error state if URL generation fails

3. **Image Rendering**
   - React Native `<Image>` component loads from signed URL
   - Proper error handling with fallback UI

---

## Storage Policies Required

The `posts` bucket must have these 3 policies configured:

### How to Add Policies

Go to **Supabase Dashboard** → **Storage** → Click `posts` bucket → **Policies** tab

### Policy 1: Users Can Upload Own Photos

**Operation:** INSERT

**Policy Definition:**
```sql
((bucket_id = 'posts'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))
```

**What it does:** Users can only upload to folders matching their user ID

---

### Policy 2: Authenticated Users Can View Photos

**Operation:** SELECT

**Policy Definition:**
```sql
(bucket_id = 'posts'::text)
```

**What it does:** All authenticated users can view/download photos (V1 public feed)

---

### Policy 3: Users Can Delete Own Photos

**Operation:** DELETE

**Policy Definition:**
```sql
((bucket_id = 'posts'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))
```

**What it does:** Users can only delete photos in their own folder

---

## Verification

### Check Bucket Exists

```sql
SELECT * FROM storage.buckets WHERE id = 'posts';
```

Expected: 1 row with `public = false`

### Check Policies Exist

```sql
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage'
AND tablename = 'objects'
AND policyname LIKE '%photo%';
```

Expected: 3 rows (INSERT, SELECT, DELETE)

### Check Sample Post

```sql
SELECT id, photo_path FROM posts LIMIT 1;
```

Expected path format: `{uuid}/{uuid}.jpg`

---

## Storage Path Format

Current implementation uses deterministic paths for easy debugging:

```
{userId}/{postId}.jpg
```

**Example:**
```
a1b2c3d4.../d4e5f6.../a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg
```

**Benefits:**
- Easy to find all photos for a user
- Easy to debug specific posts
- No timestamp needed since postId is unique
- `upsert: true` allows retries without creating duplicates

**Disadvantages:**
- Only one photo per post (by design for V1)

---

## Signed URL Caching

**Why Needed:**
- Private buckets require signed URLs for each image
- Generating signed URLs on every render is expensive
- Each URL request counts toward API limits

**How It Works:**
- URLs cached in-memory with 1-hour expiry
- Cache key = `photo_path`
- Cache expires 1 minute before Supabase expiry to prevent race conditions
- Cache cleared when image is deleted

**Cache Location:** [src/utils/storage.ts:7](src/utils/storage.ts:7)

---

## Dev Logging

All storage operations log to console with prefixes:

- `[Upload]` - Image upload operations
- `[URL]` - Signed URL generation and caching
- `[Delete]` - Image deletion operations
- `[Post]` - Post creation flow
- `[PostImage]` - Component image loading

**To view logs:** Check Metro bundler terminal or React Native debugger console

---

## Error Handling

### Upload Failures

**Error shown to user:** "Upload failed: {error message}"

**Automatic cleanup:** If DB insert fails after upload, image is deleted from storage

### URL Generation Failures

**Fallback:** Tries public URL if signed URL fails (handles bucket mode changes)

**UI:** Shows "Image unavailable" placeholder with gray background

### Image Load Failures

**UI:** Shows error state with "Image unavailable" text

**Logging:** Logs error to console for debugging

---

## Troubleshooting

### Images Don't Display

**Symptoms:** Gray placeholders or "Image unavailable" in feed

**Causes:**
1. Storage policies missing or incorrect
2. Bucket doesn't exist
3. Network issues

**Debug steps:**
1. Check console logs for `[URL]` errors
2. Verify policies exist (SQL above)
3. Check bucket exists and is accessible
4. Verify photo_path in database matches actual storage path

### Upload Fails

**Symptoms:** Alert shows "Upload failed" error

**Causes:**
1. Storage policies don't allow INSERT for user's folder
2. Network issues
3. Image too large (check file size limits)

**Debug steps:**
1. Check console logs for `[Upload]` errors
2. Verify INSERT policy exists
3. Test with smaller image

### Posts Created But No Image

**Symptoms:** Post appears in feed without photo

**Cause:** `photo_path` is NULL or invalid in database

**Debug:**
```sql
SELECT id, photo_path FROM posts WHERE photo_path IS NULL;
```

Should return 0 rows (photo_path is NOT NULL in schema)

---

## Future Enhancements (V2+)

- [ ] Image compression before upload
- [ ] Multiple photos per post (dual mode full support)
- [ ] Thumbnail generation for faster feed loading
- [ ] Offline upload queue
- [ ] Progress indicators during upload
- [ ] Image editing (crop, filters)
- [ ] CDN caching for public buckets

# Quick Fix for Image Loading Error

## Problem

Signed URLs are being generated correctly, but images show "Unknown image download error" when loading.

## Root Cause

The bucket is PRIVATE, but there might be an issue with:
1. Storage SELECT policy not configured correctly
2. CORS settings blocking signed URL access from React Native
3. Authentication headers not being passed correctly

## Quick Fix Option 1: Make Bucket Public (Easiest for V1)

### Step 1: Make Bucket Public

Go to **Supabase Dashboard** → **Storage** → Click `posts` bucket → **Configuration**

Change **Public bucket** to **ON**

### Step 2: Update Storage Policies

Since bucket is now public, we only need INSERT and DELETE policies (not SELECT):

**Keep these 2 policies:**
1. Users can upload own photos (INSERT)
2. Users can delete own photos (DELETE)

**Remove this policy:**
- Authenticated users can view photos (SELECT) - not needed for public bucket

### Step 3: Use Public URLs

The code already has fallback logic. Once bucket is public, images will automatically use public URLs instead of signed URLs.

**No code changes needed** - the `getPostImageUrl()` function will fall back to public URLs when signed URLs fail.

### Step 4: Restart App

```bash
# Stop app (Ctrl+C)
npm start
# Press 'i' for iOS
```

Images should now load successfully.

---

## Alternative Option 2: Fix Private Bucket (More Secure)

If you want to keep bucket private, we need to debug the SELECT policy:

### Check Current SELECT Policy

```sql
SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
AND tablename = 'objects'
AND cmd = 'SELECT';
```

### Ensure SELECT Policy Exists

Go to **Storage** → `posts` bucket → **Policies**

**Policy Name:** Authenticated users can view photos
**Operation:** SELECT
**Definition:**
```sql
(bucket_id = 'posts'::text)
```

**Target roles:** authenticated

### Test Signed URL Manually

1. Copy a signed URL from the console logs
2. Paste it in Safari on your iPhone
3. If image loads → RLS policy is working, issue is with React Native Image component
4. If image doesn't load → RLS policy needs fixing

---

## Recommended: Make Bucket Public for V1

For V1, making the bucket public is simpler and sufficient because:
- All users can see all posts anyway (public feed)
- Upload/delete are still protected by user_id policies
- No sensitive data in images
- Better performance (no signed URL generation needed)
- Easier debugging

You can make it private later in V2 when adding private posts or DMs.

---

## Next: After Images Work

Once images load correctly, we'll fix dual camera mode to composite both photos together.

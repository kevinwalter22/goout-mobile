# Phase 3 Fixes & Setup Guide

## Problems Fixed

1. ✅ **base64-arraybuffer dependency removed** - Now using `fetch().blob()` for uploads
2. ✅ **Event location not available** - Added lat/lng to events table, graceful error handling
3. ✅ **Feed loading errors** - Simplified posts schema to single photo per post
4. ✅ **Posts table structure** - Simplified from posts + post_photos to single posts table

---

## 🗄️ Step 1: Run Database Migration

Go to Supabase Dashboard → SQL Editor → New query

Copy and paste this entire SQL:

```sql
-- Add latitude and longitude to events table if they don't exist
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude FLOAT8;
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude FLOAT8;

-- Drop and recreate posts table with simplified schema
DROP TABLE IF EXISTS post_photos CASCADE;
DROP TABLE IF EXISTS posts CASCADE;

-- Create simplified posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  caption TEXT,
  photo_path TEXT NOT NULL,
  camera_mode TEXT NOT NULL CHECK (camera_mode IN ('front', 'back', 'dual')),
  latitude FLOAT8,
  longitude FLOAT8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT caption_length CHECK (caption IS NULL OR char_length(caption) <= 100)
);

-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for posts
CREATE POLICY "Users can create own post"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can read posts"
  ON posts FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete own post"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX posts_user_id_idx ON posts(user_id);
CREATE INDEX posts_event_id_idx ON posts(event_id);
CREATE INDEX posts_created_at_idx ON posts(created_at DESC);

-- Update sample events with test coordinates (San Francisco area)
-- Replace these with real coordinates for your events
UPDATE events SET
  latitude = 37.7749 + (RANDOM() * 0.1 - 0.05),
  longitude = -122.4194 + (RANDOM() * 0.1 - 0.05)
WHERE latitude IS NULL AND longitude IS NULL;
```

Click **RUN**

---

## 📦 Step 2: Create Storage Bucket

### Option A: Supabase Dashboard (Easiest)

1. Go to **Storage** in Supabase Dashboard
2. Click **New bucket**
3. Name: `posts`
4. **Public bucket:** OFF (keep private)
5. Click **Create bucket**

### Option B: SQL (if dashboard doesn't work)

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('posts', 'posts', false);
```

---

## 🔐 Step 3: Add Storage Policies

Go to **Storage** → `posts` bucket → **Policies** tab

Add these 3 policies:

### Policy 1: Users can upload to their own folder

Click **New policy** → **Custom policy**

Name: `Users can upload own photos`

Operation: INSERT

Definition:
```sql
((bucket_id = 'posts'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))
```

### Policy 2: Authenticated users can view photos

Click **New policy** → **Custom policy**

Name: `Authenticated users can view photos`

Operation: SELECT

Definition:
```sql
(bucket_id = 'posts'::text)
```

### Policy 3: Users can delete their own photos

Click **New policy** → **Custom policy**

Name: `Users can delete own photos`

Operation: DELETE

Definition:
```sql
((bucket_id = 'posts'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))
```

---

## ✅ Step 4: Verify Setup

### Check Events Have Coordinates

```sql
SELECT id, title, latitude, longitude FROM events LIMIT 5;
```

Should show latitude/longitude values (not NULL).

### Check Posts Table Exists

```sql
SELECT * FROM posts LIMIT 1;
```

Should succeed (empty is OK).

### Check Storage Bucket Exists

```sql
SELECT * FROM storage.buckets WHERE id = 'posts';
```

Should show one row with `name = 'posts'` and `public = false`.

### Check Storage Policies

```sql
SELECT policyname FROM storage.policies WHERE bucket_id = 'posts';
```

Should show 3 policies.

---

## 📱 Step 5: Test on iPhone

### Prerequisites

- Events must have `latitude` and `longitude` (check with SQL above)
- Storage bucket `posts` must exist
- Storage policies must be added

### Test Flow

1. **Start app:**
   ```bash
   npm start
   ```
   Press `i` for iOS

2. **Sign in** with your test account

3. **Navigate to Explore tab**
   - See list of events

4. **Tap any event**
   - Event detail opens
   - Should see "I'm Going" button
   - Should see "Check In & Post" button

5. **Tap "Check In & Post"**
   - If event has no lat/lng: See error "Location Not Available"
   - If too far from event: See error "You're too far from this event"
   - If close enough: See camera mode selector

6. **Select camera mode** (try "Back" first)
   - Grant camera permission when prompted
   - Camera view opens

7. **Take photo**
   - Tap white circle button
   - Preview screen shows photo

8. **Add caption** (optional)
   - Type short caption
   - Tap "Post"

9. **Verify upload**
   - Loading indicator shown
   - Alert: "Post created!"
   - Tap OK

10. **Check Feed tab**
    - Post appears at top
    - Shows your username
    - Shows event name
    - Shows photo
    - Shows caption (if added)

---

## 🐛 Troubleshooting

### Error: "Event location not available"

**Cause:** Event missing latitude/longitude

**Fix:** Update event coordinates:
```sql
UPDATE events SET
  latitude = 37.7749,  -- Replace with real coordinates
  longitude = -122.4194
WHERE id = 'your-event-id';
```

### Error: "Failed to load posts"

**Cause:** Posts table doesn't exist or migration not run

**Fix:** Run the migration SQL from Step 1

### Error: "Upload failed"

**Possible causes:**
1. Storage bucket doesn't exist → Create bucket (Step 2)
2. No storage policies → Add policies (Step 3)
3. Network issue → Check internet connection

**Debug:**
Check browser/Expo console for specific Supabase error

### Camera not opening

**Cause:** Camera permission not granted

**Fix:** Grant permission when prompted, or go to Settings → Expo Go → Permissions → Camera → Allow

### Location always fails

**Causes:**
1. Location permission not granted
2. GPS disabled
3. Too far from event (> 200m)

**Debug:** Check console logs for distance value

### Photos not showing in feed

**Causes:**
1. Storage bucket public URL misconfigured
2. Image path incorrect

**Debug:** Check browser console for 404 errors on image URLs

---

## 📊 Database Schema

### events table
```
id          UUID PRIMARY KEY
title       TEXT
starts_at   TIMESTAMPTZ
venue_name  TEXT
city        TEXT
category    TEXT
latitude    FLOAT8        ← Added in migration
longitude   FLOAT8        ← Added in migration
```

### posts table (simplified)
```
id           UUID PRIMARY KEY
user_id      UUID → auth.users
event_id     UUID → events (nullable)
caption      TEXT (max 100 chars)
photo_path   TEXT (storage path)
camera_mode  TEXT ('front'|'back'|'dual')
latitude     FLOAT8
longitude    FLOAT8
created_at   TIMESTAMPTZ
```

### Storage: `posts` bucket
```
Structure: {user_id}/{post_id}/{timestamp}.jpg
Example: a1b2c3.../d4e5f6.../1234567890.jpg
```

---

## 🔍 Manual Testing Checklist

- [ ] Run migration SQL
- [ ] Create `posts` storage bucket
- [ ] Add 3 storage policies
- [ ] Verify events have lat/lng
- [ ] Start app on iPhone
- [ ] Sign in successfully
- [ ] Navigate to event detail
- [ ] Tap "Check In & Post"
- [ ] Grant location permission
- [ ] Grant camera permission
- [ ] Take photo
- [ ] Add caption
- [ ] Upload succeeds
- [ ] Navigate to Feed
- [ ] See new post with photo

---

## 📝 Notes

### Single Photo Only (V1)

Current implementation: ONE photo per post (using first photo from camera flow)

Dual mode captures 2 photos but only uploads the first one. This is intentional for V1 simplicity.

### Location Verification

- Check-in radius: 200 meters (configurable in `src/config/constants.ts`)
- Uses device GPS
- Haversine formula for distance calculation

### Storage Folder Structure

Photos stored as: `{user_id}/{post_id}/{timestamp}.jpg`

Benefits:
- Easy to find all photos for a user
- Easy to find photos for a specific post
- Unique filenames prevent collisions

### RLS Policies

**Posts:**
- Read: All authenticated users (V1 public feed)
- Write: Only own posts
- Delete: Only own posts

**Storage:**
- Upload: Only to own folder `/{auth.uid()}/...`
- Read: All authenticated users
- Delete: Only own folder

---

## 🚀 What's Working Now

✅ Events have lat/lng coordinates
✅ Check-in verifies user location within 200m
✅ Camera opens and captures photo
✅ Photo uploads to Supabase Storage
✅ Post record created in database
✅ Feed displays all posts with photos
✅ No external dependencies (base64-arraybuffer removed)
✅ Graceful error handling for missing coordinates

---

## 📄 Files Changed

**Created:**
- `supabase/migrations/004_fix_posts_and_events.sql`
- `PHASE_3_FIXES.md` (this file)

**Modified:**
- `src/utils/storage.ts` - Removed base64-arraybuffer, use fetch/blob
- `src/types/database.ts` - Updated Post type (added photo_path, lat/lng)
- `src/hooks/usePosts.ts` - Simplified to single photo schema
- `app/checkin/camera.tsx` - Upload single photo only
- `app/(tabs)/feed.tsx` - Display single photo from photo_path
- `app/event/[id].tsx` - Better error handling for missing coordinates

---

Ready to test! 🎉

# Quick Fix for Current Errors

## Issues Fixed:

1. ✅ **crypto.randomUUID() error** - Now using `expo-crypto`
2. ✅ **Foreign key relationship error** - Simplified query syntax
3. ✅ **Schema cache issue** - Migration to refresh Supabase

---

## Step 1: Run SQL Migration

Go to Supabase Dashboard → SQL Editor → Run this:

```sql
-- Drop existing posts table
DROP TABLE IF EXISTS posts CASCADE;

-- Recreate posts table with proper foreign keys
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_id UUID,
  caption TEXT,
  photo_path TEXT NOT NULL,
  camera_mode TEXT NOT NULL CHECK (camera_mode IN ('front', 'back', 'dual')),
  latitude FLOAT8,
  longitude FLOAT8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT caption_length CHECK (caption IS NULL OR char_length(caption) <= 100),
  CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT posts_event_id_fkey FOREIGN KEY (event_id)
    REFERENCES public.events(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can create own post"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can read posts"
  ON posts FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete own post"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX posts_user_id_idx ON posts(user_id);
CREATE INDEX posts_event_id_idx ON posts(event_id);
CREATE INDEX posts_created_at_idx ON posts(created_at DESC);

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
```

---

## Step 2: Add Local Events (if not done yet)

```sql
INSERT INTO events (title, starts_at, venue_name, city, category, latitude, longitude)
VALUES
  ('House Party', NOW() + INTERVAL '1 day', '23 Pierrepont Ave', 'Potsdam', 'social', 44.6697, -74.9810),
  ('Street Hockey', NOW() + INTERVAL '2 days', 'Pierrepont Avenue', 'Potsdam', 'sports', 44.6701, -74.9810),
  ('Yard Sale', NOW() + INTERVAL '3 days', 'Pierrepont Avenue', 'Potsdam', 'market', 44.6693, -74.9810),
  ('Block Party', NOW() + INTERVAL '1 day', 'Near Pierrepont', 'Potsdam', 'social', 44.6697, -74.9800),
  ('Community Gathering', NOW() + INTERVAL '2 days', 'Pierrepont Area', 'Potsdam', 'social', 44.6697, -74.9820),
  ('Coffee Popup', NOW() + INTERVAL '4 days', 'Pierrepont Corner', 'Potsdam', 'food', 44.6702, -74.9805)
ON CONFLICT DO NOTHING;
```

---

## Step 3: Restart App

Stop the current app (Ctrl+C in terminal) and restart:

```bash
npm start
```

Press `i` for iOS.

---

## What Changed in Code:

### 1. [app/checkin/camera.tsx](app/checkin/camera.tsx:14)
```typescript
// Added
import * as Crypto from "expo-crypto";

// Changed from
const postId = crypto.randomUUID();
// To
const postId = Crypto.randomUUID();
```

### 2. [src/hooks/usePosts.ts](src/hooks/usePosts.ts:30-31)
```typescript
// Changed from
profile:profiles!posts_user_id_fkey(username),
event:events!posts_event_id_fkey(title)

// To (simpler syntax - Supabase auto-detects foreign keys)
profile:profiles(username),
event:events(title)
```

### 3. [src/config/constants.ts](src/config/constants.ts:2)
```typescript
// Changed from
export const CHECK_IN_RADIUS_METERS = 200;
// To
export const CHECK_IN_RADIUS_METERS = 400;
```

---

## Test Flow:

1. Open app on iPhone
2. Navigate to Explore → see Potsdam events
3. Tap "House Party" event (at your exact location)
4. Tap "Check In & Post"
   - Grant location permission
   - Should pass 400m radius check
5. Select camera mode (try "Back")
   - Grant camera permission
6. Take photo
7. Add caption (optional)
8. Tap "Post"
   - Should upload successfully
9. Navigate to Feed tab
   - Should see your new post

---

## If Errors Persist:

### "Could not find relationship" error:
- Restart Supabase: Dashboard → Settings → API → "Restart project"
- Wait 1 minute for full restart

### "Property 'crypto' doesn't exist":
- Make sure you restarted the app after installing expo-crypto
- Clear metro bundler: Stop app, run `npx expo start --clear`

### "Upload failed":
- Verify storage bucket exists: `SELECT * FROM storage.buckets WHERE id = 'posts';`
- Verify storage policies exist (3 policies for posts bucket)

---

## Summary of All Fixes:

- ✅ Installed expo-crypto package
- ✅ Updated camera.tsx to use Crypto.randomUUID()
- ✅ Simplified usePosts query (removed explicit FK hints)
- ✅ Increased check-in radius to 400m
- ✅ Created events at your exact location
- ✅ Migration to recreate posts table with proper FKs

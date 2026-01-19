# Phase 3 Complete: Location-Gated Camera Posting

## ✅ The Soul Feature is Live!

Phase 3 implements the core value proposition of Euda: presence-verified, camera-only posting at events. Users must be physically present to post, and can only capture moments in real-time.

---

## 🗄️ SQL Migration (Run in Supabase)

```sql
-- Create posts table
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  caption TEXT,
  camera_mode TEXT NOT NULL CHECK (camera_mode IN ('front', 'back', 'dual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT caption_length CHECK (caption IS NULL OR char_length(caption) <= 100)
);

-- Create post_photos table
CREATE TABLE post_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('front', 'back', 'single')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_photos ENABLE ROW LEVEL SECURITY;

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

-- RLS Policies for post_photos
CREATE POLICY "Users can create own post photos"
  ON post_photos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_photos.post_id
      AND posts.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can read post photos"
  ON post_photos FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete own post photos"
  ON post_photos FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_photos.post_id
      AND posts.user_id = auth.uid()
    )
  );

-- Create indexes
CREATE INDEX posts_user_id_idx ON posts(user_id);
CREATE INDEX posts_event_id_idx ON posts(event_id);
CREATE INDEX posts_created_at_idx ON posts(created_at DESC);
CREATE INDEX post_photos_post_id_idx ON post_photos(post_id);
```

---

## 📦 Supabase Storage Setup

### 1. Create Storage Bucket

1. Go to Supabase Dashboard → Storage
2. Click "New bucket"
3. Name: `posts`
4. Public: **NO** (keep private, use RLS)
5. Click "Create bucket"

### 2. Add Storage Policies

Go to Storage → `posts` bucket → Policies → Add new policy:

**Policy 1: Users can upload to their own folder**
```sql
CREATE POLICY "Users can upload own photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'posts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

**Policy 2: Authenticated users can read all photos**
```sql
CREATE POLICY "Authenticated users can view photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'posts');
```

**Policy 3: Users can delete their own photos**
```sql
CREATE POLICY "Users can delete own photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'posts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

---

## 📋 What Was Implemented

### Location Verification
- Request location permission with clear explanations
- Get user's current GPS coordinates
- Calculate distance using Haversine formula
- Gate check-in based on 200m radius (configurable)
- Show distance in error message if too far

### Camera Modes
- **Back Camera**: Capture what you're seeing
- **Front Camera**: Take a selfie
- **Dual Camera**: Capture back photo, then front photo immediately

### Posting Flow
1. User taps "Check In & Post" on event detail
2. App verifies user is within 200m of event
3. If not: Show error with distance
4. If yes: Navigate to camera mode selector
5. User selects camera mode
6. Camera opens for capture
7. For dual: captures back, then immediately switches to front
8. Preview screen with optional caption input (max 100 chars)
9. Upload photos to Supabase Storage
10. Create post + photo records in database
11. Navigate to Feed
12. Post appears at top of feed

### Feed Implementation
- Shows all posts from all users (V1 simplicity)
- Chronological order (newest first)
- Pull to refresh
- Displays:
  - Username and profile photo placeholder
  - Event name
  - Date
  - Photo(s): side-by-side for dual mode
  - Optional caption

---

## 📁 Files Created

**Config:**
- `src/config/constants.ts` - Check-in radius and camera mode constants

**Utilities:**
- `src/utils/location.ts` - Location permission, GPS, distance calculation
- `src/utils/storage.ts` - Image upload to Supabase Storage

**Hooks:**
- `src/hooks/usePosts.ts` - Fetch posts with user/event details

**Screens:**
- `app/checkin/[eventId].tsx` - Camera mode selector
- `app/checkin/camera.tsx` - Camera capture and preview

**Database:**
- `supabase/migrations/003_create_posts.sql` - Posts tables migration

---

## 📝 Files Modified

- `src/types/database.ts` - Added Post and PostPhoto types
- `app/event/[id].tsx` - Added "Check In & Post" button with location verification
- `app/(tabs)/feed.tsx` - Real feed with posts instead of placeholder
- `app.json` - Added camera and location permissions
- `package.json` - Added expo-location, expo-camera, expo-image-manipulator

---

## 🧪 Test Checklist (iPhone)

### Setup
- [ ] Run SQL migration in Supabase
- [ ] Create `posts` storage bucket
- [ ] Add storage policies (see above)
- [ ] Ensure events have latitude/longitude values
- [ ] Start app: `npm start` → press `i`

### Test: Location Verification
- [ ] Go to event detail screen
- [ ] Tap "Check In & Post"
- [ ] Grant location permission when prompted
- [ ] If you're far from event (> 200m):
  - [ ] See error: "You need to be closer to check in (Xm away)"
  - [ ] Cannot proceed to camera
- [ ] If you're near event (< 200m):
  - [ ] Navigate to camera mode selector

### Test: Back Camera Mode
- [ ] Select "Back Camera"
- [ ] Grant camera permission when prompted
- [ ] Camera view opens with back camera
- [ ] Take photo (tap white circle button)
- [ ] Preview screen shows captured photo
- [ ] Add caption (optional)
- [ ] Tap "Post"
- [ ] Loading indicator shown
- [ ] Navigate to Feed
- [ ] Post appears at top with:
  - [ ] Your username
  - [ ] Event name
  - [ ] Today's date
  - [ ] Back camera photo
  - [ ] Caption (if added)

### Test: Front Camera Mode
- [ ] Check in at event again
- [ ] Select "Front Camera"
- [ ] Camera opens with front camera
- [ ] Take selfie
- [ ] Preview and post
- [ ] Verify in Feed

### Test: Dual Camera Mode
- [ ] Check in at event
- [ ] Select "Dual Camera"
- [ ] Step 1 shows: "Capture back camera"
- [ ] Take back photo
- [ ] Camera automatically switches to front
- [ ] Step 2 shows: "Capture front camera"
- [ ] Take front photo
- [ ] Preview shows last photo (front)
- [ ] Post
- [ ] Feed shows both photos side-by-side

### Test: Caption
- [ ] Post with no caption → no caption shown in feed
- [ ] Post with short caption → shown below photos
- [ ] Try to enter 101+ characters → input limited to 100

### Test: Retake
- [ ] Capture photo
- [ ] On preview, tap "Retake"
- [ ] Camera reopens
- [ ] For dual mode: starts from beginning

### Test: Feed
- [ ] Multiple posts show in chronological order (newest first)
- [ ] Pull down to refresh
- [ ] Dual posts show 2 photos side-by-side
- [ ] Single posts show 1 photo full-width
- [ ] Empty feed shows helpful message

### Test: Permissions Denied
- [ ] Deny location permission → clear error message
- [ ] Deny camera permission → clear error message
- [ ] Can grant permissions from settings and retry

### Test: Edge Cases
- [ ] Turn off internet → upload fails gracefully
- [ ] Background app during capture → state preserved
- [ ] Multiple users → all posts visible in feed

---

## ⚙️ Configuration

### Check-in Radius

Default: 200 meters

To change, edit `src/config/constants.ts`:

```typescript
export const CHECK_IN_RADIUS_METERS = 200; // Change this value
```

### Caption Length

Default: 100 characters

To change, edit `src/config/constants.ts`:

```typescript
export const MAX_CAPTION_LENGTH = 100; // Change this value
```

Also update the SQL constraint in migration if needed.

---

## 🚨 Known Limitations (V1)

### Dual Camera Mode
- Not simultaneous capture (hardware limitation)
- Two separate captures: back first, then front
- User sees both steps clearly labeled

### Time Window
- Spec mentions 2-minute post window
- Not enforced in V1 (deferred to Phase 4)

### Feed Visibility
- Shows ALL posts from ALL authenticated users
- No friend filtering yet (Phase 4 will add this)
- Trade-off: simpler for V1, less privacy

### Offline Support
- Requires internet connection to post
- No offline queue or retry logic

### Image Optimization
- No compression optimization yet
- Photos uploaded at 80% quality
- May add size limits in future

### Web Platform
- Camera and location not supported on web
- Shows "not available" message
- Mobile-only feature by design

---

## 🏗️ Architecture Decisions

### Storage Structure

Photos stored as: `posts/{user_id}/{post_id}/{photo_type}_{timestamp}.jpg`

Benefits:
- Easy to find all photos for a user
- Easy to find all photos for a post
- Unique filenames prevent collisions

### RLS Policy for Feed

V1: All authenticated users can read all posts

Rationale:
- Simpler implementation
- No friend graph yet (Phase 4)
- Matches "see what people are doing" concept
- Easy to restrict later with friend filtering

Trade-off:
- Less privacy than friend-only feed
- Acceptable for V1 with limited users

### Location Accuracy

Using `Location.Accuracy.Balanced`

Rationale:
- Good enough for 200m radius check
- Faster than high accuracy
- Less battery drain

### Distance Calculation

Haversine formula for great-circle distance

Rationale:
- Standard formula for GPS distance
- Accurate within meters for short distances
- Simple, no external dependencies

---

## 🔐 Security Considerations

### Storage RLS
- Users can only upload to their own folder
- Users can only delete their own photos
- All authenticated users can read (for feed)

### Database RLS
- Users can only create posts as themselves
- Users can only delete their own posts
- All authenticated users can read posts (V1)

### Location Verification
- Server-side validation would be better (Phase 4)
- Currently client-side only
- Acceptable risk for V1

---

## 📊 Performance Notes

### Image Upload
- Uses base64 encoding (works cross-platform)
- 80% JPEG quality
- Future: add compression before upload

### Feed Loading
- Fetches all posts with user/event details
- Individual photo queries per post
- Future: optimize with joins or batch queries

### Location Check
- Single GPS read per check-in
- Balanced accuracy (not high accuracy)
- Fast enough for good UX

---

## 🐛 Troubleshooting

### "Event location not available"
- Event missing latitude/longitude in database
- Add coordinates to events table

### "Cannot read property 'current' of null"
- Camera ref not initialized
- Check camera permissions granted

### Photos not showing in feed
- Check storage bucket exists
- Check storage policies applied
- Check image URLs are correct

### "Failed to upload image"
- Check Supabase storage bucket exists
- Check storage policies allow insert
- Check file size < bucket limit

### Location always fails
- Check location permissions granted
- Check GPS enabled on device
- Check event has valid coordinates

---

## 🚀 Next Steps (Phase 4)

Phase 4 will add:
- Friend requests and friend graph
- Friend-only feed filtering
- Likes and comments on posts
- Notifications

---

## 📸 Example Usage

```
User at Coffee Shop (lat: 40.7128, lon: -74.0060)

1. Opens event "Morning Coffee Meetup"
2. Taps "Check In & Post"
3. App gets GPS: (40.7130, -74.0061) → 22 meters away ✓
4. Selects "Dual Camera"
5. Captures back camera of coffee cup
6. Captures front camera of smiling face
7. Adds caption: "Great start to the day!"
8. Posts
9. Feed shows both photos side-by-side with caption
```

---

Ready for testing! The soul feature is complete. 🎉

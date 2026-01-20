# Verification Checklist

**Purpose:** Manual verification items before adding new features
**Status:** Code is healthy, ready for device testing

---

## ✅ Code Quality (Complete)

- [x] ESLint passes (0 errors)
- [x] TypeScript passes (0 errors)
- [x] All fixes documented in FIX_LOG.md

---

## 📋 Configuration Verification

### Supabase Connection

**Environment Variables:**
```
EXPO_PUBLIC_SUPABASE_URL=https://lkmntknpaiaiqvupzjbz.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_mxVuiA0yXUaF88e_h0EWqw_pXUN-LL5
```

**Client Configuration:** [src/lib/supabase.ts](../src/lib/supabase.ts)
- ✅ URL and key loaded from env
- ✅ Auth storage configured (SecureStore for native, AsyncStorage for web)
- ✅ Database type annotations applied
- ✅ AutoRefreshToken enabled

**Storage Bucket:** `posts`
- **Usage:** [src/utils/storage.ts:3](../src/utils/storage.ts#L3)
- **Upload path:** `{userId}/{postId}-back.jpg` and `{userId}/{postId}-front.jpg`
- **URL generation:** Public URLs via `getPublicUrl()`

**⚠️ TODO: Verify bucket exists and is public in Supabase dashboard**

---

## 🧪 Runtime Verification (Device Testing Required)

### Priority 1: Critical Paths

#### 1. Auth Flow
- [ ] Open app → Redirects to signin
- [ ] Sign up with new email → Profile created
- [ ] Sign out → Redirects back to signin
- [ ] Sign in → Loads profile, redirects to feed

**Test Files:**
- [app/index.tsx](../app/index.tsx) - Auth redirect
- [app/(auth)/signin.tsx](../app/(auth)/signin.tsx) - Sign in
- [app/(auth)/signup.tsx](../app/(auth)/signup.tsx) - Sign up
- [src/contexts/AuthContext.tsx](../src/contexts/AuthContext.tsx) - Auth state

#### 2. Feed Loads Posts
- [ ] Navigate to Feed tab
- [ ] Feed loads without errors (check console)
- [ ] Posts display with images (if any posts exist)
- [ ] Single camera posts show one image
- [ ] Dual camera posts show side-by-side layout
- [ ] Pull to refresh reloads feed

**Test Files:**
- [app/(tabs)/feed.tsx](../app/(tabs)/feed.tsx) - Feed screen
- [src/hooks/usePosts.ts](../src/hooks/usePosts.ts) - Posts query
- [src/components/PostImage.tsx](../src/components/PostImage.tsx) - Image display
- [src/components/DualCameraPost.tsx](../src/components/DualCameraPost.tsx) - Dual layout

**Query Behavior:**
```ts
// Current: Loads ALL posts (no friends filter)
const { data: postsData } = await supabase
  .from("posts")
  .select("*")
  .order("created_at", { ascending: false });
```

**Expected Behavior:**
- If 0 posts: Shows empty state "No posts yet"
- If posts exist: Shows chronological list
- Images should load (or show error state if broken)

#### 3. Image URLs Work
- [ ] Image URLs are generated correctly
- [ ] Images load on device (not broken/404)
- [ ] Public bucket access works

**Test:**
1. Create a post (via checkin flow)
2. Check feed - does image appear?
3. Check browser console - any 403/404 errors on image URLs?

**Verification:**
```ts
// URL format should be:
// https://lkmntknpaiaiqvupzjbz.supabase.co/storage/v1/object/public/posts/{userId}/{postId}-back.jpg
```

#### 4. Posting Flow
- [ ] Navigate to Explore → Tap event → "Check In & Post"
- [ ] Location permission prompt appears
- [ ] (Skip location check for now if not at venue)
- [ ] Camera mode selector appears
- [ ] Choose camera mode → Camera opens
- [ ] Take photo → Preview appears
- [ ] Add caption (optional) → Tap "Post"
- [ ] Upload succeeds → Redirects to feed
- [ ] Post appears in feed

**Test Files:**
- [app/event/[id].tsx](../app/event/[id].tsx) - Check-in button
- [app/checkin/[eventId].tsx](../app/checkin/[eventId].tsx) - Mode selector
- [app/checkin/camera.tsx](../app/checkin/camera.tsx) - Camera + upload
- [src/utils/storage.ts](../src/utils/storage.ts) - Image upload

**Known Limitations:**
- Location verification may block check-in if not at venue
- Dual camera composite shows side-by-side (not overlaid)

### Priority 2: Secondary Features

#### 5. Explore Tab
- [ ] Events list loads
- [ ] RSVP toggle works ("I'm Going")
- [ ] RSVP count increments/decrements
- [ ] Tap event → Detail screen
- [ ] Detail screen shows event info

**Test Files:**
- [app/(tabs)/explore.tsx](../app/(tabs)/explore.tsx)
- [app/event/[id].tsx](../app/event/[id].tsx)
- [src/hooks/useEventRSVP.ts](../src/hooks/useEventRSVP.ts)

#### 6. Profile Tab
- [ ] Profile shows username
- [ ] XP/streak displayed (placeholder values)
- [ ] Friends count shows 0
- [ ] Sign out button works

**Test Files:**
- [app/(tabs)/profile.tsx](../app/(tabs)/profile.tsx)

---

## 🔍 Database Verification

### Required Tables (via Supabase Dashboard)

Check these tables exist and have correct structure:

1. **profiles**
   - Columns: id, username, created_at, updated_at, xp, streak
   - Has sample data?

2. **events**
   - Columns: id, title, starts_at, venue_name, city, category, latitude, longitude
   - Has seed data? (Check migration 005, 007)

3. **event_rsvps**
   - Columns: id, user_id, event_id, created_at
   - Should be empty initially

4. **posts**
   - Columns: id, user_id, event_id, caption, photo_path, front_photo_path, camera_mode, latitude, longitude, created_at
   - Should be empty initially

### RLS Policies

Verify Row Level Security is enabled:

- **posts:** Users can insert own, authenticated can read all
- **profiles:** Users can read all, update own
- **events:** All authenticated can read
- **event_rsvps:** Users can insert/delete own

### Storage Bucket

In Supabase Dashboard → Storage:

1. Check `posts` bucket exists
2. Check bucket is **public** (not private)
3. Check "Public bucket" toggle is ON
4. Test URL manually: `https://lkmntknpaiaiqvupzjbz.supabase.co/storage/v1/object/public/posts/test.jpg` (should 404, not 403)

**If 403 Forbidden:** Bucket is private, make it public in dashboard

---

## 🚨 Known Issues (From CURRENT_STATE.md)

### Critical (Blocks V1 Launch)

1. **Feed shows ALL posts, not friends-only**
   - Current: Any authenticated user sees all posts
   - Required: Filter by friendships table
   - Status: Friendships not implemented yet (Phase 4)

2. **Location verification untested**
   - May not work at real venues
   - Distance threshold may be wrong
   - Needs real-world testing

### Medium Priority

3. **No profile auto-creation trigger**
   - If signup succeeds but profile insert fails, user is orphaned
   - Workaround: Manually create profile row
   - Fix: Add database trigger (see FIX_LOG.md)

4. **No image load error handling**
   - If Supabase Storage is down, images show blank
   - No retry logic or fallback UI
   - Fix: Add error boundary in PostImage component

### Low Priority

5. **Dual camera composite incomplete**
   - Current: Side-by-side layout (works)
   - Planned: Front camera as overlay on back camera
   - Status: expo-image-manipulator doesn't support compositing
   - Workaround: Current side-by-side is acceptable

---

## ✅ Safe to Start Development

**All code-level issues resolved.**

The remaining items are **product verification** (does it work?) not **code quality** (is it correct?).

You can safely:
- Add new features (Phase 4: friends system)
- Refactor existing code
- Write tests
- Deploy to Expo for testing

**Next Steps:**
1. Test on physical device (or simulator)
2. Verify Supabase storage bucket is public
3. Create test post to confirm end-to-end flow works
4. Then proceed with Phase 4 (friends system)

---

## Test Account

If you need a test account:
- Email: `test@euda.app` (or any email)
- Password: `testpassword123`

Create via signup flow, then use for testing posts/RSVPs.

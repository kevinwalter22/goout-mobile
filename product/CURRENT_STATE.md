# Current State Report

**Generated:** 2026-01-19
**Last Commit:** `1b81346` - chore: add gsd toolkit files

## Executive Summary

The euda mobile app (V1) is **partially functional** with core infrastructure in place. Phase 3 (posting + dual camera) has been completed. The app runs on iOS via Expo Go, connects to Supabase, and supports the full posting flow including location-verified check-ins and dual camera capture.

**Current Phase:** Between Phase 3 (complete) and Phase 4 (friends system + engagement)

---

## What Works Now

### ✅ Infrastructure & Foundation
- Expo app runs on iOS via Expo Go
- TypeScript + ESLint + Prettier configured
- GitHub CI running (lint + typecheck)
- Supabase fully connected (Auth + DB + Storage)

### ✅ Authentication (Phase 1 - Complete)
- Email/password signup via Supabase Auth
- Email/password signin
- Profile creation on signup with username
- Session management via AuthContext
- Profile tab displays user info (username, XP, streak placeholders)
- Sign out functionality

**Files:**
- [src/contexts/AuthContext.tsx](../src/contexts/AuthContext.tsx) - Auth state + session management
- [src/hooks/useAuth.ts](../src/hooks/useAuth.ts) - Auth hook
- [app/(auth)/signin.tsx](../app/(auth)/signin.tsx) - Sign in screen
- [app/(auth)/signup.tsx](../app/(auth)/signup.tsx) - Sign up screen

### ✅ Navigation (Phase 2 - Complete)
- 3-tab layout: Feed / Explore / Profile
- Expo Router file-based routing
- Auth-gated navigation (redirects to signin if not authenticated)

**Files:**
- [app/_layout.tsx](../app/_layout.tsx) - Root layout with AuthProvider
- [app/(tabs)/_layout.tsx](../app/(tabs)/_layout.tsx) - Tab navigation
- [app/index.tsx](../app/index.tsx) - Entry point with auth redirect

### ✅ Explore Tab (Phase 2 - Complete)
- Displays list of events from `events` table
- Shows: title, date/time, venue, city, category
- RSVP functionality ("I'm Going" toggle)
- Shows RSVP count per event
- Tap event → navigates to event detail screen

**Files:**
- [app/(tabs)/explore.tsx](../app/(tabs)/explore.tsx) - Explore screen
- [app/event/[id].tsx](../app/event/[id].tsx) - Event detail screen
- [src/hooks/useEventRSVP.ts](../src/hooks/useEventRSVP.ts) - RSVP logic

### ✅ Posting Flow (Phase 3 - Complete)
- Location-verified check-in at events
- Camera permission handling
- 3 camera modes: Front / Back / Dual
- Dual camera capture (back photo → front photo sequence)
- Photo upload to Supabase Storage (`posts` bucket)
- Post creation with caption (max 100 chars)
- Storage paths: `{userId}/{postId}-back.jpg` and `{userId}/{postId}-front.jpg`
- Proper cleanup on post creation failure

**Files:**
- [app/event/[id].tsx](../app/event/[id].tsx):62 - Check-in button + location verification
- [app/checkin/[eventId].tsx](../app/checkin/[eventId].tsx) - Camera mode selector
- [app/checkin/camera.tsx](../app/checkin/camera.tsx) - Camera capture + posting
- [src/utils/storage.ts](../src/utils/storage.ts) - Image upload/delete utilities
- [src/utils/location.ts](../src/utils/location.ts) - Location verification

### ✅ Feed Tab (Phase 3 - Complete)
- Displays chronological feed of all posts
- Shows single photo OR dual camera composite
- Displays: username, event title, date, caption
- Pull to refresh
- Post image loading via public URLs from Supabase Storage

**Files:**
- [app/(tabs)/feed.tsx](../app/(tabs)/feed.tsx) - Feed screen
- [src/hooks/usePosts.ts](../src/hooks/usePosts.ts) - Post fetching logic
- [src/components/PostImage.tsx](../src/components/PostImage.tsx) - Single photo display
- [src/components/DualCameraPost.tsx](../src/components/DualCameraPost.tsx) - Dual camera composite

### ✅ Data Model
**Supabase Tables:**
- `profiles` - User profiles (username, xp, streak)
- `events` - Events with location data (lat/lng)
- `event_rsvps` - RSVP tracking
- `posts` - Posts with photo paths and camera mode
- `post_photos` - (exists but not actively used - simplified to columns in `posts`)

**Storage:**
- Bucket: `posts` (public)
- Path structure: `{userId}/{postId}-back.jpg`, `{userId}/{postId}-front.jpg`
- Upload uses ArrayBuffer (iOS compatible)
- Public URLs generated via `getPublicUrl()`

**Schema Files:**
- [supabase/migrations/001_create_profiles.sql](../supabase/migrations/001_create_profiles.sql)
- [supabase/migrations/002_create_event_rsvps.sql](../supabase/migrations/002_create_event_rsvps.sql)
- [supabase/migrations/003_create_posts.sql](../supabase/migrations/003_create_posts.sql)
- [supabase/migrations/009_add_dual_camera_support.sql](../supabase/migrations/009_add_dual_camera_support.sql)

---

## What is Broken / Incomplete

### 🟡 Friends System (Phase 4 - Not Started)
**Status:** Spec'd but not implemented

**Missing:**
- Friend request sending
- Friend request acceptance/rejection
- Friends list display
- Feed filtering (currently shows ALL posts, not just friends)

**Impact:** CRITICAL - This is core to the product vision. Feed is currently "public" which violates the friends-only design.

### 🟡 Engagement Features (Phase 4 - Not Started)
**Status:** Spec'd but not implemented

**Missing:**
- Likes on posts
- Comments on posts

**Impact:** MEDIUM - Nice to have for V1, but not blocking launch if friends system works.

### 🔴 Location Verification Logic
**Status:** Partially implemented, needs verification

**Concern:** Location verification in [src/utils/location.ts](../src/utils/location.ts) is implemented but:
- Not tested on real device at actual event locations
- May have incorrect distance calculations
- Permission handling may be incomplete

**Risk:** Users may not be able to check in, OR users may bypass location gate

### 🟡 Profile Features
**Status:** Minimal implementation

**Missing:**
- Profile photo upload
- XP/streak calculation logic (currently placeholder values)
- Past posts grid on profile
- Edit profile functionality

**Impact:** LOW - These are nice-to-have polish items. Current profile is functional enough for V1.

### 🟡 Activities (not just Events)
**Status:** Not implemented

**Note:** V1 spec mentions "events + activities" in Explore tab. Currently only events are supported. Activities (gym, walk, etc.) are not in the data model.

**Impact:** LOW - Can launch with events only, add activities post-launch.

### 🔴 RLS Policies Review Needed
**Status:** Basic policies exist, but need verification

**Concern:**
- Posts RLS currently allows all authenticated users to read (correct for now)
- No friends-only filtering in place yet
- Need to verify policies are correctly enforced

**Files to review:**
- [supabase/migrations/003_create_posts.sql](../supabase/migrations/003_create_posts.sql):22-40

---

## Risks / Tech Debt

### High Priority

1. **Feed is "Public" Not "Friends-Only"**
   - Current: Any authenticated user sees all posts
   - Required: Only see posts from friends
   - **Blocker for V1 vision**

2. **Location Gate Untested in Real World**
   - Check-in may not work at actual venues
   - Distance threshold may be wrong
   - Needs real-world testing with GPS

3. **No Error Handling for Image Loading**
   - If Supabase Storage is down or URL is invalid, feed will show broken images
   - No retry logic or fallback UI

4. **Profile Creation Not Atomic**
   - Signup creates auth user, but profile creation is separate
   - If profile creation fails, user exists in auth but has no profile
   - Need database trigger or RLS to auto-create profile

### Medium Priority

5. **Hardcoded Location Threshold**
   - Check-in requires being within certain distance (hardcoded in location.ts)
   - Should be configurable per event or globally

6. **No Post Deletion UI**
   - Users cannot delete their own posts via UI
   - DB policy allows deletion, but no button in feed/profile

7. **Image Upload Has No Progress Indicator**
   - Camera screen shows "uploading" spinner, but no progress %
   - For slow connections, user doesn't know if it's working

8. **No Offline Support**
   - App requires internet for all operations
   - Could cache feed locally for better UX

### Low Priority

9. **post_photos Table Unused**
   - Schema has `post_photos` table but code uses columns in `posts` table
   - Either use the table or remove it to reduce confusion

10. **Dual Camera Composite Layout Fixed**
    - Dual photos are always side-by-side
    - No customization options (could add later)

11. **Caption Length Not Enforced in UI**
    - DB constraint is 100 chars
    - TextInput has maxLength prop, but no character counter

12. **Event List Performance**
    - Explore tab loads ALL events
    - No pagination or limit
    - Will slow down as events grow

---

## Quick Win Fixes

### 1. Add Profile Auto-Creation Trigger
**Effort:** 1 hour
**Impact:** Prevents orphaned auth users
**File:** Create `supabase/migrations/010_auto_create_profile.sql`

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, username, xp, streak)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substring(NEW.id::text, 1, 8)),
    0,
    0
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 2. Add Image Load Error Handling
**Effort:** 30 mins
**Impact:** Better UX when images fail
**Files:** [src/components/PostImage.tsx](../src/components/PostImage.tsx), [src/components/DualCameraPost.tsx](../src/components/DualCameraPost.tsx)

Add onError handler to Image component that shows placeholder.

### 3. Add Character Counter to Caption Input
**Effort:** 15 mins
**Impact:** Clear user feedback
**File:** [app/checkin/camera.tsx](../app/checkin/camera.tsx):228

Add `{caption.length}/100` below TextInput.

### 4. Limit Events in Explore to Next 30 Days
**Effort:** 5 mins
**Impact:** Faster load times
**File:** [app/(tabs)/explore.tsx](../app/(tabs)/explore.tsx):44

Add `.gte('starts_at', new Date().toISOString())` to query.

### 5. Remove Unused post_photos Table or Implement It
**Effort:** 10 mins (remove) OR 2 hours (implement)
**Impact:** Reduce confusion
**Decision:** Recommend keeping current simplified approach (columns in posts) and removing post_photos table.

---

## Architecture Notes

### Routing Structure
```
app/
├── _layout.tsx              # Root layout (AuthProvider)
├── index.tsx                # Entry redirect (auth check)
├── (auth)/                  # Auth screens
│   ├── signin.tsx
│   └── signup.tsx
├── (tabs)/                  # Main app tabs
│   ├── _layout.tsx          # Tab navigator
│   ├── feed.tsx             # Feed screen
│   ├── explore.tsx          # Explore screen
│   └── profile.tsx          # Profile screen
├── event/
│   └── [id].tsx             # Event detail screen
└── checkin/
    ├── [eventId].tsx        # Camera mode selector
    └── camera.tsx           # Camera capture + post
```

### State Management
- **Auth:** React Context ([src/contexts/AuthContext.tsx](../src/contexts/AuthContext.tsx))
- **Posts:** Local state + custom hook ([src/hooks/usePosts.ts](../src/hooks/usePosts.ts))
- **RSVPs:** Local state + custom hook ([src/hooks/useEventRSVP.ts](../src/hooks/useEventRSVP.ts))
- **No global state library** (Redux, Zustand, etc.) - using React Context + hooks pattern

### Image Storage Flow
1. User captures photo(s) with camera
2. Photo URI from expo-camera (local file)
3. Fetch URI → ArrayBuffer
4. Upload to Supabase Storage: `posts/{userId}/{postId}-{back|front}.jpg`
5. Get public URL via `getPublicUrl()`
6. Store path in `posts` table
7. Feed loads images using public URLs

### Authentication Flow
1. User lands on [app/index.tsx](../app/index.tsx)
2. AuthContext checks session
3. If authenticated → redirect to `/(tabs)/feed`
4. If not authenticated → redirect to `/(auth)/signin`
5. On signin/signup → session stored by Supabase Auth
6. AuthContext loads profile from `profiles` table
7. Session persists via AsyncStorage (managed by Supabase client)

---

## Testing Recommendations

### Manual Testing Checklist (Pre-Launch)

**Auth Flow:**
- [ ] Sign up with new email
- [ ] Verify profile is created automatically
- [ ] Sign out
- [ ] Sign in with same email
- [ ] Profile persists

**Explore + RSVP:**
- [ ] Events load in Explore tab
- [ ] Tap "I'm Going" toggles RSVP
- [ ] RSVP count increments/decrements
- [ ] Event detail screen shows correct info

**Check-In + Posting:**
- [ ] Check-in button triggers location permission request
- [ ] At event location, check-in succeeds
- [ ] Away from event, check-in is blocked
- [ ] Camera mode selector appears
- [ ] Back camera mode captures photo
- [ ] Front camera mode captures photo
- [ ] Dual camera mode captures both (back → front sequence)
- [ ] Caption can be added (max 100 chars)
- [ ] Post button uploads images and creates post
- [ ] Navigate to feed → post appears

**Feed:**
- [ ] Feed loads all posts chronologically
- [ ] Single photo posts display correctly
- [ ] Dual camera posts display correctly (side-by-side)
- [ ] Pull to refresh reloads feed
- [ ] Profile picture placeholder shows
- [ ] Event title and username display

**Profile:**
- [ ] Profile shows username
- [ ] XP and streak show (placeholder values)
- [ ] Sign out button works

### Real-World Testing Required
- Test check-in at actual event venues (coffee shop, park, etc.)
- Test on slow network (image upload progress)
- Test camera permissions on fresh install
- Test with multiple users (once friends system is built)

---

## Recommended Next Steps

### Phase 4: Friends + Engagement (CRITICAL)

**Priority 1: Friends System**
1. Create `friendships` table (already spec'd in V1_SPEC.md)
2. Add friend request sending UI
3. Add friend request accept/reject UI
4. Add friends list screen
5. Update feed query to filter posts by friends only
6. Update RLS policies to enforce friends-only reads

**Priority 2: Engagement**
1. Create `likes` table
2. Add like button to posts in feed
3. Create `comments` table
4. Add comment count + comment screen

### Polish Before Launch
1. Fix profile auto-creation (database trigger)
2. Test location verification at real venues
3. Add image load error handling
4. Add caption character counter
5. Limit Explore events to upcoming only

### V2 Features (Post-Launch)
- Activities (not just events)
- Profile photo upload
- XP/streak calculation logic
- Past posts grid on profile
- Android support
- Push notifications
- In-app messaging (DMs)

---

## Conclusion

**The app is 70% complete for V1 launch.**

✅ **Strong Foundation:** Auth, navigation, posting, and feed all work.
🔴 **Critical Gap:** Friends system is missing (Phase 4) - this is the core differentiator.
🟡 **Needs Testing:** Location verification must be tested in real world before launch.

**Estimated remaining work for V1 launch:**
- Friends system: 2-3 days
- Likes + comments: 1-2 days
- Testing + fixes: 1-2 days
- **Total: ~1 week** (assuming full-time work)

The codebase is clean, well-structured, and follows Expo + React Native best practices. Once Phase 4 (friends + engagement) is complete, the app will be ready for beta testing with real users.

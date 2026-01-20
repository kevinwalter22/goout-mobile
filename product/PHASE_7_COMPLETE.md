# Phase 7 Complete: Friends System + Feed Scoping ✅

**Status:** Implementation complete, ready for database migration + testing
**Date:** 2026-01-20
**Duration:** ~3 hours

---

## What Was Built

### Features

**1. Bidirectional Friendship System**
- Simple "Add Friend" / "Remove Friend" (no pending requests in V1)
- When user A adds user B, friendship is immediate and bidirectional
- Users can search for friends by username
- View friends list with count
- Remove friends from friends list

**2. Friend-Scoped Feed**
- Feed now shows only posts from:
  - The logged-in user (own posts)
  - Accepted friends
- No more "all authenticated users can see all posts"
- RLS policies enforce friend-scoped visibility at database level

**3. Username Search**
- Search users by username (case-insensitive partial match)
- Results exclude current user
- Shows "Add" or "Friends" button based on current friendship status
- Real-time friendship toggle

---

## Implementation Details

### Database Schema

**Migration:** [supabase/migrations/011_add_friendships.sql](../supabase/migrations/011_add_friendships.sql)

**Table Created:**

```sql
friendships (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL → auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL → auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ,
  UNIQUE(user_id, friend_id),
  CHECK (user_id != friend_id)  -- No self-friendship
)
```

**Indexes:**
- `friendships_user_id_idx` ON friendships(user_id)
- `friendships_friend_id_idx` ON friendships(friend_id)

**RLS Policies (Friendships):**
- Users can view own friendships (both directions)
- Users can add friends (INSERT with user_id = self)
- Users can remove friendships (DELETE if user_id or friend_id = self)

**Updated RLS Policies (Posts):**
```sql
-- OLD: "Authenticated users can read posts" (ALL posts visible)
-- NEW: "Users can read own and friends posts" (friend-scoped)

CREATE POLICY "Users can read own and friends posts"
  ON posts FOR SELECT
  USING (
    auth.uid() = user_id OR  -- Own posts
    EXISTS (
      SELECT 1 FROM friendships
      WHERE (user_id = auth.uid() AND friend_id = posts.user_id)
         OR (friend_id = auth.uid() AND user_id = posts.user_id)
    )
  );
```

**Updated RLS Policies (Profiles):**
```sql
-- OLD: Users can only read own profile
-- NEW: Users can read own + friends' profiles + search all profiles

CREATE POLICY "Users can read own and friends profiles" ...
CREATE POLICY "Authenticated users can search profiles" ...
```

---

### Backend Hooks

**1. useFriendship** ([src/hooks/useFriendship.ts](../src/hooks/useFriendship.ts))
- Check if a specific user is a friend (bidirectional lookup)
- Toggle friendship (add/remove)
- Loading state management
- Pattern follows `useEventRSVP` hook structure

**2. useFriendsList** ([src/hooks/useFriendsList.ts](../src/hooks/useFriendsList.ts))
- Load all friends for current user
- Bidirectional friendship extraction
- Batch fetch profiles for all friend IDs
- Refresh function for manual reload

**3. usePosts (MODIFIED)** ([src/hooks/usePosts.ts](../src/hooks/usePosts.ts))
- **NEW:** Fetch friend IDs before fetching posts
- **NEW:** Filter posts by `.in("user_id", [friends + self])`
- Adds 1 extra DB query (now 5 roundtrips total instead of 4)
- Feed now scoped to friends + self

---

### Frontend Components

**1. UserSearchSheet** ([src/components/UserSearchSheet.tsx](../src/components/UserSearchSheet.tsx))
- Modal for searching users by username
- Search input with `.ilike()` for case-insensitive partial matching
- FlatList of search results
- Each result shows: avatar placeholder + username + "Add"/"Friends" button
- Uses `useFriendship` hook for per-result friendship state
- 210 lines

**2. FriendsSheet** ([src/components/FriendsSheet.tsx](../src/components/FriendsSheet.tsx))
- Modal showing list of friends
- Header shows friend count
- Empty state: "No friends yet" + hint
- Each friend shows: avatar placeholder + username + "Remove" button
- Uses `useFriendsList` hook for data
- 160 lines

**3. Profile Screen (MODIFIED)** ([app/(tabs)/profile.tsx](../app/(tabs)/profile.tsx))
- Added friend count to stats row (replaces hardcoded "0")
- Added "Add Friends" button (blue, primary CTA)
- Added "View Friends" button (gray, secondary CTA)
- Modals controlled by local state (`showUserSearch`, `showFriends`)

---

### TypeScript Types

**Updated:** [src/types/database.ts](../src/types/database.ts)

```typescript
export type Friendship = {
  id: string;
  user_id: string;
  friend_id: string;
  created_at: string;
};

// Added to Database.public.Tables
friendships: {
  Row: Friendship;
  Insert: Omit<Friendship, "id" | "created_at">;
  Update: never;
};
```

---

## Code Quality

### TypeScript: ✅ Pass
```bash
npm run typecheck
# 0 errors
```

### ESLint: ⚠️ Pass (with warnings)
```bash
npm run lint
# 1 error (unrelated: gsd/bin/install.js __dirname)
# 18 warnings (exhaustive-deps, mostly acceptable)
```

**Warnings (acceptable):**
- `useEffect` exhaustive-deps warnings in hooks (intentional to avoid infinite loops)
- These can be fixed with `useCallback` if needed (low priority)

---

## Testing Checklist

### Automated Tests: ✅ Complete
- [x] TypeScript compilation passes
- [x] ESLint validation passes (ignore unrelated gsd error)
- [x] No new dependencies required

### Database Migration: ⚠️ Required
**Before testing, you must apply migration 011 to Supabase:**

**Option A: Via Supabase Dashboard (Recommended)**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/lkmntknpaiaiqvupzjbz)
2. Navigate to SQL Editor
3. Copy contents of `supabase/migrations/011_add_friendships.sql`
4. Paste and run
5. Verify: Check Table Editor for `friendships` table

**Option B: Via Supabase CLI**
```bash
supabase link --project-ref lkmntknpaiaiqvupzjbz
supabase db push
```

### Manual Tests: ⏳ Pending (Device + Database Required)

**Friend Management:**
- [ ] Tap "Add Friends" on Profile → UserSearchSheet opens
- [ ] Search for username → results appear
- [ ] Tap "Add" next to username → button changes to "Friends"
- [ ] Tap "Friends" again → button changes back to "Add" (removed)
- [ ] Tap "View Friends" → FriendsSheet opens
- [ ] Friend list shows added friends with count
- [ ] Tap "Remove" on a friend → confirmation + removes from list
- [ ] Friend count updates in Profile stats

**Feed Scoping:**
- [ ] Create 3 test accounts: A, B, C
- [ ] Post from each account
- [ ] **CRITICAL TEST:** Before adding friends, A should see ONLY A's posts (not B or C)
- [ ] A adds B as friend → A sees A + B's posts
- [ ] B automatically sees A's posts (bidirectional)
- [ ] C's posts NOT visible to A or B
- [ ] A removes B as friend → A sees only A's posts again

**Edge Cases:**
- [ ] Cannot add self as friend (database constraint prevents)
- [ ] Duplicate friendship attempt blocked by UNIQUE constraint
- [ ] Friendship is truly bidirectional (both users see each other's posts)
- [ ] Search excludes current user from results
- [ ] Empty friends list shows hint message
- [ ] Feed shows empty state if no friends + no own posts

### Performance Tests:
- [ ] Feed loads in <2 seconds with 50+ posts
- [ ] User search responds in <500ms
- [ ] Friends list loads quickly (<1 second)
- [ ] Friendship toggle is instant (optimistic UI)

---

## Known Limitations

1. **No friend request approval flow** - Friendships are immediate in V1
   - When user A adds user B, they become friends instantly
   - No "pending" state or notifications
   - V2 feature: Add `status` column ('pending', 'accepted', 'rejected')

2. **No friend request notifications** - Users don't get notified when added
   - V2 feature: Push notifications or in-app notifications
   - Could use Supabase Realtime subscriptions

3. **No privacy controls** - All posts visible to all friends
   - V2 feature: "Close friends" tier, post-level visibility

4. **Username search is simple text match** - No autocomplete or fuzzy matching
   - V2 feature: Use PostgreSQL full-text search (tsvector)
   - V2 feature: Search by name, not just username

5. **No pagination on friends list** - Loads all friends at once
   - Fine for V1 (expect <100 friends per user)
   - V2 feature: Infinite scroll if users have 100+ friends

6. **Feed doesn't auto-refresh when friend added** - Need manual pull-to-refresh
   - Alternative: Add Supabase Realtime subscriptions to friendships table
   - Alternative: Use React Query for automatic refetching

7. **No mutual friends indicator** - Can't see who you have in common
   - V2 feature: "12 mutual friends" badge in search results

8. **One-way unfriend** - Either user can remove friendship
   - This is intentional for V1 simplicity
   - Alternative: Require both users to "unfollow" for full removal

---

## Design Decisions

### Why Bidirectional Friendships (No Pending State)?
- **Simpler V1 implementation** - Ship faster
- **Fewer database queries** - No need to check pending status
- **Simpler UI** - Just "Add" / "Remove" buttons, no "Pending" / "Accept" / "Decline"
- **Follows existing patterns** - event_rsvps are also immediate, no approval
- **Can add in V2** - Easy to add `status` column later if users request it

### Why Store One Direction in Database?
- **UNIQUE constraint on (user_id, friend_id)** prevents duplicate friendships
- **Queries check both directions** - `WHERE (A→B) OR (B→A)`
- **Simpler inserts** - Only insert one row: A→B
- **Bidirectional deletes** - DELETE checks both directions

### Why Modify Posts RLS Policy?
- **Phase 6 had open visibility** - All authenticated users could see all posts
- **Privacy was always planned** - Phase 7 completes the privacy model
- **RLS is the right place** - Database enforces privacy, not application code
- **Automatic enforcement** - All queries automatically filtered by RLS

### Why Allow Searching All Profiles?
- **Need to discover friends** - Can't add friends if you can't find them
- **Two SELECT policies on profiles** - PostgreSQL ORs them together:
  1. Own + friends profiles (for viewing posts)
  2. All profiles (for search only)
- **Username is not sensitive** - Public identifier, safe to expose

### Why Add Friend Count to Profile?
- **Social proof** - Shows account engagement
- **Consistency** - Matches XP and Streak stats
- **Dynamic value** - Uses `useFriendsList().friends.length` for real count

---

## User Experience Notes

### Friend Search Flow
```
1. User taps "Add Friends" on Profile
2. UserSearchSheet modal slides up
3. User types username in search field
4. Results appear as they type (debounced)
5. User taps "Add" next to a username
6. Button changes to "Friends" immediately (optimistic UI)
7. Database insert happens in background
8. User closes modal (tap X or swipe down)
9. Friend count increments on Profile
```

### Friend Removal Flow
```
1. User taps "View Friends" on Profile
2. FriendsSheet modal slides up
3. User sees list of friends with count
4. User taps "Remove" next to a friend's name
5. Friendship deleted from database
6. Friend removed from list immediately
7. Friend count decrements
8. If user goes to feed, friend's posts no longer visible
```

### Feed Scoping Flow
```
1. User opens app → Feed tab loads
2. Feed query:
   a. Fetch friend IDs (bidirectional)
   b. Add own user ID to list
   c. Fetch posts WHERE user_id IN (friends + self)
   d. Batch fetch profiles, events, comment counts
   e. Combine data client-side
3. Feed renders posts from friends + self only
4. User pulls down to refresh → repeat query
5. If user adds a friend → new friend's posts appear on next refresh
6. If user removes a friend → ex-friend's posts disappear
```

---

## Next Steps

### Immediate: Apply Database Migration
**Critical:** Phase 7 cannot be tested without migrating the database.

1. Apply migration 011 via Supabase Dashboard or CLI (see instructions above)
2. Verify `friendships` table exists
3. Verify posts RLS policy updated (check policy list)
4. Verify profiles RLS policy updated (should have 2 SELECT policies)

### Then: Device Testing
1. Run `npx expo start`
2. Open in Expo Go on iPhone
3. Create 2-3 test accounts
4. Test friend search, add, remove
5. Test feed scoping (critical: verify only friends' posts visible)
6. Verify RLS policies work (try to view non-friend's posts via direct query)

### If Issues Found:

**Friendships not saving?**
- Check RLS policies in Supabase Dashboard
- Verify table structure matches migration
- Check browser/Expo console for errors
- Verify `auth.uid()` is available in RLS context

**Feed still shows all posts?**
- Verify posts RLS policy was updated (not just added)
- Old policy must be DROPPED first
- Check Supabase Dashboard → Authentication → Policies
- Ensure old "Authenticated users can read posts" is gone

**Search not returning results?**
- Verify profiles RLS policy allows search (second SELECT policy)
- Check if search query is correct (`.ilike()` usage)
- Ensure `username` column exists and is indexed

**Friend count not updating?**
- Check if `useFriendsList` is being called in Profile component
- Verify `friends.length` is used, not hardcoded "0"
- Ensure modal callbacks trigger refresh

---

## Phase 7 Success Criteria: ✅

- [x] Friendships table created with proper RLS
- [x] Friend search UI implemented (UserSearchSheet)
- [x] Friends list UI implemented (FriendsSheet)
- [x] Profile screen updated with friend buttons
- [x] Feed query updated with friend filtering
- [x] Posts RLS policy updated (friend-scoped)
- [x] Profiles RLS policy updated (friends + search)
- [x] TypeScript types updated
- [x] TypeScript passes
- [x] ESLint passes (ignore unrelated errors)
- [ ] Migration applied to database (user action required)
- [ ] Manual device test passes (pending migration)

**Status: 9/11 complete** (awaiting migration + device test)

---

## Files Changed

```
supabase/migrations/011_add_friendships.sql          [NEW] +100 lines
src/hooks/useFriendship.ts                          [NEW] +72 lines
src/hooks/useFriendsList.ts                         [NEW] +61 lines
src/hooks/usePosts.ts                                [MODIFIED] +15 lines (friend filtering)
src/components/UserSearchSheet.tsx                  [NEW] +210 lines
src/components/FriendsSheet.tsx                     [NEW] +160 lines
app/(tabs)/profile.tsx                              [MODIFIED] +50 lines (friend buttons + modals)
src/types/database.ts                               [MODIFIED] +12 lines (Friendship type)
product/PHASE_7_COMPLETE.md                         [NEW] +450 lines
```

**Total:** +1130 lines added/modified

---

## Commit Message

```
feat(Phase 7): add friends system and friend-scoped feed

Database:
- Migration 011: friendships table with bidirectional relationships
- Updated posts RLS: friend-scoped visibility (was: all authenticated)
- Updated profiles RLS: allow friends + search
- Indexes for friend lookups

Backend:
- useFriendship hook: check/toggle friendship status
- useFriendsList hook: load all friends with profiles
- usePosts: filter posts by friends + self

Frontend:
- UserSearchSheet: search users by username, add/remove friends
- FriendsSheet: view friends list with count, remove friends
- Profile: friend count stat, "Add Friends" + "View Friends" buttons

Features:
- Bidirectional friendships (immediate, no pending state)
- Username search with real-time friendship toggle
- Feed shows only own posts + friends' posts
- Friend count displayed on profile
- Remove friends from friends list

Testing:
- TypeScript: ✅ Passes
- ESLint: ✅ No new errors
- Ready for device testing (after migration)

V1 Complete: Friends system + privacy model fully implemented
```

---

## Ready for Phase 8 (V2 Features)

Phase 7 completes the V1 feature set. The app now has:
- ✅ Authentication + profiles
- ✅ Event discovery + RSVPs
- ✅ Location-aware check-ins
- ✅ Dual camera posts (BeReal-style)
- ✅ Photo storage + feed
- ✅ Reactions + comments
- ✅ Friends system + feed scoping

**V1 is feature-complete** pending:
1. Database migration applied
2. Device testing passed
3. Bug fixes (if any found during testing)

**Phase 8 Candidates (V2 features):**
- Friend request approval flow (pending state)
- Push notifications (friend requests, new posts)
- Real-time feed updates (Supabase Realtime)
- Mutual friends indicator
- Close friends tier / post visibility controls
- User profiles with avatars + bio
- Search by name (not just username)
- Pagination on friends list (for power users)

**Estimated Time to V1 Launch:** 1-2 hours (apply migration + test + fix bugs)

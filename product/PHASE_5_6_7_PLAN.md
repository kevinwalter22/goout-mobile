# Phase 5, 6, 7 Implementation Plan

**Goal:** Complete V1 feature set for beta launch
**Timeline:** 3-4 days (1 day per phase + testing)
**Status:** Awaiting approval

---

## Executive Summary

This plan takes the app from "posting works" to "shippable V1" by adding:
- **Phase 5:** BeReal-style photo swap interaction (1 day)
- **Phase 6:** Lightweight reactions + comments (1 day)
- **Phase 7:** Friends system + feed scoping (1-2 days)

All phases are designed to be:
- ✅ Simple to implement (no overengineering)
- ✅ Clear RLS policies
- ✅ Expo Go compatible
- ✅ Independently testable
- ✅ Shippable incrementally

---

## Phase 5: Dual Photo Interaction

**Goal:** Make dual camera posts interactive like BeReal (tap small image to swap)

### Current State
- Dual camera posts display as: main back photo + small front overlay (top-left corner)
- Layout is static, no interaction
- File: [src/components/DualCameraPost.tsx](../src/components/DualCameraPost.tsx)

### What to Build

#### 5.1: Add Tap-to-Swap Interaction
**File:** `src/components/DualCameraPost.tsx`

**Behavior:**
1. User taps the small overlay image
2. Images swap positions with animation
3. Main becomes overlay, overlay becomes main
4. Tap again to swap back

**Implementation:**
```tsx
// State to track which is main
const [isBackMain, setIsBackMain] = useState(true);

// Animated values for smooth transition
const mainOpacity = useSharedValue(1);
const overlayOpacity = useSharedValue(1);

// On tap: toggle state, animate
const handleSwap = () => {
  // Fade out → swap → fade in (200ms total)
  setIsBackMain(!isBackMain);
};

// Render: conditionally show back or front as main
<Pressable onPress={handleSwap}>
  <PostImage photoPath={isBackMain ? backPhotoPath : frontPhotoPath} />
  <View style={overlayStyle}>
    <PostImage photoPath={isBackMain ? frontPhotoPath : backPhotoPath} />
  </View>
</Pressable>
```

**Animation Options:**
- **Simple:** CrossFade (opacity only, 200ms) ✅ Recommended
- **Advanced:** Flip/scale animation (react-native-reanimated)

**Risk:** None (self-contained component)

---

### 5.2: Add Visual Feedback
**Enhancement:** Show tap affordance

**Options:**
1. **Subtle hint:** Small swap icon on overlay (pulse animation on mount)
2. **Haptic feedback:** Trigger vibration on swap (expo-haptics already installed)
3. **Scale animation:** Overlay slightly scales on press

**Recommended:** Haptic feedback only (minimal, clear)

---

### Database Changes
**None required** (purely UI enhancement)

### RLS Policy Changes
**None required**

### Testing Checklist
- [ ] Tap small image → photos swap
- [ ] Tap again → photos swap back
- [ ] Animation is smooth (no flash)
- [ ] Works on both iOS and Android
- [ ] Haptic feedback triggers (if implemented)

### Fallback Plan
If animation is too complex: Skip animation, just toggle instantly (still functional)

---

## Phase 6: Reactions + Comments

**Goal:** Add lightweight engagement (emoji reactions + comments)

### Current State
- Posts display in feed but have no engagement
- Like button exists in mockup but not implemented
- No comment functionality

### What to Build

#### 6.1: Database Schema

**New Tables:**

```sql
-- Reactions (emoji-based, simple)
CREATE TABLE post_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('❤️', '😂', '🔥', '👏', '😮', '😢')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One reaction per user per post
  UNIQUE(post_id, user_id)
);

CREATE INDEX post_reactions_post_id_idx ON post_reactions(post_id);
CREATE INDEX post_reactions_user_id_idx ON post_reactions(user_id);

-- Comments (simple text)
CREATE TABLE post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX post_comments_post_id_idx ON post_comments(post_id);
CREATE INDEX post_comments_created_at_idx ON post_comments(created_at DESC);
```

**Why this design:**
- **Reactions:** One per user (can change emoji, not add multiple)
- **Comments:** Simple, no threading (V1 simplicity)
- **Length:** 500 chars max (Twitter-style)
- **No likes table:** Reactions replace traditional likes

---

#### 6.2: RLS Policies

```sql
-- Reactions RLS
ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;

-- Users can insert/update/delete their own reactions
CREATE POLICY "Users can manage own reactions"
  ON post_reactions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can read all reactions
CREATE POLICY "Authenticated users can read reactions"
  ON post_reactions FOR SELECT
  USING (auth.role() = 'authenticated');

-- Comments RLS
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

-- Users can insert their own comments
CREATE POLICY "Users can create comments"
  ON post_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments"
  ON post_comments FOR DELETE
  USING (auth.uid() = user_id);

-- Authenticated users can read all comments
CREATE POLICY "Authenticated users can read comments"
  ON post_comments FOR SELECT
  USING (auth.role() = 'authenticated');
```

**Why these policies:**
- Users control their own data (reactions/comments)
- All authenticated users can see engagement (matches current posts RLS)
- No update policy for comments (delete + recreate instead)

---

#### 6.3: UI Changes

**Feed Screen Updates** ([app/(tabs)/feed.tsx](../app/(tabs)/feed.tsx))

Add below caption, above separator:

```tsx
{/* Engagement Row */}
<View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
  {/* Reactions */}
  <ReactionBar
    postId={item.id}
    initialReactions={item.reactions} // preloaded
  />

  {/* Comments count */}
  <Pressable onPress={() => openComments(item.id)}>
    <Text style={{ fontSize: 14, opacity: 0.7 }}>
      💬 {item.comment_count || 0}
    </Text>
  </Pressable>
</View>
```

**New Components:**

1. **`src/components/ReactionBar.tsx`**
   - Shows emoji buttons (❤️ 😂 🔥 👏 😮 😢)
   - Highlights user's reaction
   - Shows count next to each emoji
   - Tap to toggle reaction

2. **`src/components/CommentSheet.tsx`**
   - Bottom sheet modal (react-native-bottom-sheet or native Modal)
   - List of comments (username + text + timestamp)
   - Input field at bottom
   - Submit button

**New Hook:**

3. **`src/hooks/usePostEngagement.ts`**
   ```ts
   export function usePostEngagement(postId: string) {
     const [reactions, setReactions] = useState([]);
     const [comments, setComments] = useState([]);
     const [userReaction, setUserReaction] = useState(null);

     // Load reactions + comments
     // Add reaction
     // Remove reaction
     // Add comment
     // Delete comment

     return { reactions, comments, userReaction, ... };
   }
   ```

---

#### 6.4: Feed Query Optimization

**Problem:** Currently load posts, then profiles, then events separately (N+1 queries)

**Solution:** Add reaction/comment counts to feed query

```ts
// Updated query
const { data: postsData } = await supabase
  .from("posts")
  .select(`
    *,
    profile:profiles(id, username),
    event:events(id, title),
    reactions:post_reactions(emoji),
    comment_count:post_comments(count)
  `)
  .order("created_at", { ascending: false });
```

**Benefits:**
- Single query loads everything
- Avoids loading full comment threads (just counts)
- Reactions loaded inline for ReactionBar

---

### Testing Checklist
- [ ] Tap reaction emoji → adds reaction to post
- [ ] Tap same emoji → removes reaction
- [ ] Tap different emoji → changes reaction
- [ ] Reaction counts update in real-time
- [ ] Tap comment count → opens comment sheet
- [ ] Submit comment → appears in list
- [ ] Comments show username + text + timestamp
- [ ] Delete own comment → removes from list

### Risks & Fallbacks

**Risk 1:** Bottom sheet library doesn't work in Expo Go
**Fallback:** Use built-in Modal component (simpler, works everywhere)

**Risk 2:** Real-time updates too complex
**Fallback:** Skip real-time, use pull-to-refresh (acceptable for V1)

**Risk 3:** Comment threading requested by users
**Decision:** Defer to V2 (V1 keeps flat comments)

---

## Phase 7: Friends System + Feed Scoping

**Goal:** Make feed friends-only + fix "Unknown" usernames

### Current State
- Feed shows ALL posts (public)
- No friends system
- Usernames show as "Unknown" sometimes (profile query failing)

### Critical Issues to Fix
1. **Feed is public** (violates core product vision)
2. **Usernames broken** (profile relationship not loading)

---

### 7.1: Database Schema

**New Table:**

```sql
-- Friendships (bidirectional)
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate requests
  UNIQUE(user_id, friend_id),

  -- Prevent self-friending
  CHECK (user_id != friend_id)
);

CREATE INDEX friendships_user_id_idx ON friendships(user_id);
CREATE INDEX friendships_friend_id_idx ON friendships(friend_id);
CREATE INDEX friendships_status_idx ON friendships(status);
```

**Design Decision: Bidirectional rows**

When User A sends request to User B:
- Row 1: `user_id = A, friend_id = B, status = 'pending'`
- Row 2: `user_id = B, friend_id = A, status = 'pending'`

When User B accepts:
- Both rows updated to `status = 'accepted'`

**Why:**
- Simple queries (no need for UNION of user_id/friend_id)
- RLS policies are straightforward
- Status always reflects relationship from user's perspective

**Alternative: Single row per friendship**
- More complex queries (need `WHERE user_id = X OR friend_id = X`)
- Harder RLS policies
- Not recommended for V1

---

### 7.2: RLS Policies

```sql
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- Users can see their own friendships (both directions)
CREATE POLICY "Users can view own friendships"
  ON friendships FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create friend requests (outgoing)
CREATE POLICY "Users can send friend requests"
  ON friendships FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update friend requests they received (to accept/reject)
CREATE POLICY "Users can respond to requests"
  ON friendships FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own friendships (unfriend)
CREATE POLICY "Users can delete own friendships"
  ON friendships FOR DELETE
  USING (auth.uid() = user_id);
```

---

### 7.3: Feed Scoping Query

**Current (broken):**
```ts
// Shows all posts
const { data: postsData } = await supabase
  .from("posts")
  .select("*")
  .order("created_at", { ascending: false });
```

**New (friends-only):**
```ts
// Step 1: Get user's friends (accepted only)
const { data: friendships } = await supabase
  .from("friendships")
  .select("friend_id")
  .eq("user_id", user.id)
  .eq("status", "accepted");

const friendIds = friendships?.map(f => f.friend_id) || [];

// Include user's own posts too
const postAuthorIds = [...friendIds, user.id];

// Step 2: Get posts from friends + self
const { data: postsData } = await supabase
  .from("posts")
  .select(`
    *,
    profile:profiles!inner(id, username),
    event:events(id, title),
    reactions:post_reactions(emoji),
    comment_count:post_comments(count)
  `)
  .in("user_id", postAuthorIds)
  .order("created_at", { ascending: false });
```

**Why `!inner` join:**
- Ensures profile exists (fixes "Unknown" usernames)
- Filters out orphaned posts (user deleted but posts remain)

---

### 7.4: UI Changes

**New Screens:**

1. **`app/friends/index.tsx`** - Friends list
   - Tab: Friends (accepted)
   - Tab: Requests (pending incoming)
   - Shows username, profile photo placeholder
   - "Add Friend" button → search screen

2. **`app/friends/search.tsx`** - Search users
   - Text input: search by username
   - List of results
   - "Send Request" button

3. **`app/friends/[userId].tsx`** - User profile (not own)
   - Username, XP, streak
   - Friend status (not friends / pending / friends)
   - Action button (Add / Accept / Unfriend)

**Profile Tab Updates:**

Add "Friends" button → navigates to friends list

```tsx
<Pressable onPress={() => router.push("/friends")}>
  <View style={statsCard}>
    <Text style={statsNumber}>{friendCount}</Text>
    <Text style={statsLabel}>Friends</Text>
  </View>
</Pressable>
```

**Feed Empty State:**

If no friends yet:
```tsx
<View style={emptyState}>
  <Text>No posts yet</Text>
  <Text>Add friends to see their posts!</Text>
  <Pressable onPress={() => router.push("/friends/search")}>
    <Text>Find Friends</Text>
  </Pressable>
</View>
```

---

### 7.5: Fix "Unknown" Usernames

**Root Cause:** Posts query doesn't ensure profile exists

**Fix:** Use `!inner` join (see 7.3 above)

**Additional:** Add database trigger for profile auto-creation

```sql
-- Ensure profile is created when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
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
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

---

### Testing Checklist
- [ ] Sign up → profile created automatically
- [ ] Search user by username → results appear
- [ ] Send friend request → appears in recipient's requests
- [ ] Accept request → both users become friends
- [ ] Reject request → request disappears
- [ ] Unfriend → removes friendship bidirectionally
- [ ] Feed shows only friends' posts (+ own posts)
- [ ] Feed shows correct usernames (no "Unknown")
- [ ] If no friends → empty state with "Add Friends" CTA

### Risks & Fallbacks

**Risk 1:** Bidirectional friendship rows cause confusion
**Mitigation:** Helper function to manage both rows atomically
**Fallback:** Switch to single-row model (1 day refactor)

**Risk 2:** Friend search is slow (no indexing)
**Mitigation:** Add GIN index on username for ILIKE queries
**Fallback:** Exact match only (no fuzzy search)

**Risk 3:** Feed query is slow with friends filter
**Mitigation:** Index on friendships.user_id + status
**Fallback:** Cache friend IDs in client state

---

## Phased Rollout Strategy

### Checkpoint 1: Phase 5 Complete
**Deliverables:**
- Dual photo tap-to-swap works
- Haptic feedback on swap
- No database changes

**Verification:**
- Manual test on device
- Record video of swap animation

**Decision Point:** If animation is janky, ship without animation (instant toggle)

---

### Checkpoint 2: Phase 6 Complete
**Deliverables:**
- Reactions work (add/remove/change emoji)
- Comments work (add/view/delete)
- Feed shows engagement counts

**Verification:**
- Test with 2 user accounts
- Verify RLS policies (user A can't delete user B's comment)

**Decision Point:** If bottom sheet is buggy, use full-screen modal instead

---

### Checkpoint 3: Phase 7 Complete
**Deliverables:**
- Friends system works (request/accept/reject/unfriend)
- Feed shows only friends' posts
- Usernames display correctly

**Verification:**
- Test with 3 user accounts (A, B, C)
- A adds B → B accepts → A sees B's posts
- A doesn't see C's posts (not friends)
- All usernames correct

**Decision Point:** If friends query is slow, add caching layer

---

## Migration Files

### Migration 010: Add Reactions + Comments
```sql
-- File: supabase/migrations/010_add_reactions_comments.sql
-- (See Phase 6.1 schema above)
```

### Migration 011: Add Friendships
```sql
-- File: supabase/migrations/011_add_friendships.sql
-- (See Phase 7.1 schema above)
```

### Migration 012: Add Profile Trigger
```sql
-- File: supabase/migrations/012_profile_auto_creation.sql
-- (See Phase 7.5 trigger above)
```

---

## Database Indexes Summary

**New indexes needed:**

```sql
-- Reactions
CREATE INDEX post_reactions_post_id_idx ON post_reactions(post_id);
CREATE INDEX post_reactions_user_id_idx ON post_reactions(user_id);

-- Comments
CREATE INDEX post_comments_post_id_idx ON post_comments(post_id);
CREATE INDEX post_comments_created_at_idx ON post_comments(created_at DESC);

-- Friendships
CREATE INDEX friendships_user_id_idx ON friendships(user_id);
CREATE INDEX friendships_friend_id_idx ON friendships(friend_id);
CREATE INDEX friendships_status_idx ON friendships(status);
CREATE INDEX friendships_user_status_idx ON friendships(user_id, status); -- composite

-- Username search
CREATE INDEX profiles_username_idx ON profiles(username);
CREATE INDEX profiles_username_pattern_idx ON profiles USING gin(username gin_trgm_ops); -- optional: fuzzy search
```

---

## TypeScript Types

### New types for database.ts

```ts
export type PostReaction = {
  id: string;
  post_id: string;
  user_id: string;
  emoji: "❤️" | "😂" | "🔥" | "👏" | "😮" | "😢";
  created_at: string;
};

export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

export type Friendship = {
  id: string;
  user_id: string;
  friend_id: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  updated_at: string;
};

// Add to Database type
export type Database = {
  public: {
    Tables: {
      // ... existing tables
      post_reactions: {
        Row: PostReaction;
        Insert: Omit<PostReaction, "id" | "created_at">;
        Update: never;
      };
      post_comments: {
        Row: PostComment;
        Insert: Omit<PostComment, "id" | "created_at">;
        Update: never;
      };
      friendships: {
        Row: Friendship;
        Insert: Omit<Friendship, "id" | "created_at" | "updated_at">;
        Update: Partial<Pick<Friendship, "status">>;
      };
    };
  };
};
```

---

## Risk Matrix

| Phase | Risk | Severity | Mitigation | Fallback |
|-------|------|----------|------------|----------|
| 5 | Animation performance poor | Low | Use simple crossfade only | Skip animation, instant toggle |
| 6 | Bottom sheet doesn't work in Expo Go | Medium | Test early, use Modal if needed | Full-screen modal |
| 6 | Real-time updates complex | Low | Start without real-time | Pull-to-refresh only (acceptable) |
| 7 | Bidirectional friendships confusing | Medium | Document clearly, add helper functions | Refactor to single-row (1 day) |
| 7 | Feed query slow with friends | Medium | Add composite indexes | Cache friend IDs client-side |
| 7 | Username search slow | Low | Add GIN index | Exact match only |

**Overall Risk Level:** Low-Medium (all have clear fallbacks)

---

## Effort Estimates

### Phase 5: Dual Photo Interaction
- Component changes: 2 hours
- Animation implementation: 2 hours
- Testing: 1 hour
- **Total: 5 hours (0.5 days)**

### Phase 6: Reactions + Comments
- Database migration: 1 hour
- RLS policies: 1 hour
- ReactionBar component: 3 hours
- CommentSheet component: 3 hours
- Feed integration: 2 hours
- Hook implementation: 2 hours
- Testing: 2 hours
- **Total: 14 hours (1.5 days)**

### Phase 7: Friends System
- Database migration: 1 hour
- RLS policies: 1 hour
- Profile trigger: 0.5 hours
- Friends screens (list/search/profile): 4 hours
- Feed query refactor: 2 hours
- Helper functions: 2 hours
- Testing: 2 hours
- **Total: 12.5 hours (1.5 days)**

### Buffer: Testing + Fixes
- End-to-end testing: 4 hours
- Bug fixes: 4 hours
- **Total: 8 hours (1 day)**

**Grand Total: 39.5 hours (4-5 days)**

---

## Success Criteria

### Phase 5 Success
- [ ] Dual camera posts are tappable
- [ ] Photos swap on tap
- [ ] Animation is smooth (or instant if fallback)
- [ ] Works on iOS Expo Go

### Phase 6 Success
- [ ] Users can add reactions to posts
- [ ] Users can write comments on posts
- [ ] Engagement counts show in feed
- [ ] Users can only delete their own comments
- [ ] RLS policies enforce ownership

### Phase 7 Success
- [ ] Users can search and add friends
- [ ] Friend requests work (send/accept/reject)
- [ ] Feed shows only friends' posts + own posts
- [ ] Usernames display correctly (no "Unknown")
- [ ] Empty state shows when no friends

### V1 Launch Ready
- [ ] All 3 phases pass manual testing
- [ ] No TypeScript errors
- [ ] No ESLint errors
- [ ] Performance is acceptable (feed loads < 2s)
- [ ] App doesn't crash on basic flows

---

## Post-Phase 7 Cleanup

**Before V1 Launch:**

1. Remove test data from database
2. Verify all RLS policies work (test with 3 accounts)
3. Test location verification at real venue
4. Add profile photos (if time permits)
5. Polish empty states
6. Add loading skeletons (if time permits)

**Defer to V2:**

1. Comment threading / replies
2. Push notifications
3. "Friends of friends" suggestions
4. Activity feed (who liked/commented)
5. Profile photo upload
6. Advanced search filters

---

## Approval Checklist

Before implementing, confirm:

- [ ] Phase 5 approach is acceptable (tap-to-swap)
- [ ] Phase 6 schema is correct (reactions + comments)
- [ ] Phase 7 bidirectional friendships approach is OK
- [ ] RLS policies are secure
- [ ] Timeline is realistic (4-5 days)
- [ ] Fallback plans are acceptable
- [ ] Success criteria are clear

---

## Questions for Product Owner

1. **Phase 5:** Do you want fancy animation (scale/flip) or simple crossfade?
2. **Phase 6:** Should reactions be limited (one per user) or unlimited (multiple emojis)?
3. **Phase 6:** Comment length limit OK at 500 chars?
4. **Phase 7:** Bidirectional friendships vs single-row? (Recommendation: bidirectional)
5. **Phase 7:** Should rejected friend requests be deletable or hidden?
6. **Testing:** Do you want to test each phase separately or all together at the end?

---

## Ready to Implement

This plan is:
- ✅ Realistic (4-5 days)
- ✅ Shippable (each phase adds value)
- ✅ Low risk (clear fallbacks)
- ✅ Well-scoped (no overengineering)
- ✅ Testable (clear checkpoints)

**Awaiting approval to proceed.**

# Phase 2 Implementation Complete

## What Changed

### New Files Created

1. **Database Migration**
   - [supabase/migrations/002_create_event_rsvps.sql](supabase/migrations/002_create_event_rsvps.sql) - RSVP table + RLS

2. **Event Detail Screen**
   - [app/event/[id].tsx](app/event/[id].tsx) - Event detail screen with RSVP button

3. **Hooks**
   - [src/hooks/useEventRSVP.ts](src/hooks/useEventRSVP.ts) - Hook for RSVP state management

### Modified Files

1. [src/types/database.ts](src/types/database.ts) - Added Event and EventRSVP types
2. [app/(tabs)/explore.tsx](app/(tabs)/explore.tsx) - Enhanced with RSVP counts and status badges

---

## SQL Migration

Run this in **Supabase SQL Editor**:

```sql
-- Create event_rsvps table
CREATE TABLE event_rsvps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

-- Enable RLS
ALTER TABLE event_rsvps ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Anyone authenticated can read RSVPs (to see who's going)
CREATE POLICY "Authenticated users can read RSVPs"
  ON event_rsvps FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can insert their own RSVPs
CREATE POLICY "Users can create own RSVP"
  ON event_rsvps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own RSVPs
CREATE POLICY "Users can delete own RSVP"
  ON event_rsvps FOR DELETE
  USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX event_rsvps_event_id_idx ON event_rsvps(event_id);
CREATE INDEX event_rsvps_user_id_idx ON event_rsvps(user_id);
```

---

## Features Implemented

### 1. Event Detail Screen

**Route:** `/event/[id]`

**Shows:**
- Event title and category
- Date/time formatted nicely
- Venue and city
- Number of people going
- "I'm Going" button (toggles on/off)

**Behavior:**
- Button changes appearance when user has RSVPed (checkmark + outlined style)
- Count updates immediately when toggling
- Loading states for both initial load and RSVP actions

### 2. Enhanced Explore List

**Shows for each event:**
- All existing event info (title, time, venue, category)
- "✓ I'm Going" badge if user has RSVPed
- "X people going" count if anyone has RSVPed
- Both badges show in footer section with separator line

**Behavior:**
- Tappable cards navigate to event detail screen
- RSVP status refreshes when user returns from detail screen
- Counts update based on all users' RSVPs

### 3. RSVP System

**Database:**
- `event_rsvps` table with user_id + event_id
- Unique constraint prevents duplicate RSVPs
- Cascade deletes if user or event deleted

**RLS Policies:**
- All authenticated users can read RSVPs (public going count)
- Users can only create/delete their own RSVPs
- No update policy (RSVP is binary: going or not)

---

## Test Checklist (iPhone)

### Setup
- [ ] Run SQL migration in Supabase
- [ ] Start app: `npm start` then press `i` for iOS
- [ ] Sign in with existing account (or create new one)

### Test: Browse Events in Explore
- [ ] Open Explore tab
- [ ] Events load successfully
- [ ] Events show date, venue, category
- [ ] No RSVP badges shown initially (fresh account)

### Test: RSVP from Detail Screen
- [ ] Tap any event card
- [ ] Detail screen opens with event info
- [ ] "I'm Going" button visible (not checked)
- [ ] Count shows "0 people"
- [ ] Tap "I'm Going" button
- [ ] Button changes to "✓ I'm Going" (outlined style)
- [ ] Count updates to "1 person"
- [ ] Tap button again to un-RSVP
- [ ] Button changes back to solid black "I'm Going"
- [ ] Count returns to "0 people"

### Test: RSVP Status in Explore List
- [ ] Navigate back to Explore tab
- [ ] Event you RSVPed to shows "✓ I'm Going" badge
- [ ] Event shows "1 person going" count
- [ ] Tap event again
- [ ] Detail screen still shows you're going
- [ ] Un-RSVP from detail screen
- [ ] Return to Explore
- [ ] Badge and count removed from event card

### Test: Multiple Events
- [ ] RSVP to 3 different events
- [ ] All 3 show badges in Explore list
- [ ] Each shows correct count (at least 1)
- [ ] Navigate to each detail screen
- [ ] Each shows correct RSVP status

### Test: Multi-User (if possible)
- [ ] Sign out and create second account
- [ ] Navigate to same event as first user
- [ ] Count shows "1 person" (from first user)
- [ ] Tap "I'm Going"
- [ ] Count updates to "2 people"
- [ ] Check Explore list shows "2 people going"

### Test: Error Cases
- [ ] Turn off WiFi/data
- [ ] Try to RSVP to event
- [ ] App should handle gracefully (no crash)
- [ ] Turn on connection
- [ ] RSVP should work again

---

## File Structure After Phase 2

```
app/
├── (auth)/
│   ├── signin.tsx
│   └── signup.tsx
├── (tabs)/
│   ├── _layout.tsx
│   ├── feed.tsx
│   ├── explore.tsx ← Updated with RSVP UI
│   └── profile.tsx
├── event/
│   └── [id].tsx ← New: Event detail screen
├── _layout.tsx
└── index.tsx

src/
├── contexts/
│   └── AuthContext.tsx
├── hooks/
│   ├── useAuth.ts
│   └── useEventRSVP.ts ← New: RSVP hook
├── lib/
│   └── supabase.ts
└── types/
    └── database.ts ← Updated with Event & EventRSVP types

supabase/migrations/
├── 001_create_profiles.sql
└── 002_create_event_rsvps.sql ← New migration
```

---

## Environment Variables

No new env vars needed. Same as Phase 1:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

---

## V1 Scope Compliance

✅ Event detail screen accessible from Explore
✅ "I'm going" RSVP functionality
✅ event_rsvps table with RLS
✅ Explore list shows "I'm going" status
✅ Explore list shows going count
❌ No V2 features added

---

## Next Steps (Phase 3 - Soul Feature)

Phase 3 will add:
- Location permissions
- Distance-based check-in gate
- Camera-only post flow (front/back/dual)
- Photo storage in Supabase
- Feed showing friends' posts

---

## Performance Notes

**RSVP Count Loading:**
The current implementation loads RSVP counts for each event individually. For a small number of events (< 50), this is fine. For production at scale, consider:
- Adding a `rsvp_count` column to events table
- Using a database function to aggregate counts
- Implementing materialized views

**Current Approach:** Simple and correct for V1, optimized for clarity.

---

## Troubleshooting

### "Cannot read property 'id' of undefined"
- Make sure you're signed in
- Check auth context is working

### RSVP not showing immediately
- Pull down to refresh in Explore tab
- Navigate away and back to force reload

### "Relation does not exist"
- Run the Phase 2 SQL migration in Supabase
- Verify migration completed successfully

### TypeScript errors about router.push
- The `as any` type assertions are intentional for dynamic routes
- Will be resolved when Expo Router regenerates typed routes

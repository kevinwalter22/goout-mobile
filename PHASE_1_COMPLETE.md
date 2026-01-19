# Phase 1 Implementation Complete

## What Changed

### New Files Created

1. **Auth Infrastructure**
   - [src/types/database.ts](src/types/database.ts) - TypeScript types for database tables
   - [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) - Auth context provider
   - [src/hooks/useAuth.ts](src/hooks/useAuth.ts) - Hook to access auth state
   - [src/lib/supabase.ts](src/lib/supabase.ts) - Updated with secure storage

2. **Auth Screens**
   - [app/(auth)/signin.tsx](app/(auth)/signin.tsx) - Sign-in screen
   - [app/(auth)/signup.tsx](app/(auth)/signup.tsx) - Sign-up screen

3. **Tab Screens**
   - [app/(tabs)/_layout.tsx](app/(tabs)/_layout.tsx) - 3-tab navigation layout
   - [app/(tabs)/feed.tsx](app/(tabs)/feed.tsx) - Feed placeholder
   - [app/(tabs)/explore.tsx](app/(tabs)/explore.tsx) - Explore events
   - [app/(tabs)/profile.tsx](app/(tabs)/profile.tsx) - Profile with sign-out

4. **Database Migration**
   - [supabase/migrations/001_create_profiles.sql](supabase/migrations/001_create_profiles.sql) - Profiles table + RLS

### Modified Files

1. [app/_layout.tsx](app/_layout.tsx) - Wrapped with AuthProvider
2. [app/index.tsx](app/index.tsx) - Auth-aware routing logic
3. [package.json](package.json) - Added auth storage dependencies

### Old Files (Can be deleted)

- [app/events.tsx](app/events.tsx) - Replaced by explore tab

---

## How to Run/Test

### Step 1: Run SQL Migration in Supabase

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Copy and paste the entire contents of [supabase/migrations/001_create_profiles.sql](supabase/migrations/001_create_profiles.sql)
4. Click **Run**
5. Verify success (should see "Success. No rows returned")

### Step 2: Verify Environment Variables

Your `.env` file should have:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Step 3: Start the App

```bash
npm start
```

Then press `i` for iOS simulator or scan QR code with Expo Go

### Step 4: Test the Flow

1. **Sign Up**
   - Open app → redirects to sign-in
   - Tap "Sign Up"
   - Enter username, email, password
   - Submit → check email for verification link
   - Click verification link
   - Return to app

2. **Sign In**
   - Enter email and password
   - Sign in → should redirect to Feed tab

3. **Profile Tab**
   - Tap Profile tab
   - Should see: username, XP (0), Streak (0), Friends (0)
   - Tap "Sign Out" → redirects to sign-in

4. **Explore Tab**
   - Should show existing events from your database

---

## SQL Migration Details

The migration creates:

### Tables

**profiles**
- `id` (UUID, primary key, references auth.users)
- `username` (TEXT, unique, 3-30 chars, alphanumeric + underscore)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)
- `xp` (INTEGER, default 0)
- `streak` (INTEGER, default 0)

### RLS Policies

- **Read own profile**: Users can only read their own profile (`auth.uid() = id`)
- **Update own profile**: Users can only update their own profile
- **Insert own profile**: Users can insert their own profile on signup

### Triggers

1. **on_auth_user_created**: Automatically creates a profile row when a user signs up
   - Uses username from signup metadata
   - Falls back to `user_<uuid-prefix>` if no username provided

2. **on_profile_updated**: Automatically updates `updated_at` timestamp

---

## Environment Variables Required

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Get these from:
- Supabase Dashboard → Settings → API
- URL: Project URL
- Key: anon/public key

---

## Architecture Notes

### Auth Flow

1. User opens app → [app/index.tsx](app/index.tsx) checks auth state
2. If authenticated → redirect to `/(tabs)/feed`
3. If not authenticated → redirect to `/(auth)/signin`

### Storage

- iOS/Native: `expo-secure-store` (secure keychain storage)
- Web: `AsyncStorage` (localStorage fallback)

### Profile Creation

Profiles are created automatically via database trigger when:
- User signs up with `supabase.auth.signUp()`
- Username is taken from `options.data.username` in signup call
- Profile row is inserted immediately after auth.users row

---

## V1 Scope Compliance

✅ Email/password auth (Supabase Auth)
✅ Profiles table with RLS
✅ Auto-create profile on signup
✅ Profile tab with username, XP, streak, friends placeholders
✅ Sign-out button
✅ 3-tab navigation (Feed, Explore, Profile)
❌ No V2 features added

---

## Next Steps (Phase 2)

Phase 2 will add:
- Event/activity detail screens
- "I'm going" RSVP functionality
- Combined events + activities in Explore tab

---

## Troubleshooting

### "Cannot read property 'replace' of undefined"
- Make sure AuthProvider is wrapping the entire app in [app/_layout.tsx](app/_layout.tsx)

### "Profile not found"
- Run the SQL migration in Supabase
- Check that trigger was created successfully
- Try signing up a new user

### "Session not persisting"
- Make sure `expo-secure-store` and `@react-native-async-storage/async-storage` are installed
- Restart the app/dev server after installing

### TypeScript errors about routes
- The `as any` type assertions are intentional for new routes not yet in typed routes
- Run `npx expo start --clear` to regenerate types

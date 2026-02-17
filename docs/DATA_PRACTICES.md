# Data Practices — Internal Reference

Technical documentation of exactly what data Euda collects, why, how it's stored, and user rights. This document is intended for internal use, App Store questionnaire answers, and privacy review.

---

## 1. Data Collected

### 1.1 Account Data

| Field | Storage | Purpose | PII? |
|---|---|---|---|
| Email | `auth.users` (Supabase Auth) | Authentication, account recovery | Yes |
| Password | `auth.users` (bcrypt hash) | Authentication | Yes (hashed) |
| Username | `profiles.username` | Display name in social features | Yes |
| Avatar | `avatars` storage bucket | Profile photo | Yes |
| Bio | `profiles.bio` | Optional self-description | Yes |
| XP / Streak | `profiles.xp`, `profiles.streak` | Gamification progression | No |
| Phone number | `profiles.phone_number` (optional) | Friend discovery via contacts sync | Yes |
| Phone hash | `profiles.phone_hash` (SHA-256) | Contact matching without exposing raw number | Yes (hashed) |
| Admin flag | `profiles.is_admin` | Admin access control | No |

### 1.2 User-Generated Content

| Field | Storage | Purpose | PII? |
|---|---|---|---|
| Post photos | `posts` storage bucket (`{userId}/{postId}-back.jpg`, `-front.jpg`) | Social feed content | Yes (may contain faces) |
| Post captions | `posts.caption` (max 100 chars) | User-written text on posts | Potentially |
| Post reactions | `post_reactions` table | Social engagement (6 emoji types) | No |
| Post comments | `post_comments.content` | User-written text on others' posts | Potentially |
| Camera mode | `posts.camera_mode` | Record which camera mode was used | No |

### 1.3 Social Graph

| Field | Storage | Purpose | PII? |
|---|---|---|---|
| Friendships | `friendships` table (user_id, friend_id, status) | Friend connections (pending/accepted/declined) | No (user IDs only) |
| RSVPs | `explore_item_rsvps` table | "I'm Going" status on events | No |

### 1.4 Behavioral / Analytics Data

| Table | Fields | Purpose | PII? |
|---|---|---|---|
| `user_item_events` | user_id, explore_item_id, event_type, metadata, timestamp | Track explore item interactions (open, rsvp, share, post) | No |
| `analytics_events` | user_id, event_name, metadata, timestamp | App-level KPIs (signup, explore_open, post_started, contacts_sync) | No |
| `user_type_affinity` | user_id, events_engaged, activities_engaged, bias scores | Personalize explore feed (events vs. activities preference) | No |
| `user_tag_affinity` | user_id, tag, score, interaction_count | Personalize explore feed (category preferences) | No |

### 1.5 Data NOT Collected

| Data type | Status | Notes |
|---|---|---|
| Device location | **Not stored** | Used client-side only for real-time check-in radius verification; posts store `latitude: null, longitude: null` |
| Raw contact data | **Not transmitted** | Only SHA-256 hashes sent; raw numbers stay on device |
| Device identifiers | **Not collected** | No UDID, IMEI, IDFA, or hardware IDs |
| IP addresses | **Scrubbed** | Sentry strips IP before sending; Supabase logs may contain IPs per their policy |
| Audio / video | **Not collected** | Camera captures still photos only |
| Health / biometric data | **Not collected** | |
| Advertising identifiers | **Not collected** | No ad SDKs integrated |
| Browsing history | **Not collected** | |
| Precise location history | **Not stored** | |

---

## 2. Why We Collect Each Category

| Category | Legal basis / justification | Can user opt out? |
|---|---|---|
| Email + password | Required for account creation and login | No (required to use App) |
| Username + avatar + bio | Required for social features | Username required; avatar and bio optional |
| Phone number | Optional, for friend discovery | Yes, entirely optional |
| Posts + photos | Core App feature (check-in sharing) | Yes, user can choose not to post |
| Social interactions | Core App feature (reactions, comments, RSVPs) | Yes, user can choose not to interact |
| Behavioral data | Improve recommendations in Explore feed | No explicit opt-out; deleted with account |
| Analytics events | Understand App usage and improve product | No explicit opt-out; deleted with account |
| Crash reports | Fix bugs and improve stability | Disabled in dev builds; enabled in production |

---

## 3. Third-Party Data Processors

### Infrastructure

| Service | Role | Data access | DPA needed? |
|---|---|---|---|
| **Supabase** (AWS) | Database, auth, storage | All user data | Yes |
| **Apple App Store** | iOS distribution | Standard app metadata | Standard EULA |
| **Google Play Store** | Android distribution | Standard app metadata | Standard EULA |

### Crash Reporting

| Service | Role | Data received | PII scrubbing |
|---|---|---|---|
| **Sentry** | Error monitoring | Crash stack traces, device model, OS version, anonymous user ID | `sendDefaultPii: false`; IP addresses removed; auth tokens, phone numbers, emails, passwords stripped via `beforeSend` hook |

### Content Enrichment (server-side only, no user data sent)

| Service | Role | Data sent | User data? |
|---|---|---|---|
| **Google Places API** | Discover local activities | Region coordinates, place types, place IDs | **None** |
| **Ticketmaster API** | Discover local events | Region coordinates, date ranges | **None** |
| **Anthropic Claude API** | Enrich event descriptions/tags | Raw event text (titles, descriptions) | **None** |
| **OpenAI API** (fallback) | Enrich event descriptions/tags | Raw event text | **None** |

These services receive **only venue/event data**, never user information. All calls are server-to-server from Supabase Edge Functions.

---

## 4. Retention Strategy

| Data | Retained until | Deletion trigger |
|---|---|---|
| Account data (email, profile) | Account deletion | User deletes account in Settings |
| Posts + photos | User deletes post, or account deletion | Manual post deletion or account deletion |
| Friendships | Account deletion | Cascade when either user deletes account |
| RSVPs | Account deletion | Cascade on account deletion |
| Behavioral data | Account deletion | Cascade on account deletion |
| Analytics events | Account deletion | Cascade on account deletion |
| Crash reports (Sentry) | ~90 days | Sentry's default retention policy |
| Session tokens (on-device) | Logout or app uninstall | `signOut()` clears tokens; OS clears on uninstall |
| Image URL cache (in-memory) | App session | Cleared on logout via `clearExpiredUrlCache()` |

**No indefinite retention**: All user data is deleted when the user deletes their account. There is no separate archival or backup retention beyond Supabase's infrastructure-level backups.

---

## 5. User Rights

### Delete Account
- **Where**: Settings > Delete Account
- **How**: Two-step confirmation dialog, then calls `delete-account` Edge Function
- **What happens server-side**:
  1. User's JWT is verified
  2. All files in `posts` and `avatars` storage buckets for that user are deleted
  3. `auth.admin.deleteUser()` is called, which cascades to all database tables via `ON DELETE CASCADE` foreign keys
- **What's deleted**: profiles, posts, post_reactions, post_comments, friendships, explore_item_rsvps, event_rsvps, user_item_events, user_type_affinity, user_tag_affinity, analytics_events, and all storage files
- **Irreversible**: Yes, no recovery possible after deletion

### Delete Individual Posts
- Users can delete their own posts from the feed
- Cascades to reactions and comments on that post
- Photos removed from storage

### Manage Device Permissions
- Camera, location, and contacts permissions can be revoked at any time in device Settings
- App functions with reduced capability when permissions are revoked

### Data Export
- Not yet implemented in-app
- Available by request to support@euda.app

---

## 6. Contacts Sync — Technical Detail

This section provides the precise technical flow for App Store privacy questionnaires.

### What happens

1. User taps "Find Friends from Contacts" in Settings
2. App requests device contacts permission (if not already granted)
3. App reads **phone numbers only** via `expo-contacts` (field: `PhoneNumbers`)
   - Does NOT read: names, emails, addresses, photos, notes, or any other fields
4. On-device processing:
   - Each number is normalized to E.164 format (e.g., `+14155551234`)
   - Each normalized number is hashed: `SHA-256(salt + normalizedNumber)`
   - Salt: loaded from `EXPO_PUBLIC_PHONE_HASH_SALT` env var (server-side: `ALTER DATABASE ... SET app.phone_hash_salt`)
5. Only the hash array is sent to the server via RPC: `match_contacts(p_user_id, p_hashed_phones)`
6. Server compares against `profiles.phone_hash` column
7. Returns matching user profiles (user_id, username, avatar_url)
8. Hashes are **not stored** on the server after comparison

### What is stored on the server

Only if the user **voluntarily adds their own phone number** in Settings > Phone Number:
- `profiles.phone_number`: their own number in E.164 format
- `profiles.phone_hash`: SHA-256 hash of their own number (for matching)
- `profiles.phone_verified_at`: timestamp

Other users' contact hashes are **never stored**.

### Privacy properties
- One-way hash: SHA-256 cannot be reversed to recover the phone number
- Salted: prevents rainbow table attacks
- Minimal data: only phone numbers read from contacts, no names or other fields
- Ephemeral: hashes sent for matching are not persisted

---

## 7. Location Data — Technical Detail

### Check-in verification flow

1. User taps "Check In & Post" on an event/activity detail page
2. App requests foreground location permission (if not already granted)
3. App calls `Location.getCurrentPositionAsync()` (Expo Location, Balanced accuracy)
4. **Client-side calculation only**:
   - Haversine distance computed between device coordinates and event coordinates
   - Compared against `CHECK_IN_RADIUS_METERS = 200` (0.124 miles)
5. If within radius: user proceeds to camera flow
6. If outside radius: error shown, check-in denied

### What's NOT sent to the server
- Device GPS coordinates are **never transmitted** to the backend
- Posts are created with `latitude: null, longitude: null`
- No location history is maintained

### Explore feed distance sorting
- Device location fetched client-side every 30 seconds (when Explore tab is open)
- Distance to explore items calculated client-side for sorting
- Coordinates **not sent** to the server; the query returns all items and sorting happens locally

---

## 8. App Store Privacy Questionnaire Reference

For Apple's App Privacy section and Google's Data Safety form:

| Data type (Apple categories) | Collected? | Linked to identity? | Used for tracking? |
|---|---|---|---|
| Contact Info — Email | Yes | Yes | No |
| Contact Info — Phone Number | Optional | Yes | No |
| User Content — Photos | Yes | Yes | No |
| User Content — Other (captions, comments) | Yes | Yes | No |
| Identifiers — User ID | Yes | Yes | No |
| Usage Data — Product Interaction | Yes | Yes | No |
| Diagnostics — Crash Data | Yes | Yes (anonymous ID) | No |
| Location — Precise Location | **No** (not collected/stored) | N/A | No |
| Contacts — Contacts | **No** (hashed only, not stored) | N/A | No |

**Tracking**: Euda does **not** track users across other companies' apps or websites. No advertising identifiers are collected. No data is shared with data brokers.

---

## 9. Security Measures

| Layer | Implementation |
|---|---|
| Authentication | Supabase Auth (bcrypt password hashing, JWT tokens) |
| Session storage | iOS Keychain / Android Keystore (encrypted); AsyncStorage on web |
| Database access | Row-Level Security (RLS) on all tables; users can only access their own data |
| API security | JWT validation on all endpoints; service_role key for server-only operations |
| PII scrubbing | Sentry `beforeSend` strips sensitive keys; `sendDefaultPii: false` |
| Phone hashing | SHA-256 with application salt; on-device before transmission |
| Storage | Supabase (AWS infrastructure); TLS in transit |
| Edge Functions | Supabase Deno runtime; environment variables for secrets |

---

*This document reflects the implemented system as of February 2026. Update it when data collection practices change.*

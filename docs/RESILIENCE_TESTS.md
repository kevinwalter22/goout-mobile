# Resilience Test Checklist

Manual tests that verify Euda handles network failures, slow connections, and
backend outages gracefully. Uses the dev-only **Network Simulator** in
Settings > Developer.

> **Prerequisite**: Run a dev build (`npx expo start`). The Network Simulator
> section appears at the bottom of the Developer panel in Settings.

---

## How to Use the Network Simulator

| Toggle        | Behavior                                               |
| ------------- | ------------------------------------------------------ |
| Force Offline | All Supabase requests reject (`Network request failed`) |
| Slow Network  | Adds 2000ms latency to every Supabase request          |
| Backend Down  | All Supabase requests return HTTP 503                  |

A colored banner appears at the top of the screen while any mode is active.
Toggles are mutually exclusive. Turn the toggle **off** when done with each test.

For non-Supabase network calls (weather API, address autocomplete), use your
device's **Airplane Mode** instead.

---

## 1. Explore Screen

### 1.1 Offline -- initial load

- **Precondition**: Force-quit and relaunch the app with "Force Offline" ON.
- **Steps**: Navigate to the Explore tab.
- **Expected**: Loading spinner appears briefly, then "Failed to load events"
  error message with a **Retry** button. No crash.
- [ ] Pass

### 1.2 Offline -- retry after recovery

- **Precondition**: Error state from test 1.1 is visible.
- **Steps**: Turn "Force Offline" OFF, then tap **Retry**.
- **Expected**: Loading spinner appears, then events load normally.
- [ ] Pass

### 1.3 Offline -- pull to refresh with cached data

- **Precondition**: Explore has loaded data. Turn "Force Offline" ON.
- **Steps**: Pull down to refresh.
- **Expected**: Refresh spinner appears, then stops. Existing data remains
  visible. An error may appear as a toast or inline message, but the app does
  not crash and existing cards are preserved.
- [ ] Pass

### 1.4 Slow network -- loading indicator

- **Precondition**: Turn "Slow Network" ON.
- **Steps**: Pull to refresh or change the kind toggle (All/Activities/Events).
- **Expected**: Loading spinner is visible for ~2 seconds before data appears.
  No timeout errors. UI remains responsive (scrolling, tapping tabs).
- [ ] Pass

### 1.5 Backend down -- error display

- **Precondition**: Turn "Backend Down" ON.
- **Steps**: Pull to refresh.
- **Expected**: Error state shown (similar to offline). The error message should
  reference a network or server issue, not display raw JSON.
- [ ] Pass

### 1.6 Infinite scroll under latency

- **Precondition**: Turn "Slow Network" ON. Load explore with data visible.
- **Steps**: Scroll to the bottom to trigger pagination.
- **Expected**: Footer spinner appears for ~2s, then more items load. No
  duplicate items. No crash.
- [ ] Pass

---

## 2. Feed Screen

### 2.1 Offline -- initial load

- **Precondition**: "Force Offline" ON. Navigate to Feed.
- **Steps**: Observe the screen.
- **Expected**: "Failed to load feed" message with **Retry** button. No crash.
- [ ] Pass

### 2.2 Offline -- retry

- **Precondition**: Error state from 2.1 visible. Turn "Force Offline" OFF.
- **Steps**: Tap **Retry**.
- **Expected**: Feed loads successfully.
- [ ] Pass

### 2.3 Slow network -- pull to refresh

- **Precondition**: Feed loaded. "Slow Network" ON.
- **Steps**: Pull to refresh.
- **Expected**: Refresh control spinner visible for ~2s. Feed updates without
  flickering or losing scroll position.
- [ ] Pass

### 2.4 Backend down -- existing data preservation

- **Precondition**: Feed loaded with posts. "Backend Down" ON.
- **Steps**: Pull to refresh.
- **Expected**: Existing posts remain visible. Error indication appears. No
  blank screen.
- [ ] Pass

---

## 3. Profile Screen

### 3.1 Offline -- profile data

- **Precondition**: "Force Offline" ON.
- **Steps**: Navigate to Profile tab.
- **Expected**: Profile may show cached data from AuthContext. Posts grid shows
  loading or error. The screen does not crash.
- [ ] Pass

### 3.2 Offline -- avatar upload

- **Precondition**: "Force Offline" ON.
- **Steps**: Tap avatar, pick a photo, attempt upload.
- **Expected**: Error alert ("Failed to upload" or similar). Avatar remains
  unchanged. No crash.
- [ ] Pass

### 3.3 Offline -- bio save

- **Precondition**: "Force Offline" ON.
- **Steps**: Navigate to Edit Profile, change bio, tap save.
- **Expected**: Error shown. Bio reverts to previous value. No crash.
- [ ] Pass

### 3.4 Offline -- friend requests

- **Precondition**: "Force Offline" ON.
- **Steps**: Open Friend Requests sheet.
- **Expected**: Error state or empty state with appropriate message. No crash.
- [ ] Pass

---

## 4. Event Detail Screen

### 4.1 Offline -- loading event

- **Precondition**: "Force Offline" ON.
- **Steps**: Tap on an event from Explore (if explore was previously loaded).
- **Expected**: Loading spinner then error state with back navigation. No crash.
- [ ] Pass

### 4.2 Offline -- RSVP toggle

- **Precondition**: Event detail loaded. "Force Offline" ON.
- **Steps**: Tap the "Going" / RSVP button.
- **Expected**: Error alert. RSVP state does not toggle incorrectly.
- [ ] Pass

### 4.3 Slow network -- check-in flow

- **Precondition**: Event detail loaded. "Slow Network" ON.
- **Steps**: Tap "Check In" (assuming location/time requirements are met).
- **Expected**: Camera screen eventually opens after delay. No timeout crash.
- [ ] Pass

### 4.4 Backend down -- share button

- **Precondition**: Event detail loaded. "Backend Down" ON.
- **Steps**: Tap Share.
- **Expected**: Share sheet opens (native OS share, not a Supabase call).
  Interaction logging may silently fail but the share itself succeeds.
- [ ] Pass

---

## 5. Post Creation (Camera + Submit)

### 5.1 Offline -- photo capture and submit

- **Precondition**: Navigate to camera screen. Capture a photo. "Force Offline" ON.
- **Steps**: Add a caption and tap Submit/Post.
- **Expected**: Error alert ("Failed to upload" or "Network error"). Photo is
  not lost (user can retry). App does not crash.
- [ ] Pass

### 5.2 Slow network -- upload latency

- **Precondition**: Camera screen with photo taken. "Slow Network" ON.
- **Steps**: Tap Submit/Post.
- **Expected**: Upload progress/spinner is visible for extended duration. Post
  eventually succeeds. No duplicate posts.
- [ ] Pass

### 5.3 Backend down -- submit failure

- **Precondition**: Camera screen with photo. "Backend Down" ON.
- **Steps**: Tap Submit/Post.
- **Expected**: Error alert. User can navigate back without losing the photo
  or crashing.
- [ ] Pass

---

## 6. Authentication

### 6.1 Offline -- sign in

- **Precondition**: Sign out first. "Force Offline" ON.
- **Steps**: Enter valid credentials, tap Sign In.
- **Expected**: Error alert with user-friendly message (e.g., "Network error.
  Check your connection and try again."). Loading spinner stops.
- [ ] Pass

### 6.2 Offline -- sign up

- **Precondition**: On sign up screen. "Force Offline" ON.
- **Steps**: Fill form, tap Sign Up.
- **Expected**: User-friendly error, no crash.
- [ ] Pass

### 6.3 Slow network -- sign in latency

- **Precondition**: "Slow Network" ON.
- **Steps**: Enter credentials, tap Sign In.
- **Expected**: Loading indicator visible for ~2s. Sign-in succeeds. Button
  disabled during loading (no double-tap).
- [ ] Pass

### 6.4 Backend down -- sign in

- **Precondition**: "Backend Down" ON.
- **Steps**: Enter credentials, tap Sign In.
- **Expected**: Error alert. Raw 503 is not shown -- user sees a friendly error.
- [ ] Pass

---

## 7. Event Creation

### 7.1 Offline -- create event submit

- **Precondition**: Navigate to Create Event. Fill in title and details.
  "Force Offline" ON.
- **Steps**: Tap Create.
- **Expected**: Error message shown. Form data is preserved. No crash.
- [ ] Pass

### 7.2 Slow network -- create event

- **Precondition**: "Slow Network" ON. Fill in event form.
- **Steps**: Tap Create.
- **Expected**: Loading state visible for ~2s. Event created successfully.
  Submit button disabled during loading.
- [ ] Pass

### 7.3 Backend down -- address autocomplete

- **Precondition**: Navigate to Create Event.
- **Steps**: Type an address in the location field.
- **Expected**: Address autocomplete uses Nominatim (direct `fetch`, not
  Supabase), so the simulator does not intercept it. Test with **device
  Airplane Mode** instead -- autocomplete shows no suggestions gracefully.
- [ ] Pass

---

## 8. Navigation Under Error Conditions

### 8.1 Tab switching during offline

- **Precondition**: "Force Offline" ON.
- **Steps**: Rapidly switch between Explore, Feed, and Profile tabs.
- **Expected**: Each tab shows its appropriate error/loading state. No white
  screen of death. No unhandled promise rejection crash.
- [ ] Pass

### 8.2 Back navigation from error state

- **Precondition**: "Force Offline" ON. Navigate to Event Detail (error state).
- **Steps**: Tap back button or hardware back.
- **Expected**: Returns to previous screen. No crash.
- [ ] Pass

### 8.3 Deep link during offline

- **Precondition**: "Force Offline" ON.
- **Steps**: Open a deep link to an event (e.g., via share URL).
- **Expected**: Event detail shows error state with back option. No crash.
- [ ] Pass

---

## 9. Weather API (Direct Fetch)

### 9.1 Weather API failure

- **Precondition**: Turn on **device Airplane Mode** (not the simulator toggle,
  since weather uses direct `fetch`).
- **Steps**: Navigate to Explore tab.
- **Expected**: Weather indicator is absent or shows stale cached data. Events
  still load once airplane mode is turned off. No crash.
- [ ] Pass

---

## Summary

| #   | Test                                   | Result |
| --- | -------------------------------------- | ------ |
| 1.1 | Explore -- offline initial load        | [ ]    |
| 1.2 | Explore -- retry after recovery        | [ ]    |
| 1.3 | Explore -- offline pull to refresh     | [ ]    |
| 1.4 | Explore -- slow network loading        | [ ]    |
| 1.5 | Explore -- backend down error          | [ ]    |
| 1.6 | Explore -- infinite scroll latency     | [ ]    |
| 2.1 | Feed -- offline initial load           | [ ]    |
| 2.2 | Feed -- retry                          | [ ]    |
| 2.3 | Feed -- slow pull to refresh           | [ ]    |
| 2.4 | Feed -- backend down preservation      | [ ]    |
| 3.1 | Profile -- offline data                | [ ]    |
| 3.2 | Profile -- offline avatar upload       | [ ]    |
| 3.3 | Profile -- offline bio save            | [ ]    |
| 3.4 | Profile -- offline friend requests     | [ ]    |
| 4.1 | Event Detail -- offline load           | [ ]    |
| 4.2 | Event Detail -- offline RSVP           | [ ]    |
| 4.3 | Event Detail -- slow check-in          | [ ]    |
| 4.4 | Event Detail -- share while down       | [ ]    |
| 5.1 | Post Creation -- offline submit        | [ ]    |
| 5.2 | Post Creation -- slow upload           | [ ]    |
| 5.3 | Post Creation -- backend down          | [ ]    |
| 6.1 | Auth -- offline sign in                | [ ]    |
| 6.2 | Auth -- offline sign up                | [ ]    |
| 6.3 | Auth -- slow sign in                   | [ ]    |
| 6.4 | Auth -- backend down sign in           | [ ]    |
| 7.1 | Event Creation -- offline create       | [ ]    |
| 7.2 | Event Creation -- slow create          | [ ]    |
| 7.3 | Event Creation -- address autocomplete | [ ]    |
| 8.1 | Navigation -- tab switching offline    | [ ]    |
| 8.2 | Navigation -- back from error          | [ ]    |
| 8.3 | Navigation -- deep link offline        | [ ]    |
| 9.1 | Weather -- API failure                 | [ ]    |

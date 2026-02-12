# QA Launch Checklist

Manual test script for verifying core flows before App Store / Play Store submission. Work through each section on a real device (or simulator). Check each box when the step passes.

---

## 1. Auth

- [ ] **Sign Up** — Create a new account with email + password + username. Lands on feed after signup.
- [ ] **Log Out** — Settings > Log Out. Confirmation dialog appears. Tap "Log Out". Lands on sign-in screen.
- [ ] **Log In** — Sign in with existing credentials. Lands on feed.
- [ ] **Wrong password** — Enter wrong password. Error message shown, no crash.
- [ ] **Duplicate email** — Try signing up with an existing email. Error message shown.
- [ ] **Delete Account** — Settings > Delete Account. Two confirmation dialogs. After deletion, lands on sign-in screen. Cannot log in with old credentials.

---

## 2. Profile

- [ ] **View own profile** — Tap Profile tab. Username, avatar, bio, XP, streak visible.
- [ ] **Edit profile** — Settings > Edit Profile. Change username and/or bio. Save. Changes reflected on profile.
- [ ] **Change avatar** — Edit Profile > tap avatar. Pick/take photo. New avatar appears on profile and in feed posts.
- [ ] **View other user's profile** — Tap a username on a post or in friends list. Their profile loads.

---

## 3. Friends

- [ ] **Send friend request** — On another user's profile, tap Add Friend. Status changes to "Pending".
- [ ] **Accept friend request** — Log in as the other user (or use a second device). Accept the request. Both users now show as friends.
- [ ] **Decline friend request** — Send a request, then decline it from the recipient. Request disappears.
- [ ] **Remove friend** — From a friend's profile, remove them. They no longer appear in friends list.
- [ ] **Find friends from contacts** — Settings > Find Friends from Contacts. Contacts permission prompt appears. If a matching user exists, they show in results.
- [ ] **Phone number** — Settings > Phone Number. Add number. Hash stored (verify via contacts sync from another account).

---

## 4. Explore

- [ ] **Load explore** — Tap Explore tab. Items load. Skeleton/loading indicator shown while loading.
- [ ] **All / Events / Activities toggles** — Each toggle filters the list correctly.
- [ ] **Filter chips** — Tap category chips (e.g., Music, Food). List updates. "Clear filters" resets.
- [ ] **Date filter** — Filter by "Today", "This Weekend", "This Week". Results match.
- [ ] **Map view** — Toggle map view. Pins appear for items with coordinates. Tap pin → navigates to detail.
- [ ] **Item detail** — Tap an explore item. Detail screen shows title, description, location, date, images.
- [ ] **Scroll pagination** — Scroll to bottom of explore list. More items load (or end of list indicated).

---

## 5. Event Detail + RSVP

- [ ] **RSVP — Going** — On event detail, tap "I'm Going". Button state updates. RSVP count increments.
- [ ] **RSVP — Un-going** — Tap again to remove RSVP. Count decrements.
- [ ] **Friends Going** — If a friend has RSVP'd, their avatar appears in the "Friends Going" section.
- [ ] **Directions** — Tap the directions/map button. Opens Maps app with correct coordinates.
- [ ] **Share** — Tap share icon. Share sheet appears with formatted message: title, date, location, deep link. Send via iMessage and confirm link text is correct.

---

## 6. Check-In + Post

- [ ] **Check-in flow** — On event detail (at event location), tap "Check In & Post". Location permission prompt if first time. Camera opens.
- [ ] **Location verification** — If not within 200m of event, error shown. Check-in denied.
- [ ] **Camera capture** — Take a photo (back camera). Flip to front. Take a dual photo.
- [ ] **Submit post** — Add caption (optional, max 100 chars). Submit. Spinner shown. Post appears in feed.
- [ ] **Post in feed** — New post shows: photo, caption, event name, timestamp, user avatar + username.
- [ ] **Delete own post** — On own post, tap delete. Confirmation dialog. Post removed from feed.

---

## 7. Feed + Social

- [ ] **Feed loads** — Tap Feed tab. Posts from friends appear, most recent first.
- [ ] **Reactions** — Tap a reaction emoji on a post. Reaction count updates. Tap again to remove.
- [ ] **Comments** — Tap comment icon. Comment sheet opens. Write and submit a comment. Comment appears.
- [ ] **Pull to refresh** — Pull down on feed. New posts load.
- [ ] **Empty state** — New user with no friends. Feed shows appropriate empty state message.

---

## 8. Create Event (user-created)

- [ ] **Create event** — Tap create event. Fill in title, location, date/time. Submit. Event appears in explore.
- [ ] **Edit event** — On own event detail, tap edit. Change details. Save. Changes reflected.
- [ ] **Delete event** — On own event detail, tap delete. Confirmation dialog. Event removed.

---

## 9. Deep Linking

- [ ] **Custom scheme (dev)** — Open `euda://event/{valid-id}` via Safari/Notes. App opens to event detail.
- [ ] **Not-found route** — Open `euda://nonexistent/path`. App shows "Page not found" screen with "Go Home" button.
- [ ] **Share link opens app** — Share an event via iMessage. Tap the link on another device. App opens to the correct event. (Requires Universal Links server setup for `https://` links.)

---

## 10. Settings

- [ ] **Theme switching** — Settings > toggle Light / Dark / System. App theme updates immediately.
- [ ] **Privacy settings** — Settings > Privacy. Location permission status shown correctly. Contacts link works.
- [ ] **About & Help** — Settings > About & Help. Version, links displayed.
- [ ] **Change password** — Settings > Change Password. Enter old + new password. Success message shown.
- [ ] **Blocked users** — Settings > Privacy > Blocked Users. (Placeholder screen or functional if implemented.)
- [ ] **Version display** — Bottom of Settings shows "Euda v1.0.0 (1)" and logged-in username.

---

## 11. Dev Info (dev builds only)

- [ ] **Dev section visible** — In dev builds, Settings shows a "Developer" section at the bottom.
- [ ] **Environment shown** — Shows `APP_ENV` (dev/staging/prod) and Supabase URL.
- [ ] **Not visible in prod** — In production builds, the Developer section is hidden.

---

## 12. Error Handling + Offline

- [ ] **Airplane mode — Explore** — Turn on airplane mode. Open Explore tab. Error/empty state shown, no crash.
- [ ] **Airplane mode — Feed** — Turn on airplane mode. Open Feed tab. Cached content or error state, no crash.
- [ ] **Airplane mode — Post** — Try to submit a post offline. Error message shown, post not lost.
- [ ] **Bad network — Detail** — On slow/flaky connection, open an event detail. Loading indicator. No infinite spinner.
- [ ] **Session expired** — Let session expire (or manually clear token). App redirects to sign-in, no crash.
- [ ] **Invalid deep link ID** — Open `euda://event/does-not-exist`. Detail screen shows "not found" or error state.

---

## 13. Permissions

- [ ] **Camera denied** — Deny camera permission. Try to check in. Helpful error, not a crash.
- [ ] **Location denied** — Deny location permission. Try to check in. Helpful error explaining why location is needed.
- [ ] **Contacts denied** — Deny contacts permission. Tap "Find Friends from Contacts". Helpful error or settings prompt.
- [ ] **Revoke mid-session** — Grant camera, go to OS Settings, revoke camera. Return to app, try to check in. Handles gracefully.

---

## 14. Platform-Specific

### iOS
- [ ] **Notch / Dynamic Island** — Content doesn't overlap safe areas.
- [ ] **Swipe back** — Swipe from left edge to go back on detail screens.
- [ ] **Dark mode** — Switch iOS to dark mode. App respects theme setting (System mode).

### Android
- [ ] **Back button** — Hardware/gesture back works on all screens. No unexpected exits.
- [ ] **Edge-to-edge** — Content extends properly with edge-to-edge enabled.
- [ ] **Dark mode** — Switch Android to dark mode. App respects theme setting (System mode).

---

## Sign-Off

| Tester | Device | OS Version | Date | Pass? |
|--------|--------|------------|------|-------|
| | | | | |
| | | | | |

---

*Check off items as you test. If a step fails, note the issue inline and create a fix ticket before submission.*

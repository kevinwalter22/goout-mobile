EUDA — V1 PRODUCT SPEC



Presence > Content. Get off the couch.



1\. Product Vision (V1)



Euda is a presence-first social app.

You don’t post because you want attention — you post because you showed up.



Unlike Instagram or BeReal:



You cannot upload photos



You cannot post anytime



You must be physically present at a place or activity to post



V1 proves one core idea:



People value seeing what their friends are actually doing, not what they staged.



2\. What V1 Is (and Is Not)

V1 IS



A mobile-only iOS app



A friend-based social feed



Location-verified, camera-only posts



Events + activities discovery



Simple, clean UX



V1 IS NOT



A content creation platform



A marketplace



A web app



AI-heavy or scraping-heavy



Monetized



Feature-complete



If it does not directly support presence-verified social posting, it is out of scope.



3\. Core User Loop (V1)



User opens Euda



Sees what friends are doing (Feed)



Sees nearby events/activities (Explore)



Goes to something IRL



Checks in at the location



Camera unlocks



User posts



Friends see it and engage



That loop is the entire app.



4\. App Navigation (3 Tabs Only)

Tab 1 — Feed



Purpose: See what your friends are doing



Shows



Chronological feed of friends’ posts



Each post includes:



Dual camera photo (front + back OR one selected)



Event/activity name



Location name



Timestamp



Like button



Comment count (tap to view comments)



Rules



Feed only shows posts from friends



No reposts



No stories



No algorithmic ranking (chronological only)



Tab 2 — Explore (Events + Activities)



Purpose: Find reasons to go out



This is a single scrollable list containing both:



Events (fixed time + location)



Activities (ongoing things you can do)



Event examples



Live music



Pickup hockey



Meetup at a bar



Farmers market



Activity examples



Gym



Shopping



Walk



Studying at library



Each card shows



Title



Time (if event)



Location



Category



“X friends going” (if applicable)



Interactions



Tap → Event detail screen



“I’m going” / “Interested” button



V1 constraint



All events/activities are admin-created or manually seeded



No web scraping in V1



Tab 3 — Profile



Purpose: Identity + progress



Shows



Profile photo placeholder



Username



XP / streak placeholder



Grid or list of past posts



Friends count



Button to view friends list



Sign out button



V1 simplification



Profile photo is optional



XP exists but has no deep logic yet



5\. Posting Rules (Most Important Part)

You can only post if ALL are true:



You are physically near an event/activity location



Location permission is enabled



You tap “Check In”



After check-in:



Camera opens immediately



No upload from gallery



No filters



No captions longer than 1 line



Must post within a short time window (e.g. 2 minutes)



Camera Modes



User can choose:



Front camera



Back camera



Dual camera (front + back)



6\. Friends System (V1 Lite)



Capabilities



Search users by username



Send friend request



Accept / reject request



Remove friend



Feed logic



You only see posts from friends



Explore shows events regardless of friends



No



Followers



Public profiles



Suggested friends algorithm (manual only)



7\. Data Model (High Level)

Tables (V1)



users (auth handled by Supabase)



profiles



events



activities



posts



post\_photos



friendships



likes



comments



Storage



Photos stored in Supabase Storage



Metadata stored in Postgres



8\. Authentication



Email + password (Supabase Auth)



On first signup:



Create profile row



Auth required to use app



9\. Tech Stack (Locked for V1)



Expo (React Native)



Expo Router



Supabase (Auth, DB, Storage)



TypeScript



GitHub Actions (CI)



No framework swaps in V1.



10\. UX Principles



Clean



Minimal



No clutter



No dopamine tricks



Fast to post



Feels intentional



If a feature increases complexity without increasing presence, it gets cut.



11\. Out of Scope (Explicitly Not V1)



Web scraping of events



AI recommendations



Monetization



DMs



Groups



Public feeds



Android support



Stories



Filters



Uploading old photos



Reposting content



12\. Definition of V1 Success



V1 is successful if:



Users can sign up



Add friends



See events



Check in somewhere



Post via camera only



See friends’ posts in a feed



Nothing more.



13\. Product Name



euda



Lowercase, minimal, intentional.


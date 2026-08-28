# Phase 3 · Act 1 — The Post-First Posting Flow

Status: **LOCKED** (2026-08-25, all decisions made) · Owner: Kevin (native surfaces) + builder (foundation)
Companion recon: the four recon streams that grounded this (posting flow, posts schema +
migration 137, post-time search feasibility, the four small fixes).

This is the crown-jewel interaction — the camera-first posting loop that makes Euda *Euda*.
We spec it fully on paper, then build **foundation-first** (like Layer 2's taxonomy doc):
the search RPC + index + verification invariant first, the native camera/picker UI last.

---

## 0. North Star — the verification principle

> **Every post is verified-present. Flexibility is in WHAT you post to, never WHETHER you
> were there.**

There is **no post from nowhere.** A post can be linked to a named place (a DB item) or
posted as raw "My Location," but in **both** cases it carries the poster's real post-time
GPS coordinates. You can always post; you can never falsely claim a place you're not at.

The two paths **degrade into each other**:
- **In range of the place you searched →** link it, verified.
- **Out of range →** the place link is blocked; you fall back to **My Location** (your real
  coords). Posting never fails; false place-claims never succeed.

Everything below serves this principle.

---

## 1. Locked decisions

1. **Coords required on every post — including "My Location."** The current standalone
   insert branch writes `latitude/longitude = null` (recon: `camera.tsx:236-237`, and the
   branch is currently unreachable dead code). We fix it to always persist the user's
   post-time GPS. Enforcement: **extend the migration-137 trigger** (see §4 for the
   recommendation + tradeoff), not a column NOT-NULL.
2. **Relaxed radius = a named config constant, `POST_FIRST_RADIUS_METERS`, set to 400 m**
   (in the 300–500 m band). Forgiving for GPS drift + large venues, still "basically there."
   Strict check-in stays `CHECK_IN_RADIUS_METERS = 200` for the existing item-gated path.
3. **Linking a DB place while OUTSIDE the relaxed radius → block the link.** Can't claim a
   named place you're not at. The escape hatch is always "post as My Location" (real coords).

---

## 2. The flow (post-first route)

**The existing item-gated path stays untouched** (event/explore → `verifyCheckInLocation` →
`/checkin/[eventId]` → `/checkin/camera`). Post-first is a **new, additive** entry point.

```
Purple-plus (on EVERY tab, same spot)
      │
      ▼
CAMERA-SELECT screen ········ "Create an event" (SECONDARY link, small/de-emphasized — the old
      │                        purple-plus destination lives here, but posting is the primary act)
      │  (Back / Front / Dual — reuse CAMERA_MODES; screen stays focused on shooting)
      ▼
SHOOT (reuse the existing capture: single back / front / dual BeReal-style)
      │
      ▼
ADD DETAILS  ── location FIRST (so a linked item can autopopulate the title)
      │
      ├─ PLACE-PICKER (new screen)
      │     • search the DB for where you are — fuzzy name, distance-ranked from current GPS
      │       (new RPC, §5). Light rows: {id, title, location_name, lat, lng, distance_m}.
      │     • select a result → run RELAXED-radius verification (POST_FIRST_RADIUS_METERS):
      │         – in range  → link it (explore_item_id set, verified_lat/lng/at + verified_at_event=true)
      │         – out of range → BLOCK the link; show "You're not at <place>. Post as My Location instead?"
      │     • "My Location" is ALWAYS available as the default/fallback
      │         → no DB item (explore_item_id null), post-time coords saved (REQUIRED)
      │
      ▼
TITLE  — autopopulated from the linked item's title if one is linked; always editable;
         for My Location the user writes their own (placeholder e.g. the reverse-geocoded area, optional)
      │
      ▼
CAPTION (reuse MAX_CAPTION_LENGTH = 100)
      │
      ▼
POST → reuse the existing insert branching (linked vs standalone), fed the right data (§3)
     → redirect to Feed (existing behavior)
```

**Key UX rule (the degrade):** the place-picker and My-Location are one screen, not two
routes. Out-of-range simply flips the selected result into a My-Location post with the
user's real coords — one tap, posting never dead-ends.

---

## 3. Reuse the existing insert — don't rebuild it

The post insert already branches (recon: `camera.tsx handlePost`, direct
`supabase.from("posts").insert`). We **feed it the right data**, we do not rewrite it:

| Post kind | explore_item_id | event_id | coords written | verified_at_event |
|---|---|---|---|---|
| **Linked (in range)** | the item id | null | `verified_lat/lng/at` = user's GPS | `true` |
| **My Location (fallback/default)** | null | null | `verified_lat/lng/at` = user's GPS | *(unset)* |
| Legacy item-gated path (unchanged) | the item id | null | `verified_lat/lng/at` | `true` |

**Unified coords model:** `verified_lat/lng/at` hold the poster's real post-time coords for
**every** post (linked and standalone). The legacy `latitude/longitude` columns stay
deprecated/null. This gives one coords field to read everywhere and one invariant to enforce.

Always-required columns for any insert (recon: schema): `user_id`, `photo_path`,
`camera_mode` (NOT NULL) + RLS `auth.uid() = user_id`.

---

## 4. Coords enforcement — recommendation + tradeoff (my call to make)

**Recommendation: enforce via the migration-137 trigger, NOT a column constraint.**

Extend `enforce_post_verification()` so a **standalone** post (both FKs null) must carry
coords, while leaving linked and legacy paths exactly as they are:

```sql
-- inside enforce_post_verification(), replacing the current `IF explore_item_id IS NULL THEN RETURN NEW`:
IF NEW.explore_item_id IS NULL THEN
  IF NEW.event_id IS NULL THEN
    -- standalone / "My Location": Phase-3 principle — no post from nowhere.
    IF NEW.verified_lat IS NULL OR NEW.verified_lng IS NULL OR NEW.verified_at IS NULL THEN
      RAISE EXCEPTION 'invariant: a standalone post must include the poster''s coordinates'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;           -- legacy event_id-only posts still pass through untouched
END IF;
-- (linked posts fall through to the existing verified_at_event + verified_lat/lng/at checks)
```

**Why this is the safest option (the tradeoff you asked for):**
- **Triggers fire on new inserts only** — they never validate existing rows, so there is
  **zero risk to existing data** (unlike a `CHECK` constraint, which validates the whole
  table on add and would fail if any legacy row violates it).
- **A column `NOT NULL` is actually wrong here:** coords live in `verified_lat/lng` (linked
  posts already set them; `137` requires it), while `latitude/longitude` are set to `null`
  by the *existing* linked insert. A NOT-NULL on `latitude/longitude` would **break every
  existing linked post**. There is no single always-populated column to constrain.
- **Scoped to standalone posts** — linked posts already carry coords (137), legacy
  `event_id` posts are left alone, so **the existing path cannot break.**
- **Belt-and-suspenders:** the client also always sets `verified_lat/lng/at` on a
  My-Location post (from `getCurrentLocation()`), so the trigger is a backstop, not the
  only guard.

Net: one small, additive edit to the 137 trigger + the client always writing coords. No new
column, no table-wide constraint, no existing-row or existing-path risk.

---

## 5. The place-search RPC (new — the core of the "front half")

The one genuinely new server capability. Recon confirmed **nothing usable exists** (the
Explore search is browse-gated + heavy + not distance-ranked; pg_trgm is enabled but
**unindexed**; no place-search RPC).

**Design goals:** answer *"what am I standing in front of?"* — fuzzy name match, **ranked by
distance from current GPS**, with **none** of the browse/quality/time gates, returning
**light** rows.

```sql
-- Migration: trigram index (pg_trgm already enabled, migration 040) — makes fuzzy fast.
create index if not exists idx_explore_items_title_trgm
  on public.explore_items using gin (title gin_trgm_ops);
create index if not exists idx_explore_items_location_name_trgm
  on public.explore_items using gin (location_name gin_trgm_ops);

-- Post-time place search: fuzzy name + distance-ranked, NO browse gates.
create or replace function public.search_places_for_post(
  p_query text,
  p_lat    double precision,
  p_lng    double precision,
  p_limit  int default 12
) returns table (
  id uuid, title text, location_name text,
  lat double precision, lng double precision, distance_m double precision
)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.location_name, c.lat, c.lng, c.distance_m
  from (
    select ei.id, ei.title, ei.location_name, ei.lat, ei.lng,
      6371000 * acos(least(1, greatest(-1,
        cos(radians(p_lat)) * cos(radians(ei.lat)) *
        cos(radians(ei.lng) - radians(p_lng)) +
        sin(radians(p_lat)) * sin(radians(ei.lat))
      ))) as distance_m
    from public.explore_items ei
    where ei.deleted_at is null
      and coalesce(ei.is_admin_suppressed, false) = false   -- drop admin-removed spam only
      and ei.lat is not null and ei.lng is not null          -- needed for distance
      and (
        ei.title ilike '%' || p_query || '%'
        or ei.location_name ilike '%' || p_query || '%'
        or similarity(ei.title, p_query) > 0.2
      )
  ) c
  where c.distance_m <= 30000        -- SEARCH SUGGESTIONS capped at 30km (see below); posting is NEVER capped
  order by c.distance_m asc
  limit greatest(1, least(p_limit, 25));
$$;

grant execute on function public.search_places_for_post to authenticated;
```

**Design notes / decisions (locked):**
- **Distance cap = 30 km, on SEARCH RESULTS ONLY — never on posting.** If the nearest DB
  match is >30 km, we simply don't *suggest* it; the user posts **My Location** with their
  real coords. **Posting is never distance-capped** — only the place-suggestions are. This is
  why the picker's empty/far state (§5b) is designed as "no places near you → post My
  Location," not a failure. The cap keeps suggestions honest (no "tag a place 40 mi away").
- **This RPC IS the posting-search surface of the two-surface catalog model.** Earlier
  (the two-surface catalog work) we designed a *broad posting-search catalog* — all real
  places, searchable at post time, **non-region-scoped**, distinct from the **curated
  carousel** surface (`is_carousel_eligible`). `search_places_for_post` is that posting side
  finally getting built: it searches the **broad** set (any real place, incl. non-carousel
  ones), not the curated carousel set, and it is **not** region-scoped. Future-us: this is
  **THE** posting-search surface, not a one-off — keep it consistent with the two-surface model.
- **Gates:** deliberately minimal — only `deleted_at` + `is_admin_suppressed`. **NOT** gated
  by `is_place`, quality, review-status, region, or time-window. You can be standing at any
  real place and find it — even a non-carousel one.
- **Ranking:** primary `distance_m ASC` (you're physically there; nearest match wins). Name
  is the *filter*; distance is the *sort*. `similarity()` catches typos beyond `ilike`.
- **Light rows + `stable`/`security definer`** — just what the picker needs, read-only, runs
  regardless of RLS.

---

## 5b. Place-picker states — where "posting never fails" holds or breaks

These states are **part of T5 (the picker UI)** and are the difference between the flow
feeling reliable vs. frustrating. **The principle: the user never hits a wall — every state
resolves to "you can still post."** My Location is not a buried fallback; in the empty/far
states it is *the obvious, intended path*.

| State | What the picker shows | Resolves to |
|---|---|---|
| **No search yet / on open** | Current-area label + a prominent **"Post My Location"** default, with a search field above it ("Search for where you are"). | My Location is one tap; searching is optional. |
| **Search returns nothing** (typo, or place not in catalog) | Empty result with a clear affordance: **"Can't find it? Post as My Location"** — friendly, not an error. | My Location (real coords). |
| **No places within 30 km** (rural / catalog gap) | "No places near you" → **"Post My Location"** presented as *the* path, not a failure. Do not show far (>30 km) matches. | My Location (real coords). |
| **Place found, but user is OUTSIDE the 400 m relaxed radius** | Per the block rule: the link is disabled with an explanation — **"You're not close enough to tag [place] — post your location instead"** — and a one-tap degrade to My Location (their real coords). Never a dead-end error. | My Location (real coords). |
| **Place found, user IN range** | Select → linked, verified; title autopopulates from the item. | Linked verified post. |

Design rule: the **"Post My Location"** action is always present on the picker (persistent,
not conditional), so any state — including a mid-search dead-end — is one tap from a
successful post. Out-of-range is a *smooth degrade with an explanation*, never a hard error.

---

## 6. Build decomposition (foundation-first)

| Layer | Item | Kind |
|---|---|---|
| **Foundation (build first)** | `search_places_for_post` RPC + trigram indexes | **NEW · builder** |
| | Coords invariant — 137 trigger extension | **NEW · builder** |
| | `POST_FIRST_RADIUS_METERS` const + `verifyPostLocation()` relaxed variant | plumbing · builder |
| **Native (Kevin, on device)** | camera-select screen (+ "Create an Event" button) | reuse+native · **needs device** |
| | pre-camera **place-picker** (search + My Location + relaxed verify + degrade) | **NEW · needs device** |
| | title-autopopulate + caption + post wiring | plumbing · needs device |
| **Insert** | feed existing branching the right data; persist coords on standalone | plumbing · builder+device |
| **4 fixes** | FAB-everywhere, back-swipe, LocationPuck, map postable+double-tap | see §7 |

The verification **tail** (util → mode-select → camera → 137) is **reused as-is**. The new
work is the **front half**: the search RPC/index (server) and the place-picker screen (native).

---

## 7. Bounded tasks (spec'd to the template)

Each task lists **why / files / change / out-of-scope / acceptance** and is flagged
**[builder]** (browser/SQL-testable, ship overnight) or **[needs-device]** (native, Kevin
verifies on device).

### T1 — [builder] Place-search RPC + trigram indexes
- **why:** the "what am I at?" search doesn't exist; the Explore search is browse-gated,
  heavy, and not distance-ranked; pg_trgm is unindexed.
- **files:** new `supabase/migrations/NNN_search_places_for_post.sql`.
- **change:** the two gin_trgm indexes + `search_places_for_post` exactly as §5.
- **out of scope:** the picker UI; any browse-gate filtering.
- **acceptance (browser/SQL-testable):** calling the RPC with a partial name + coords returns
  light `{id,title,lat,lng,distance_m}` rows ordered by ascending distance; a typo still
  matches via `similarity`; a `is_admin_suppressed`/`deleted_at` row never appears; a
  non-carousel-eligible real place *does* appear (proves no browse gate); `EXPLAIN` shows the
  trigram index used.

### T2 — [builder] Coords invariant (137 trigger extension)
- **why:** enforce "no post from nowhere" for standalone posts without breaking linked/legacy.
- **files:** new migration extending `enforce_post_verification()` (§4).
- **change:** the standalone-coords branch in §4; nothing else in the trigger changes.
- **out of scope:** column NOT-NULL/CHECK constraints (rejected — see §4); the client write
  (that's T5).
- **acceptance (SQL-testable):** insert with both FKs null + no `verified_lat/lng` → rejected
  `check_violation`; same insert + coords → accepted; an item-linked insert (existing shape)
  still succeeds unchanged; a legacy `event_id`-only insert still passes.

### T3 — [builder] Relaxed-radius config + relaxed verify variant
- **why:** post-first uses a forgiving radius; strict 200 m stays for check-in.
- **files:** `src/config/constants.ts` (add `POST_FIRST_RADIUS_METERS = 400`),
  `src/utils/location.ts` (a `verifyPostLocation(lat,lng)` that mirrors
  `verifyCheckInLocation` but uses the relaxed constant).
- **out of scope:** touching `CHECK_IN_RADIUS_METERS` or the existing check-in path.
- **acceptance (unit-testable):** `verifyPostLocation` returns `allowed` up to 400 m and false
  beyond; `verifyCheckInLocation` unchanged at 200 m; both return `{user_lat,user_lng,verified_at}`.

### T4 — [builder] Purple-plus → reusable FAB on every tab
- **why:** post-first must be reachable from feed/explore/profile in one spot; today it's
  inline in Explore only and points at `/create-event`.
- **files:** new `src/components/PostFab.tsx` (extract from `explore.tsx:1365-1388`);
  `app/(tabs)/_layout.tsx` (render once over `<Tabs>` inside `SwipeableTabsContainer`);
  remove the inline FAB from `explore.tsx`.
- **change:** FAB destination → the new post-first camera-select route (not `/create-event`).
- **out of scope:** the camera-select screen itself (T6).
- **acceptance (browser-testable via web export):** the purple FAB renders at the same
  bottom-right spot on all three tabs; tapping routes to the post-first entry; it clears the
  tab bar height consistently.

### T5 — [needs-device] Post-first camera-select + place-picker + details flow (the crown jewel)
- **why:** the differentiated interaction; native camera + GPS + the picker UI can't be
  self-tested by the builder.
- **files:** new route(s) under `app/` for camera-select (with a "Create an Event" button →
  `/create-event`) and the place-picker; wiring into `app/checkin/camera.tsx` (or a shared
  capture) for capture → details → insert.
- **change:** implement the §2 flow — camera-select (with the **secondary** "Create an event"
  link) → capture → place-picker (calls `search_places_for_post`, runs `verifyPostLocation`,
  in-range links / out-of-range degrades to My Location) → title (autopopulate from linked
  item, editable) → caption → post via the existing insert, persisting `verified_lat/lng/at`
  on **every** post (incl. My Location). **Must implement all the §5b picker states** — the
  empty/far/out-of-range states where "posting never fails" holds; My Location is a
  persistent, prominent action, never a dead-end error.
- **out of scope:** the existing item-gated `/checkin` path (leave intact); the RPC/index (T1).
- **acceptance (Kevin on device):** from any tab, purple-plus → shoot → search a place you're
  at → links verified; search a place you're NOT at → link blocked, one-tap "My Location"
  posts with real coords; title autopopulates from a linked item and is editable; a
  My-Location post persists coords (verify the row has `verified_lat/lng`).

### T6 — [builder] Back-swipe fix + unsaved-changes guard
- **why:** back-swipe is double-disabled on create-event (and edit-event, location-picker).
- **files:** `app/create-event.tsx:150` (drop `gestureEnabled:false`),
  `src/components/SwipeableBackGesture.tsx:12` (remove the three prefixes), add a small
  unsaved-changes confirm.
- **acceptance (device):** swipe-to-go-back works on create-event/edit-event/location-picker;
  a dirty form prompts before discarding.

### T7 — [needs-device] Blue location marker (LocationPuck)
- **why:** normal users see no current-location marker (regression from the Mapbox switch);
  only a purple dot for override/dev accounts today.
- **files:** `src/components/MapboxPlacesMap.tsx` — add `<LocationPuck>` (or `<UserLocation>`)
  inside `<MapView>`; keep/retire the custom `user-dot`.
- **acceptance (device):** a normal user sees the native blue location puck on the map.

### T8 — [BUILT · needs-device] Map postable-now + double-tap-to-camera (+ card shortcut)
- **why:** List has postable highlight + double-tap→camera; Card is highlight-only; Map has
  neither. Bring them to parity.
- **built:** `handleCameraShortcut` refactored to take the item OBJECT (not an id), so the
  card carousel + map — whose items aren't guaranteed to be in `orderedItems` — resolve
  locally. Card view: `onCameraShortcut` forwarded `GroupedExploreFeed → GroupCard →
  GroupCarouselTile`; postable tiles get the POST NOW badge + purple border + the same 200ms
  double-tap discriminator. Map: `MapboxPlacesMap` computes `computePostableNow` per pin →
  a purple halo (own ShapeSource, drawn under pins) on postable places; a second tap on an
  already-selected postable pin fires the shortcut (selection stays instant); the preview
  card gains a POST NOW badge + a "Post here now ›" button (the reliable, discoverable path).
- **route note:** post-T5 the shortcut goes to the unified `/post/camera` (item pre-linked +
  verified), NOT the retired `/checkin`. Radius is the strict 200m (`POST_FIRST_RADIUS_METERS`).
- **acceptance (device):** postable pins show a purple halo on the map; double-tapping a
  postable pin (or tapping "Post here now" on the preview) runs `verifyCheckInLocation` →
  `/post/camera`; the card carousel's postable tiles double-tap to camera the same way.

---

## 8. Build order

Foundation-first, exactly like Layer 2:
1. **T1 (RPC + index)** and **T2 (coords trigger)** — server foundation, builder-shippable,
   unblock everything, zero UI risk. Land + verify on staging → prod (gated).
2. **T3 (relaxed radius)** + **T4 (FAB)** — small builder plumbing/UI.
3. **T5 (native flow)** — Kevin's device work, built on the verified foundation.
4. **T6–T8 (fixes)** — parallel; T6/T7 quick, T8 the most wiring.

## 9. Risk & non-goals
- **Existing posting path is untouched** — post-first is additive; 137 already allows
  standalone posts; the trigger edit is scoped so linked/legacy can't break.
- **Non-goals (this Act):** social ranking of posts, group posts, profile life-log map,
  friend signals on the map — later Phase-3 acts. This Act is the single-user post-first loop.
- **Decisions (locked):** RPC distance cap = **30 km on search results only, never on
  posting** (§5, §5b); "Create an event" = **secondary de-emphasized link** on camera-select
  (§2); `POST_FIRST_RADIUS_METERS = **200**` — tightened from 400 during T5 device testing
  (400m tagged too many near-but-not-at places); now matches the strict check-in radius (§1).
</content>

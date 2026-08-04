# Map & Events Overhaul — design + plan

Status: **approved (Kevin, 2026-08-04) — building now** · Owner: chief engineer

Kevin's feel-test surfaced three intertwined problems: map pins are unreliable
(red-pin fallback, vanish on tap, occasional disappear on zoom/pan), the events
map view looks empty, and recurring weekly events (trivia, farmers markets) don't
show up as events. This doc is the researched fix for all three, sequenced for
impact, and designed to scale.

---

## 1. Findings (from a staging + prod data + code investigation)

### 1.1 Rendering — the pins are *live React views*, and that's the root cause
`EmojiTeardropMarker` renders a live `<View>` (emoji + purple teardrop) that iOS
must re-rasterize on the fly via `tracksViewChanges`. That mechanism is
[a documented, fundamental weakness](https://github.com/react-native-maps/react-native-maps/issues/5402)
of react-native-maps on the New Architecture (same family as the AIRMap crash we
patched). Every symptom traces to it:
- **Red pin** = the custom view lost its rasterization race → MapKit fell back to
  its default annotation.
- **Tap → disappears** = tapping re-renders the marker → re-rasterizes → blanks.
- **Occasional zoom/pan disappear** = the same view-lifecycle churn. (The
  nesting-grid fix made the *selection logic* monotonic; it cannot fix *view*
  blanking.)

No amount of selection-logic tuning fixes a rendering-mechanism problem.

### 1.2 Events map looks empty — two fixable causes + a classification bug
Ingestion is healthy (staging +10 events/wk, prod +18/wk; collectors ran within
the hour). The sparseness is:

1. **The map fetches only the next 7 DAYS of events.** The region model settled on
   a **60-day** horizon (decision A2) but the map (`SEVEN_DAYS_MS` in
   `ExploreMapView`) never got it. Widening: staging 17 → **113** upcoming events;
   prod 27 → **184**.
2. **~70% of upcoming events have no coordinates** → invisible on a map (staging:
   only 34 of 113 future events are mappable). Collector/LLM-extracted events
   often never got geocoded.
3. **Recurring weekly events are misclassified as activities** (§1.3).

### 1.3 Recurring events — the classification bug Kevin flagged
"Recurrence" means two different things in our data depending on source:
- **Activities** (Google Places venues): 1,467 / 1,623 staging activities carry a
  recurrence rule — but that's **opening hours** (a store open Mon–Sat), correctly
  an activity.
- **Recurring events** (farmers market Sat 8–12, trivia Tue 7pm): these are
  *events*, but the ones sourced from Places come in as **`kind=activity`,
  `category=Anchor`, no date**. Every farmers market in the catalog
  ("Pray's Farmers Market", "Potsdam Farmers Market", …) is an activity. So they
  never appear in the events view and never get a "next occurrence" date.
- Trivia nights sourced from ICS calendars *are* `kind=event` with concrete dates
  (good) — but there are only ~18, and `advance_recurring_events` only advances
  things already tagged `kind=event`.

Net: a whole class of "things happening this week" (markets, trivia, open mics,
live music) is stuck in the activities bucket.

---

## 2. Solutions

### 2.1 Rendering → image markers (not live views)
Render each marker as a **static image** instead of a live view. A static image
annotation has no view lifecycle, no `tracksViewChanges`, no rasterization race,
no red-pin fallback, no tap-blanking, and it composites on the GPU — reliably
scaling to hundreds of pins.

Implementation (all JS → **OTA-deliverable**; `react-native-view-shot` is already
a dependency):
- Render each **category's** teardrop-emoji to an image **once** (there are ~20
  distinct category emojis), cache the file URI by emoji key.
- Render every pin as `<Marker image={cachedUri} />` — no per-marker view.
- Selection: a separate, single "selected ring" treatment (a distinct cached
  image variant, or an enlarged image) — only one at a time, so it's cheap.
- Keep the notability-tiered LOD selection (`selectVisiblePins`) — it's sound and
  now monotonic.

Fallback/validation risk: `Marker.image` with a runtime file URI must render
reliably on our rn-maps version — validate on-device early; if a runtime URI is
flaky, pre-generate the ~20 images as bundled assets (needs one native build).

**Scale horizon (noted, not now):** for many metros × thousands of simultaneous
pins, the eventual platform is vector tiles with native symbol layers
(Mapbox / `@rnmapbox/maps`) — native clustering, collision, label priority. That's
a heavy native migration with per-map cost; image-markers-on-rn-maps is the
correct, low-risk step for our current scale and buys us a long runway.

### 2.2 Events window → 60 days
Change the map's event fetch horizon from 7 days to 60 (align with region-model
A2). One constant + the two event queries in `ExploreMapView.fetchMapItems`.

### 2.3 Event geocoding → make events mappable
Backfill coordinates for events missing them, and ensure ingestion always
geocodes:
- **Backfill**: for events with a venue name/address but null lat/lng, resolve
  coords — first by matching an existing venue (an `explore_items` activity /
  `place_details_cache` at the same location → inherit its lat/lng, per the
  05/21 precedent), else geocode the address (Google Geocoding / Places).
- **Ingestion**: confirm the normalize path geocodes events at ingest so the gap
  doesn't refill. (Reuse `scripts/geocode_explore_items.ts` patterns.)

### 2.4 Recurring events → detect + surface as events
Bring recurring weekly events into the events experience without breaking the
venue nature of true activities.
- **Detect** recurring EVENTS vs opening-hours activities. Signals (a shared
  detector, `_shared/recurring-event-detection.ts`, single source of truth like
  chain-detection):
  - title / sub_category patterns: farmers market, trivia, open mic, karaoke,
    bingo, live music/band, etc.;
  - a recurrence rule that is a **single weekly slot** (one day + a bounded time
    window) rather than all-week hours.
- **Surface**: for detected recurring events, compute the **next occurrence**
  `starts_at` (extend `advance_recurring_events`), tag them so they appear in the
  events view + on the map on/around their day, and collapse repeats via the
  existing `event_series` model (migration 152).
- **Classification**: prefer surfacing over hard-reclassifying `kind` where an
  item is genuinely both a place and a recurring event (a market). v1 can promote
  clear cases (farmers markets) to `kind=event`; revisit dual-nature items if
  needed. Log every reclassification; backfill is re-runnable.

---

## 3. Phased plan (sequenced for impact)

**Phase 1 — data (fast, high-impact; you'd see a fuller events map same-session):**
- **1a.** Widen map events window 7d → 60d. (client → OTA)
- **1b.** Geocode events missing coords (backfill + ingest guard). (server)
- **1c.** Recurring-event detection + next-occurrence + surface (markets, trivia,
  …). (server + a shared detector; re-runnable backfill)

**Phase 2 — rendering reliability:**
- **2.** Image-marker rebuild (view-shot cached emoji images) + keep LOD. (client → OTA)

**Rollout:** each phase ships to staging via a **clean** OTA/deploy (isolate local
`.env`, grep-verify the key — see the OTA contamination memo). Once the map is
confirmed good on staging, promote staging → main (gated prod deploy) so region
model + recurrence + map + login + this overhaul all reach real users together.

## 4. Success criteria
- No red-pin fallback, no tap-blanking, no zoom/pan disappear (Phase 2).
- Events map meaningfully populated: 60-day horizon, ≥90% of upcoming events
  mappable, farmers markets / trivia / recurring weeklies visible as events.
- Everything reliable at a few hundred pins; a clear path (Mapbox) if we outgrow it.

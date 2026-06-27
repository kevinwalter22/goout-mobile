# Map Viewport-Aware Filtering — Design (Tier 3)

**Status:** Proposed — awaiting Kevin's approval before any code.
**Phase:** Portland P-A (the real "Phase A" foundation — never previously built).
**Tier:** 3 (changes how the map behaves for users).

---

## 1. The problem

The Explore **map** currently fetches markers anchored to the user's **GPS
location ± a fixed radius**, not to the area the user is actually looking at.
From `src/components/ExploreMapView.tsx`:

- **Activities, "All" mode:** queried in a box of `CHECK_IN_RADIUS_METERS × 2`
  around `userLocation` (~200 m). (line ~397)
- **Activities, "Activities" mode:** box of `min(distanceSetting, 1 km)` around
  `userLocation`, capped at 150 markers. (line ~428)
- **Events:** no geo bound at all — pulls the most recent ≤300 dated + ≤200
  recurring items globally, then distance-filters **to the user** client-side.
  (line ~337)

The fetch is keyed on `filterCacheKey` (filters + kind) — **map pan/zoom does not
trigger a refetch.** There is no `onRegionChangeComplete` handler wired to data.

**User-visible symptom:** A Portland user standing in the West End who pans the
map to the Old Port, Munjoy Hill, or out to Cape Elizabeth sees **no new
markers** — the map only ever shows what's within ~1 km of where their phone is.
The map looks empty or frozen the moment they explore. This is the "fixed-radius
bug" — and with 631 Portland venues now live, it's the difference between "this
app knows my city" and "this map is broken."

---

## 2. Goal

The map should show what's **in the visible region**. Pan/zoom → markers update
to that region (debounced), within sane performance + marker-count limits, while
preserving today's filters (kind, category, price, time window, tags) and the
existing tap/selection/clustering UX.

---

## 3. Proposed design

**Drive the query off the map region, not GPS.**

1. **Track the viewport.** Add `onRegionChangeComplete(region)` → store the
   current `{latitude, longitude, latitudeDelta, longitudeDelta}` in a ref/state.
   The region's deltas give an exact bbox:
   `lat ∈ [c.lat − δlat/2, c.lat + δlat/2]`, same for lng.

2. **Query by bbox.** Replace the user-centered `gte/lte lat/lng` bounds with the
   **viewport bbox** for both activities and events. Events gain a real geo bound
   for the first time (removes the global-limit-300 starvation risk). Keep all
   existing filters (`applyFilters`, review-status, `priority>=0`, dedup).

3. **Debounce + threshold.** Refetch on region settle, debounced ~350–500 ms,
   and **skip** refetches where the new bbox is ≳70% contained in the
   already-fetched bbox (small nudge pans don't re-query). This bounds query
   volume during a drag.

4. **Marker cap + density guard.** Keep the marker ceiling (`MAX_MARKERS`,
   currently 150). When a bbox would exceed it, return the **highest-`priority` /
   nearest-to-center** N (deterministic), and surface a subtle "zoom in for more"
   affordance (no silent truncation — consistent with our monitoring ethos).

5. **Zoom-out ceiling.** Above a max bbox area (e.g. `latitudeDelta > ~0.6°`,
   roughly multi-county), stop querying and show a "zoom in to load events"
   prompt rather than attempting a state-sized query. Prevents a pinch-to-world
   from issuing a catalog-wide scan.

6. **Initial region.** On open: if we have `userLocation`, center there at a
   sensible default zoom (~`0.08°`, ~5 mi across) and let the first viewport
   query run. If no location permission, center on the bounding region of the
   parent-provided `items` (existing `computeBoundingRegion`) — so the map is
   useful even without GPS (a real gap today).

**What stays the same:** marker rendering, thumbnail/selection logic,
`tracksViewChanges` flicker handling, dedup, the events time-window, all filters,
and the parent-`items` fallback on fetch error.

---

## 4. Behavior changes (why this is Tier 3)

| Before | After |
|---|---|
| Markers anchored to GPS ± ~1 km; panning shows nothing new | Markers follow the visible region; panning loads that area |
| Events fetched globally (≤300), distance-filtered to user | Events fetched for the viewport bbox |
| No-GPS users get a near-empty map | No-GPS users get a map centered on available items |
| Pinch-to-world silently returns the same ~150 | Zoom-out shows "zoom in to load" above a ceiling |

This changes the core interaction model of the map screen — exactly the
"UX change that changes how the app behaves" the ladder reserves for Tier 3.
It does **not** touch auth, data writes, the ranker, or the geo+time invariant.

---

## 5. Edge cases & risks

- **Query volume during drags** → debounce + containment threshold + zoom ceiling.
- **Marker overload in dense Old Port** → cap + priority ordering + "zoom in".
- **Performance** → bbox `gte/lte` on lat/lng hits existing indexes; `.limit()`
  retained. No new index expected, but I'll confirm against the prod query plan.
- **Distance setting interplay** → in viewport mode the user's distance filter
  becomes secondary to what's on screen; I propose the viewport wins on the map
  (the list view keeps the distance filter). Flag for your call in §6.
- **Regression risk** → behind a check; validated on staging with seeded Portland
  + Warwick data before promotion. Forward-fix only (no map data is written).

---

## 6. Open questions for Kevin

1. **Distance filter vs viewport on the map:** when both are set, should the map
   honor the *visible region* (my recommendation) or still clamp to the distance
   setting? (List view is unaffected either way.)
2. **"Zoom in to load" ceiling:** OK to cap the map at ~county-scale and prompt
   to zoom, rather than ever issuing a region-wide query?
3. **Marker cap:** keep 150, or raise now that catalogs are denser?

---

## 7. Plan once approved

- Implement behind the existing fetch path in `ExploreMapView.tsx` (no schema, no
  migration — pure client + read query change).
- Add a unit test for the bbox-from-region math + the containment-skip predicate.
- Manual QA on staging (Portland + Warwick seed) → PR to `staging` → test gate →
  summarize. Promotion to prod rides with the V1.1 cut (P-E), behind your gate.

**Effort:** ~1.5–2 days including QA. **Blast radius:** map screen only; reversible.

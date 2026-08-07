# Map Engine Redesign — comprehensive, robust, scalable, clean

Status: **proposed — needs Kevin's engine decision (§5) before build** · 2026-08-04

We've patched the map ~6 times (custom-view markers → crash patch → emoji
teardrops → clustering → Apple-style LOD → monotonic grid → image markers →
selection decoupling) and it's still not clean. This doc stops patching and
redesigns from first principles. There are **two independent root causes**, and
both need a structural fix.

---

## 1. Root cause A — we're plotting events, but should plot PLACES

139 upcoming mappable events sit at only **25 unique coordinates**. Examples
(staging): the State Theatre = **31 events on one exact point**; another venue =
25; the PMA = 13+13+8+7. No map engine can render 31 distinct pins at the
identical lat/lng — so the collision grid correctly collapses each venue's stack
to one pin, and "28 events" shows as ~4 pins. This is not a rendering bug.

**The mental model is wrong.** A local-discovery map is about *places and what's
happening at them*, not one pin per event occurrence. The fix is a
**location-aggregated model**: one pin per place; the pin represents everything
happening there; tapping it shows the list. This also collapses ~1,700 map items
into ~40-80 location pins — which independently makes rendering far lighter.

## 2. Root cause B — react-native-maps custom markers are fundamentally fragile

Every marker symptom (the New-Arch `AIRMap` crash, the red-pin rasterization
fallback, tap-to-blank, pop-in/out, zoom/pan churn) traces to one thing:
react-native-maps renders each marker as a **live view / bitmap that RN must
manage per-marker** on the New Architecture, and that path is
[documented as unreliable](https://github.com/react-native-maps/react-native-maps/issues/5402).
Image markers helped but data-URI images aren't cached by RN's image loader, so
they re-decode and flicker on re-render. We have squeezed this as far as it goes.

Production apps that show many POIs don't use per-marker views — they use a
**native vector map with a data-driven symbol layer**: markers are GPU-rendered
from a GeoJSON source, with native collision detection, label-priority, and
selection via feature-state. No per-marker views, so none of our failure modes
exist. This is the robust/scalable/clean foundation.

---

## 3. The redesign

### 3a. Data: a location-aggregated GeoJSON source
Build the map's data as a `FeatureCollection` where **each feature is a place**:
- Group all mappable items by venue/coordinate (round to ~5 decimals, or by
  `location_name` / venue id). One feature per place.
- Feature properties: `icon` (emoji/category), `eventCount`, `activity` (is it a
  browsable venue), `notability`, `title`, `topEventStartsAt`, `ids` (for the
  tap sheet).
- Dedup recurring occurrences by `series_id` before counting, so "31 shows"
  reads as one place with N upcoming events, not 31 stacked points.
- Icon choice: if the place has upcoming events → an event-flavored icon (or the
  dominant category); else the venue's category emoji.

This is computed once from the fetched items (client-side) or via an RPC.

### 3b. Rendering: native symbol layer (recommended engine below)
- One `ShapeSource` (the GeoJSON) + one `SymbolLayer`.
- `icon-image` from the feature's category (icons registered once as images).
- `icon-allow-overlap: false` + `symbol-sort-key` = priority (events-present and
  notability rank first) → **native collision + label-priority**: only
  non-overlapping, highest-priority pins draw; more appear as you zoom. This is
  the Apple-Maps LOD, done natively and reliably — replaces our hand-rolled
  threshold + collision grid entirely.
- Selection: `queryRenderedFeatures` on tap → set a `selected` feature-state →
  the layer styles that pin bold. No view churn, no set recompute.
- Optional: native `cluster: true` on the source for far-zoom count bubbles (or
  rely purely on collision — Apple-style).

### 3c. Tap → "what's happening here" sheet
Tapping a place pin opens the existing preview, upgraded to show the place + its
list of upcoming events/activities (from the feature's `ids`). This is the
correct interaction for a stacked venue and removes any need to render 31 pins.

## 4. Why this fixes everything
| Symptom | Fixed by |
|---|---|
| 28 events → 3-4 pins | Location aggregation (§3a): one pin per place, count in the pin, list on tap |
| pop-in/out, tap-blank, red pin | Native symbol layer (§3b): no per-marker views |
| zoom hides/reshuffles pins | Native collision + sort-key LOD; selection via feature-state |
| doesn't scale | GeoJSON + symbol layer scales to thousands; ~40-80 place features here |
| events hidden | Places with events rank first in `symbol-sort-key` |

---

## 5. Engine decision — NEEDS KEVIN
The symbol-layer approach requires a vector-map library + a tile provider. This
is a native dependency + a build (not OTA) + (for tiles) an access token.

- **Recommended: `@rnmapbox/maps` (Mapbox GL)** — the most mature RN vector map;
  excellent symbol/cluster/feature-state support; Mapbox free tier is generous
  (≈50k map loads/mo) then usage-based. Needs a Mapbox account + public token.
- **Alt: `@maplibre/maplibre-react-native` (MapLibre, open-source)** — no Mapbox
  dependency/cost, same symbol-layer capabilities, but still needs a **tile
  source** (e.g. MapTiler free tier token, or self-hosted) — so a token either
  way, just a different provider.
- **Fallback (no new provider): location aggregation (§3a) on the current
  react-native-maps** — fixes the events issue and cuts pins ~40×, which may make
  the existing image markers acceptable. Lowest risk/effort, but keeps the
  fragile marker engine (may still not be fully "clean").

**Tradeoff:** Mapbox/MapLibre is the definitively robust/scalable/clean answer
but is a bigger change (new dep, token, native build → ships with the prod
build). The rn-maps fallback is smaller/OTA-able but keeps the shaky foundation.

## 6. Migration plan (once the engine is chosen)
1. Build the location-aggregation (§3a) — **provider-independent, I can start now**
   and it helps regardless of engine.
2. Add the chosen map dep + token (Kevin) → scaffold the map screen.
3. ShapeSource + SymbolLayer + registered category icons.
4. Native collision/sort-key LOD; camera ↔ region wiring (keep the metro
   boundary + resolution ladder).
5. Feature-state selection + the "what's happening here" sheet.
6. Cut over behind the existing map tab; delete the rn-maps marker code.

## 7. What I need from you
Pick the engine in §5 (I recommend Mapbox, or MapLibre if you'd rather avoid
Mapbox). Meanwhile I'll build the location-aggregation data model, which is
needed under every option and fixes the events-stacking bug immediately.

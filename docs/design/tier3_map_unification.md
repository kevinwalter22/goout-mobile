# Tier 3 — Map unification & crash-proofing (design proposal)

Status: **proposed, awaiting Kevin's review** · Owner: chief engineer · 2026-07-09

Feel-test report that triggered this: the map still crashed (later than before,
after sustained panning); items that were *still on screen* disappeared while
panning; zoom did not behave like Apple Maps (no "notable-first when zoomed out,
detail as you zoom in"). Kevin asked for research + a comprehensive solution
before any build.

---

## 1. Root-cause analysis (from the code + live data)

### 1.1 The current fetch model — viewport refetch + replace + proximity cap
`ExploreMapView.fetchMapItems(region)` runs on **every pan/zoom** (debounced
400 ms). For the *current viewport bbox* it queries events + activities, then:

```
deduped.sort(kind → priority → distance-to-viewport-center)
setMapItems(deduped.slice(0, 50))          // MAP_MAX_MARKERS = 50
```

Three structural consequences fall out of this:

**(a) Items disappear while panning.** The 50 markers are re-selected on every
pan by *distance to the viewport center*. Pan a little → the center moves → a
*different* nearest-50 wins → items that were on screen (near the old center)
are dropped even though they're still visible. The whole `mapItems` set is
**replaced**, not merged, so nothing persists across a pan. This is exactly the
"things vanish as I pan" bug.

**(b) It crashes.** Every pan tears down and rebuilds the native marker set.
Each thumbnail marker hosts a native `<Image>` loading a remote URL (579/590
Portland items have one). Rapid mount/unmount of image-backed native views on
every pan churns native memory and image decode buffers; over a session of
panning this climbs until iOS OOM-kills the app — "not as early, but it still
crashed after moving around." The 50-cap and my grid-clustering reduced the
*count* but did not remove the *per-marker image* or the *per-pan churn*, so the
ceiling is lower but still there.

**(c) No level-of-detail.** There is no coupling between zoom and importance.
Below `MAP_MAX_VIEWPORT_DELTA` (0.6°) it shows the nearest 50 regardless of
zoom; above it the map **blanks** with a "zoom in" prompt. So zooming out shows
*nothing* past a threshold instead of *the notable things*, and zooming in never
progressively reveals detail. Nothing like the Apple Maps mental model.

### 1.2 What the data says we're actually dealing with
- **Busiest metro = Portland (staging): 590 mappable items.** That is *tiny* —
  the entire region fits in one query and in memory. We do **not** need
  per-viewport fetching at all.
- **`notability_score` 0–4.8, well spread**: ~100 items ≥ 4.0, ~340 in 3–4,
  ~103 in 2–3, plus ~45 at 0. A clean, ready-made importance signal for LOD.
- **579/590 have thumbnails** — confirms image markers are the memory driver.
- **`react-native-maps@1.20.1`, no clustering lib installed.**
- **Prod has no `region` table yet** (region model gated) → the fix should be
  **client-side** so it ships to prod without waiting on the region migrations.

---

## 2. Target behavior (the Apple/Google Maps model Kevin described)
1. **Pan at a fixed zoom is stable** — items already in view never disappear;
   new items only appear at the edges as they scroll in.
2. **Zoom is the level-of-detail control** — zoom out → fewer, more notable
   things (the rest fold into clusters); zoom in → clusters split and smaller /
   less-notable places progressively appear.
3. **Never crashes**, and stays smooth.

---

## 3. Options considered

| Option | Verdict |
|---|---|
| **A. Native MapKit clustering** (MKClusterAnnotation) | react-native-maps doesn't expose it; would need a native build (build credit) and locks us to iOS. **Rejected.** |
| **B. Supercluster (pure JS) + custom marker rendering** | Battle-tested Mapbox clustering algorithm, ~15 KB, **no native code → OTA-deliverable**, full control over LOD + rendering. **Recommended.** |
| **C. Server-side clustering RPC** (cluster in Postgres by bbox+zoom) | Overkill at 590 items; reintroduces a network round-trip on every pan — the opposite of "stable, no refetch"; needs a migration + gated prod deploy. **Rejected for now** (revisit only if a metro ever exceeds a few thousand mappable items). |
| **D. Keep the hand-rolled grid clustering I just shipped** | No hierarchical LOD, no smooth cluster expansion, and it's still bolted onto the churny per-pan refetch. Superseded by B. |

---

## 4. Proposed solution — 6 pillars (all client-side)

**Pillar 1 — Fetch the region once, not the viewport per-pan.**
When the region or filters change, fetch *all* mappable items for the active
region in one query (select only map columns: id, lat, lng, kind, title,
category, notability_score, priority, image_thumb_url, starts_at). Hold them in
memory. **Panning and zooming never refetch.** This alone eliminates the
disappear bug and the per-pan native-view churn.

**Pillar 2 — Index with Supercluster; render by (bbox, zoom).**
Build a Supercluster index once from the fetched points. On pan/zoom, map the
react-native-maps `latitudeDelta` to an integer zoom and call
`index.getClusters(paddedBbox, zoom)`. Results are **stable per zoom** —
panning at a fixed zoom includes/excludes purely by bbox, so on-screen items
persist and new ones enter at the edges (requirement 1). Zooming out merges
points into clusters; zooming in splits them (requirement 2).

**Pillar 3 — Vector markers; thumbnail only in the preview / selected pin.**
Stop hosting `<Image>` inside markers. Render points as lightweight vector pins
(colored/iconed by kind — event vs activity), and cluster bubbles as count
circles (already built). Show the actual photo only where it's cheap and useful:
the **preview card** (already exists) and optionally the **single selected**
marker. This removes the dominant memory cost structurally — crash-proofing by
construction, not by capping. (Matches how Apple/Google render POIs: glyphs, not
photos.)

**Pillar 4 — Notability-gated singletons for true zoom LOD.**
Clustering declutters, but we also want the *individual* pins at low zoom to be
the *notable* ones. Apply a notability floor that scales with zoom: at metro
zoom show only high-notability singletons (e.g. ≥ 4.0 ≈ 100 items), and lower
the floor as the user zooms in until, at street zoom, everything shows. Because
the floor depends only on zoom (not pan), a pin never disappears while panning —
only when zooming out past its tier (requirement 1 preserved).

**Pillar 5 — Padded render bbox for smooth edges.**
Query Supercluster with the viewport expanded ~30–50% so pins just off-screen
are already mounted and slide in smoothly instead of popping.

**Pillar 6 — Retire the hard zoom-out blank; bound the annotation count.**
Let clustering handle zoom-out (a few big bubbles at metro scale) instead of
blanking with "zoom in." Keep a safety cap on *rendered annotations*
(clusters + singletons ≤ ~80) — safe and generous now that they're vector, not
image, views. The region boundary still hard-scopes data to one metro.

Keep the client-error capture net in place to catch anything that still throws.

---

## 5. Rollout
- **Entirely client-side → deliverable via free OTA** (no build credit). Adds
  one pure-JS dependency (`supercluster`).
- **No migration.** Uses existing columns. Works on prod today (bbox path) and
  gets region-scoping automatically once the region model clears its prod gate.
- **Phasing:**
  - **Phase 1 (the fix):** fetch-once + Supercluster + vector markers. Resolves
    the crash and the disappear bug. Ship to staging via OTA for re-test.
  - **Phase 2 (the polish):** notability-floor LOD tuning + padded-bbox easing,
    tuned against how it actually feels.

## 6. Risks / open questions
- I could not capture a native crash stack (OOM leaves no JS error; the capture
  net logged 6 clean boots, no JS crash). Pillar 3 removes the single most
  expensive element regardless of the exact trigger, so it's the high-confidence
  structural fix — but I'll want a fresh re-test to confirm.
- Dropping photo pins is a visible style change. It's the right call for
  performance and matches the maps people expect, but it's Kevin's call (5-A).

## 7. Decisions — LOCKED (Kevin, 2026-07-09)
- **5-A. Marker style → emoji category pins in a TEARDROP shape.** Not a generic
  pin: each pin shows an emoji chosen by `sub_category` (falling back to
  `category`), so the icon tells you what the place is — like oldportguide.com.
  Teardrop with the emoji in the head and a pointer tip at the exact coord;
  cluster markers stay round count-bubbles. Emoji is just text → zero image
  memory, which is the crash fix. Photo still shows in the preview card on tap.
- **5-B. LOD → top ~100 at metro zoom.** Notability floor ≈ 4.0 at metro zoom
  (~100 singleton pins), floor lowers as the user zooms in until everything
  shows at street zoom. Tunable.
- **5-C. APPROVED** — add `supercluster` (pure JS) and ship via OTA (no build).
- **5-D. APPROVED** — ship Phase 1 (fetch-once + Supercluster + emoji teardrop
  pins) for a crash re-test first; Phase 2 (LOD easing / padding polish) after.

### Emoji map (sub_category → emoji; grounded in Portland data)
Food&Drink: 🍺 brewery · 🍸 bar · 🍽️ restaurant · ☕ cafe · 🥐 bakery · 🍦 ice cream shop · 🦪 (oysters)
Arts&Culture: 🎭 performing arts theater · 🖼️ art gallery · 🏛️ museum · 🎬 movie theater · 📚 book store · 📖 library
Nightlife: 🍸 bar · 🪩 night club
Sports&Rec: 💪 gym · 🧘 yoga studio · 🎳 bowling · ⛳ golf/mini-golf · 🏅 sports school/athletic field · 🎡 amusement
Outdoor: 🌳 park · 🥾 hiking area · 🏕️ campground · ⛵ marina · 🌾 farm · 🏞️ tourist attraction
Anchor/landmark: 🗽 historical landmark · 📍 default
Retail (fold to low priority): 🛍️ shopping mall/clothing/home goods/thrift · 💅 nail salon · 💆 spa · 🧺 farmers market
Fallback by category, then by kind (event 🎵/📅 vs activity 📍).

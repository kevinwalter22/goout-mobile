# Map emoji pins — reliable icons + zoom de-clutter

## Problem
The Mapbox map needs pins that (1) show a category **emoji**, (2) **de-clutter when
zoomed out** (overlapping pins collapse, notable ones survive, the rest fill in on
zoom-in), and (3) are **sized sensibly** relative to the selection ring. Two prior
attempts failed:

- **Emoji as `textField`** → blank. Mapbox renders text from the style's glyph
  fonts, which contain no color-emoji glyphs.
- **Emoji as `<Image>` view-snapshot** (RN view → native image) → blank on the New
  Architecture. Removing the fallback disc made the whole map blank.
- **Vector `CircleLayer` dots** → renders reliably but **cannot collide**, so no
  zoom de-clutter, and dots looked too small vs. the ring.

## Decision
Native **collision only exists on symbol layers**, and symbol icons need real
images. So: **bundle a small PNG pin per category emoji** (static `require`
assets — the one @rnmapbox image path that is reliable, unlike runtime
snapshots) and draw them with a single `SymbolLayer` using `iconImage`.

### Pin assets
- Source emoji art from **Twemoji** (CC-BY 4.0) PNGs — free, bundleable, and
  consistent across platforms (Apple emoji can't be legally bundled or reliably
  snapshotted here).
- Composite each emoji onto a **white disc with a thin Euda-purple ring** (via
  `sharp`) → a clean 72px pin. One PNG per unique taxonomy emoji.
- Output to `assets/mappins/<codepoint>.png` + a static `require` map in
  `src/utils/mapPinImages.ts` (`{ "🍺": require(".../1f37a.png"), … }`).

### Rendering (`MapboxPlacesMap`)
- `<Images images={PIN_IMAGES} />` registers the bundled pins by emoji name.
- One `SymbolLayer`:
  - `iconImage: ["get","emoji"]`
  - `iconSize` tuned so the pin renders ~34px (72px asset → ~0.5).
  - `iconAllowOverlap: false` → **native collision = the zoom de-clutter.**
  - `symbolSortKey: ["*", -1, ["get","priority"]]` → events, then notability, win
    collisions (notability tiers).
  - `textField` count badge on the **same** symbol (`textOptional`) so a badge
    never floats without its pin. Numbers render fine (they're in the glyph font).
- **Selection ring** sized to the pin (`circleRadius ~22`), on an always-mounted
  source whose shape swaps on tap (the snappy-select fix stays).
- **Safety:** static `require` images are the reliable path, but if an image is
  ever missing, `onImageMissing` logs it and that one pin is simply absent — the
  map never goes fully blank because the layer + other pins still render.

## Testing (before shipping)
Because there is no iOS simulator on this dev box, validate everything testable:
1. **Asset completeness** — a Jest test asserts every emoji `emojiForItem` can
   return has a `PIN_IMAGES` entry (and the asset file exists).
2. **Data** — `toFeatureCollection` yields the right `emoji`/`count`/`priority`.
3. **Expression validity** — validate the Mapbox layer expressions with
   `@mapbox/mapbox-gl-style-spec` (catches the class of error that blanks a layer).
4. **Visual render** — render the exact style + sample data headlessly
   (MapLibre GL JS via Puppeteer, no basemap needed) to PNGs at zoom 10/12/14 and
   eyeball that pins draw and that collision thins them when zoomed out.
Only after these pass does the change go out (as a verified OTA to build #26).

## Rollout
- JS + assets only (native module already in build #26) → ship via the
  isolate-and-grep **verified OTA** (targets fingerprint `7bef7ff`).
- Once approved on-device, merge `feat/map-emoji-icons` → `staging` so the next
  native build embeds it; carries into the gated prod promotion.

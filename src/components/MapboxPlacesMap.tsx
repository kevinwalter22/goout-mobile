import React, { useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import Mapbox, {
  MapView,
  Camera,
  ShapeSource,
  SymbolLayer,
  CircleLayer,
  Images,
  LocationPuck,
} from "@rnmapbox/maps";
import { Colors } from "../config/theme";
import { aggregateToPlaces, placePriority } from "../lib/mapPlaces";
import { nearestRepId } from "../lib/mapTap";
import { computePostableNow } from "../lib/postableNow";
import { MAP_PIN_IMAGES } from "../utils/mapPinImages";
import type { MapRegion } from "../utils/mapViewport";
import type { ExploreItem } from "../types/database";

// One-time SDK token (public — safe in the client). Restricted to the map SKU.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "");

// Reused for the "nothing selected" state so a ShapeSource stays mounted (updating
// a shape is far cheaper than mounting a native source+layer on every tap).
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

// Fallback pin for any emoji without a bundled image (📍 is always in the set) —
// guarantees every place resolves to a real iconImage, so a pin is never missing.
const FALLBACK_EMOJI = "📍";
const iconFor = (emoji: string): string => (MAP_PIN_IMAGES[emoji] ? emoji : FALLBACK_EMOJI);

// One ring language. Every ring is the SAME size + SAME translucent inner; only
// the stroke colour/width changes: postable = brand purple ("you can post here"),
// selected-but-not-postable = a neutral charcoal focus ring. A postable pin that
// is also selected just gets a BOLDER purple ring — never a second ring.
const RING_RADIUS = 22;
const RING_INNER = "rgba(255,255,255,0.16)";
const RING_PURPLE = Colors.primary;
const RING_CHARCOAL = "#4B5563"; // dark gray, not black (black read too heavy on-device)
const RING_WIDTH = 3;
const RING_WIDTH_BOLD = 5.5;

type Props = {
  items: ExploreItem[]; // mappable items in scope (events + activities)
  initialCenter: { lat: number; lng: number };
  initialZoom?: number;
  selectedItemId: string | null;
  userLocation: { lat: number; lng: number } | null;
  showUserDot: boolean;
  /** Fired when the map settles (pan/zoom end) with a MapRegion for the fetch layer. */
  onRegionChange: (region: MapRegion) => void;
  /** Fired when a place is tapped — gives the representative item for the preview. */
  onSelectItem: (item: ExploreItem | null) => void;
  itemById: Map<string, ExploreItem>;
  /** Double-tap a postable pin → straight to the post camera (T8 parity). */
  onCameraShortcut?: (item: ExploreItem) => void;
};

// GeoJSON FeatureCollection of PLACES (one feature per venue/coordinate). Each
// feature carries `postable` — whether the user is at the place AND its
// representative item is available to post right now (computePostableNow) — which
// drives the postable halo + the double-tap-to-camera gesture (T8).
function toFeatureCollection(
  items: ExploreItem[],
  itemById: Map<string, ExploreItem>,
  userLocation: { lat: number; lng: number } | null,
) {
  const places = aggregateToPlaces(items);
  const postableRepIds = new Set<string>();
  return {
    fc: {
      type: "FeatureCollection" as const,
      features: places.map((p) => {
        const repId = p.itemIds[0];
        const repItem = itemById.get(repId);
        const postable = repItem
          ? computePostableNow(repItem, userLocation).isPostable
          : false;
        if (postable) postableRepIds.add(repId);
        return {
          type: "Feature" as const,
          id: p.id,
          geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
          properties: {
            id: p.id,
            // icon = the emoji's bundled pin (or the fallback pin) — always a valid image key
            icon: iconFor(p.emoji),
            count: p.eventCount,
            // Higher priority is placed FIRST and therefore WINS native collision
            // when pins overlap. Events rank above venues, then by notability — so
            // zoomed out you see the notable few, and the long tail fills in as the
            // map de-densifies on zoom-in. (Mapbox draws lowest sort-key first, so
            // the value is negated where it's used as symbolSortKey.)
            priority: placePriority(p),
            repId,
            allIds: p.itemIds.join(","),
            postable,
          },
        };
      }),
    },
    places,
    postableRepIds,
  };
}

export function MapboxPlacesMap({
  items,
  initialCenter,
  initialZoom = 12,
  selectedItemId,
  userLocation,
  showUserDot,
  onRegionChange,
  onSelectItem,
  itemById,
  onCameraShortcut,
}: Props) {
  const mapRef = useRef<MapView>(null);
  // Timestamp of the last pin tap — used to swallow the map's deselect-on-tap
  // that can pair with a pin tap and undo the selection (the "took 3 tries" feel).
  const lastPinTapRef = useRef(0);

  const { fc, postableRepIds } = useMemo(
    () => toFeatureCollection(items, itemById, userLocation),
    [items, itemById, userLocation],
  );

  // HIGHLIGHT set = postable pins ∪ the selected pin, rendered in ONE dedicated
  // layer that force-shows the pin (iconIgnorePlacement) so a ring is ALWAYS
  // coupled to a visible pin — no orphan rings when the map declutters. The ring
  // colour/width is data-driven from `postable`/`selected` so every item shows
  // exactly ONE ring. This source is tiny (a handful of features), so rebuilding
  // it on selection is cheap — unlike the full `places` source (that was ~1s lag).
  const highlightShape = useMemo(() => {
    const features = fc.features
      .filter((f) => {
        const isSelected =
          !!selectedItemId &&
          (f.properties.allIds as string).split(",").includes(selectedItemId);
        return f.properties.postable === true || isSelected;
      })
      .map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          selected:
            !!selectedItemId &&
            (f.properties.allIds as string).split(",").includes(selectedItemId),
        },
      }));
    return features.length
      ? { type: "FeatureCollection" as const, features }
      : EMPTY_FC;
  }, [fc, selectedItemId]);

  // Double-tap → post, via react-native-gesture-handler. We deliberately do NOT
  // detect double-taps from the map's onPress: iOS's native double-tap recognizer
  // CLAIMS the gesture (for zoom), so a second onPress never fires — that's why
  // the earlier timing approach couldn't work. RNGH recognizes the double-tap
  // independently. We KEEP Mapbox's native double-tap-zoom ON (empty-map +
  // non-postable double-taps still zoom, 100% reliably) and RNGH only ADDS
  // "double-tap a postable pin → post". Worst case (RNGH misses) it just zooms —
  // never a dead gesture — and the preview card's "Post here now" button is always
  // the guaranteed path.
  const handleDoubleTapPost = useCallback(
    async (x: number, y: number) => {
      if (!onCameraShortcut) return;
      try {
        // A ~48pt box around the tap is forgiving about landing on a 36pt pin.
        const box: [number, number, number, number] = [y - 24, x - 24, y + 24, x + 24];
        const res = await (mapRef.current as any)?.queryRenderedFeaturesInRect(
          box,
          [],
          ["highlight-pin"],
        );
        for (const feat of res?.features ?? []) {
          const repId = feat?.properties?.repId as string | undefined;
          if (repId && postableRepIds.has(repId)) {
            const item = itemById.get(repId);
            if (item) {
              onCameraShortcut(item);
              return;
            }
          }
        }
      } catch {
        // best-effort — the "Post here now" button is the guaranteed fallback
      }
    },
    [onCameraShortcut, postableRepIds, itemById],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(320)
        .onEnd((e) => {
          runOnJS(handleDoubleTapPost)(e.x, e.y);
        }),
    [handleDoubleTapPost],
  );

  const handleIdle = async (feat: any) => {
    const p: any = feat?.properties || {};
    const bounds = p.visibleBounds as [[number, number], [number, number]] | undefined; // [[neLng,neLat],[swLng,swLat]]
    const center = (feat.geometry?.coordinates as [number, number]) || [initialCenter.lng, initialCenter.lat];
    let latDelta = 0.08;
    let lngDelta = 0.08;
    if (bounds) {
      latDelta = Math.abs(bounds[0][1] - bounds[1][1]);
      lngDelta = Math.abs(bounds[0][0] - bounds[1][0]);
    }
    onRegionChange({
      latitude: center[1],
      longitude: center[0],
      latitudeDelta: latDelta || 0.08,
      longitudeDelta: lngDelta || 0.08,
    });
  };

  const handlePlacePress = (e: any) => {
    lastPinTapRef.current = Date.now();
    const repId = nearestRepId(e?.features, e?.coordinates);
    const item = repId ? itemById.get(repId) : undefined;
    if (item) onSelectItem(item); // a resolved pin tap always selects; never deselects
  };

  return (
    <GestureDetector gesture={doubleTap}>
      <View style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          styleURL={Mapbox.StyleURL.Street}
          scaleBarEnabled={false}
          // Mapbox attribution + logo are REQUIRED to stay visible (ToS) but MAY be
          // repositioned. Logo sits in the bottom-LEFT corner; the attribution "ⓘ"
          // moves to the TOP-RIGHT — both clear of the bottom-right FAB. Do NOT disable.
          logoEnabled
          attributionEnabled
          logoPosition={{ bottom: 8, left: 8 }}
          attributionPosition={{ top: -4, right: 0 }}
          onPress={() => {
            // Ignore the map-level tap that immediately follows a pin tap (they can
            // both fire), which would otherwise deselect what you just selected.
            if (Date.now() - lastPinTapRef.current < 250) return;
            onSelectItem(null);
          }}
          onMapIdle={handleIdle as any}
        >
          <Camera
            defaultSettings={{
              centerCoordinate: [initialCenter.lng, initialCenter.lat],
              zoomLevel: initialZoom,
            }}
            animationDuration={0}
          />

          {/* Bundled emoji-disc pins (static require assets — the reliable image
              path). Referenced by name from the symbol layer via iconImage. */}
          <Images
            images={MAP_PIN_IMAGES}
            onImageMissing={(name) => {
              if (__DEV__) console.warn("[map] missing pin image for", name);
            }}
          />

          <ShapeSource
            id="places"
            shape={fc}
            onPress={handlePlacePress}
            hitbox={{ width: 48, height: 48 }}
          >
            {/* One symbol per place: emoji-disc icon + optional event-count badge.
                iconAllowOverlap:false is the native collision that de-clutters when
                zoomed out; symbolSortKey (=-priority) decides who survives — events
                and notable venues win, the long tail fills in on zoom-in. The badge
                rides on the same symbol (textOptional) so it never floats alone. */}
            <SymbolLayer
              id="place-pin"
              style={{
                iconImage: ["get", "icon"],
                iconSize: 0.5, // 72px asset -> ~36pt pin
                iconAllowOverlap: false,
                iconOptional: false,
                iconPadding: 4,
                symbolSortKey: ["*", -1, ["get", "priority"]],
                textField: [
                  "case",
                  [">", ["get", "count"], 1],
                  ["to-string", ["get", "count"]],
                  "",
                ],
                textSize: 11,
                textColor: "#ffffff",
                textHaloColor: Colors.primaryDark,
                textHaloWidth: 2,
                textOffset: [0.9, -0.9],
                textAllowOverlap: true,
                textOptional: true,
              }}
            />
          </ShapeSource>

          {/* Highlight layer — postable pins ∪ the selected pin. The ring is drawn
              first (under), then the pin is RE-DRAWN with collision disabled (on
              top) so the ring is always coupled to a visible pin: the ring can
              never orphan, because its pin is force-shown right here with it.
              circleStrokeColor/Width are data-driven → exactly one ring per item:
              postable = purple (bolder when selected), else = charcoal. */}
          <ShapeSource id="highlight" shape={highlightShape}>
            <CircleLayer
              id="highlight-ring"
              style={{
                circleRadius: RING_RADIUS,
                circleColor: RING_INNER,
                circleStrokeColor: [
                  "case",
                  ["==", ["get", "postable"], true],
                  RING_PURPLE,
                  RING_CHARCOAL,
                ],
                circleStrokeWidth: [
                  "case",
                  ["all", ["==", ["get", "postable"], true], ["==", ["get", "selected"], true]],
                  RING_WIDTH_BOLD,
                  RING_WIDTH,
                ],
                circlePitchAlignment: "map",
              }}
            />
            <SymbolLayer
              id="highlight-pin"
              style={{
                iconImage: ["get", "icon"],
                iconSize: 0.5,
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
                textField: [
                  "case",
                  [">", ["get", "count"], 1],
                  ["to-string", ["get", "count"]],
                  "",
                ],
                textSize: 11,
                textColor: "#ffffff",
                textHaloColor: Colors.primaryDark,
                textHaloWidth: 2,
                textOffset: [0.9, -0.9],
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </ShapeSource>

          {/* T7 — native blue current-location puck for normal users (was missing
              after the @rnmapbox switch; only the override/dev purple dot existed).
              Shown only when NOT using the override dot, so override/dev accounts
              (whose device GPS differs from their forced coords) don't get two markers. */}
          {!showUserDot && <LocationPuck visible puckBearing="heading" pulsing={{ isEnabled: true }} />}

          {/* "You are here" (review/override account). */}
          {showUserDot && userLocation && (
            <ShapeSource
              id="user"
              shape={{
                type: "FeatureCollection",
                features: [
                  {
                    type: "Feature",
                    properties: {},
                    geometry: { type: "Point", coordinates: [userLocation.lng, userLocation.lat] },
                  },
                ],
              }}
            >
              <CircleLayer
                id="user-dot"
                style={{
                  circleRadius: 7,
                  circleColor: Colors.primary,
                  circleStrokeColor: "#ffffff",
                  circleStrokeWidth: 3,
                }}
              />
            </ShapeSource>
          )}
        </MapView>
      </View>
    </GestureDetector>
  );
}

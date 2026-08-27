import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Reused for the "nothing" state so a ShapeSource stays mounted (updating a shape
// is far cheaper than mounting a native source+layer on every change).
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

// Fallback pin for any emoji without a bundled image (📍 is always in the set) —
// guarantees every place resolves to a real iconImage, so a pin is never missing.
const FALLBACK_EMOJI = "📍";
const iconFor = (emoji: string): string => (MAP_PIN_IMAGES[emoji] ? emoji : FALLBACK_EMOJI);

// One ring language: every ring is the SAME size + SAME translucent inner; only the
// stroke colour/width changes. Postable = brand purple ("you can post here"), and a
// selected postable ring just gets BOLDER (never a second ring). Selected-but-not-
// postable = a neutral charcoal focus ring (dark gray, not black).
const RING_RADIUS = 22;
const RING_INNER = "rgba(255,255,255,0.16)";
const RING_PURPLE = Colors.primary;
const RING_CHARCOAL = "#4B5563";
const RING_WIDTH = 3;
const RING_WIDTH_BOLD = 5.5;

// How close (screen px) a double-tap must land to a postable pin to count as a hit.
const PIN_HIT_RADIUS = 30;

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
// representative item is available to post right now (computePostableNow).
function toFeatureCollection(
  items: ExploreItem[],
  itemById: Map<string, ExploreItem>,
  userLocation: { lat: number; lng: number } | null,
) {
  const places = aggregateToPlaces(items);
  const postableRepIds = new Set<string>();
  const postablePlaces: { lng: number; lat: number; repId: string }[] = [];
  const fc = {
    type: "FeatureCollection" as const,
    features: places.map((p) => {
      const repId = p.itemIds[0];
      const repItem = itemById.get(repId);
      const postable = repItem
        ? computePostableNow(repItem, userLocation).isPostable
        : false;
      if (postable) {
        postableRepIds.add(repId);
        postablePlaces.push({ lng: p.lng, lat: p.lat, repId });
      }
      return {
        type: "Feature" as const,
        id: p.id,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          // icon = the emoji's bundled pin (or the fallback pin) — always a valid image key
          icon: iconFor(p.emoji),
          count: p.eventCount,
          // Higher priority is placed FIRST and therefore WINS native collision when
          // pins overlap. Events rank above venues, then by notability — so zoomed out
          // you see the notable few, and the long tail fills in on zoom-in. (Mapbox
          // draws lowest sort-key first, so the value is negated as symbolSortKey.)
          priority: placePriority(p),
          repId,
          allIds: p.itemIds.join(","),
          postable,
        },
      };
    }),
  };
  return { fc, places, postableRepIds, postablePlaces };
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
  const cameraRef = useRef<Camera>(null);
  // Timestamp of the last pin tap — used to swallow the map's deselect-on-tap that
  // can pair with a pin tap and undo the selection (the "took 3 tries" feel).
  const lastPinTapRef = useRef(0);

  const { fc, postablePlaces } = useMemo(
    () => toFeatureCollection(items, itemById, userLocation),
    [items, itemById, userLocation],
  );

  // Ids of place-pins that actually RENDERED (survived native collision) at the
  // current camera — queried on idle. null = "not queried yet / just changed" →
  // show all postable rings (avoids a first-paint gap); after the query it's the
  // real rendered set, so a postable ring declutters WITH its pin (no orphan).
  const [renderedIds, setRenderedIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    setRenderedIds(null); // new data → show all, next idle prunes to what rendered
  }, [fc]);

  const isSelected = useCallback(
    (f: any) =>
      !!selectedItemId &&
      (f.properties.allIds as string).split(",").includes(selectedItemId),
    [selectedItemId],
  );

  // Postable rings for NON-selected postable pins that are on-screen (renderedIds).
  // No force-show: the pin lives in the collision-managed `places` layer and
  // declutters normally; the ring is filtered to the same rendered set so it
  // appears/disappears exactly with its pin.
  const postableRingShape = useMemo(() => {
    const features = fc.features.filter((f) => {
      if (f.properties.postable !== true) return false;
      if (renderedIds != null && !renderedIds.has(String(f.properties.id))) return false;
      if (isSelected(f)) return false; // selected pin's ring is drawn by the selection layer
      return true;
    });
    return features.length ? { type: "FeatureCollection" as const, features } : EMPTY_FC;
  }, [fc, renderedIds, isSelected]);

  // The selected place (1 feature or empty) — carries `postable` so its ring picks
  // the right colour/width. The selected pin is force-shown (below) so it stays put
  // while you're previewing it.
  const selectedShape = useMemo(() => {
    if (!selectedItemId) return EMPTY_FC;
    const sel = fc.features.find((f) =>
      (f.properties.allIds as string).split(",").includes(selectedItemId),
    );
    return sel ? { type: "FeatureCollection" as const, features: [sel] } : EMPTY_FC;
  }, [fc, selectedItemId]);

  // DOUBLE-TAP handling. The map's native onPress never fires twice for a double-tap
  // (iOS's double-tap recognizer claims it), so detection MUST come from RNGH. And
  // the native double-tap-zoom recognizer CANCELS RNGH's gesture — so we disable it
  // (gestureSettings below) and re-implement zoom here. Net (matching Kevin's model):
  // double-tap a postable pin → post; double-tap anywhere else → zoom in.
  const handleDoubleTap = useCallback(
    async (x: number, y: number) => {
      const map: any = mapRef.current;
      if (!map) return;
      try {
        // Postable-pin hit-test by projecting each postable place to the screen
        // (few of them) — more reliable than a rendered-feature query for a tap.
        if (onCameraShortcut) {
          for (const pl of postablePlaces) {
            const pt = await map.getPointInView([pl.lng, pl.lat]);
            if (pt && Math.hypot(pt[0] - x, pt[1] - y) <= PIN_HIT_RADIUS) {
              const item = itemById.get(pl.repId);
              if (item) {
                onCameraShortcut(item);
                return;
              }
            }
          }
        }
        // Not on a postable pin → zoom in toward the tap (native double-tap-zoom is
        // disabled, so we drive the camera ourselves).
        const coord = await map.getCoordinateFromView([x, y]);
        const z = await map.getZoom();
        if (coord && typeof z === "number") {
          cameraRef.current?.setCamera({
            centerCoordinate: coord,
            zoomLevel: z + 1,
            animationDuration: 220,
          });
        }
      } catch {
        // best-effort — the preview card's "Post here now" button + pinch-zoom remain
      }
    },
    [postablePlaces, itemById, onCameraShortcut],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(300)
        .onEnd((e) => {
          runOnJS(handleDoubleTap)(e.x, e.y);
        }),
    [handleDoubleTap],
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

    // #2 — tie postable rings to pins that actually rendered. Query the place-pin
    // layer (pass [] filter, NOT null — that was the earlier bug) for what survived
    // collision at this camera; postableRingShape filters to this set.
    try {
      const rendered = await (mapRef.current as any)?.queryRenderedFeaturesInRect(
        [],
        [],
        ["place-pin"],
      );
      const ids = new Set<string>();
      for (const f of rendered?.features ?? []) {
        const id = (f?.properties as any)?.id;
        if (id != null) ids.add(String(id));
      }
      setRenderedIds(ids);
    } catch {
      // best-effort — leave the last set (or show-all null)
    }
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
          // repositioned. Logo bottom-LEFT; the attribution "ⓘ" top-RIGHT — both clear
          // of the bottom-right FAB. Do NOT disable them.
          logoEnabled
          attributionEnabled
          logoPosition={{ bottom: 8, left: 8 }}
          attributionPosition={{ top: -4, right: 0 }}
          // Disable Mapbox's native double-tap-zoom: it competes with + cancels the
          // RNGH double-tap (that's why the pin double-tap never fired). We re-drive
          // zoom ourselves in handleDoubleTap. Pinch + two-finger zoom-out untouched.
          gestureSettings={{ doubleTapToZoomInEnabled: false }}
          onPress={() => {
            // Ignore the map-level tap that immediately follows a pin tap (they can
            // both fire), which would otherwise deselect what you just selected.
            if (Date.now() - lastPinTapRef.current < 250) return;
            onSelectItem(null);
          }}
          onMapIdle={handleIdle as any}
        >
          <Camera
            ref={cameraRef}
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

          {/* Postable halo — drawn UNDER the pins, only for non-selected postable
              pins that are currently rendered (renderedIds), so it declutters with
              its pin. Normal-width purple; the selected postable pin's (bolder) ring
              comes from the selection layer instead. */}
          <ShapeSource id="postable-ring-src" shape={postableRingShape}>
            <CircleLayer
              id="postable-ring"
              style={{
                circleRadius: RING_RADIUS,
                circleColor: RING_INNER,
                circleStrokeColor: RING_PURPLE,
                circleStrokeWidth: RING_WIDTH,
                circlePitchAlignment: "map",
              }}
            />
          </ShapeSource>

          <ShapeSource
            id="places"
            shape={fc}
            onPress={handlePlacePress}
            hitbox={{ width: 48, height: 48 }}
          >
            {/* One symbol per place: emoji-disc icon + optional event-count badge.
                iconAllowOverlap:false is the native collision that de-clutters when
                zoomed out; symbolSortKey (=-priority) decides who survives. Postable
                pins live here too, so they declutter exactly like everything else. */}
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

          {/* Selection layer — always mounted (empty until a pin is tapped), drawn
              ON TOP with the pin force-shown so a selected place stays put while you
              preview it. ONE ring: bold purple if the selected place is postable,
              else a charcoal focus ring — same size + inner as the postable halo. */}
          <ShapeSource id="selected-place" shape={selectedShape}>
            <CircleLayer
              id="selected-ring"
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
                  ["==", ["get", "postable"], true],
                  RING_WIDTH_BOLD,
                  RING_WIDTH,
                ],
                circlePitchAlignment: "map",
              }}
            />
            <SymbolLayer
              id="selected-pin"
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

          {/* T7 — native blue current-location puck for normal users. Shown only when
              NOT using the override dot, so override/dev accounts don't get two markers. */}
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

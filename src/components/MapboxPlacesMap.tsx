import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
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

// Reused for the "nothing selected" state so the selection ShapeSource stays
// mounted (updating a shape is far cheaper than mounting a native source+layer on
// every tap — that was the ~1s selection lag).
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

// Fallback pin for any emoji without a bundled image (📍 is always in the set) —
// guarantees every place resolves to a real iconImage, so a pin is never missing.
const FALLBACK_EMOJI = "📍";
const iconFor = (emoji: string): string => (MAP_PIN_IMAGES[emoji] ? emoji : FALLBACK_EMOJI);

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
// feature also carries `postable` — whether the user is at the place AND its
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
  const cameraRef = useRef<Camera>(null);
  // Timestamp of the last pin tap — used to swallow the map's deselect-on-tap
  // that can pair with a pin tap and undo the selection (the "took 3 tries" feel).
  const lastPinTapRef = useRef(0);
  // Empty-map double-tap tracking — we disable Mapbox's native double-tap-zoom (so
  // a pin double-tap reaches onPress instead of being eaten by zoom) and
  // re-implement the empty-map zoom here.
  const lastMapTapRef = useRef(0);
  // Double-tap tracking: the id + time of the last SELECTING tap. A second tap on
  // the same postable pin within the window fires the camera shortcut. Selection
  // itself is never delayed, so the snappy single-tap select is preserved.
  const lastSelIdRef = useRef<string | null>(null);
  const lastSelAtRef = useRef(0);

  const { fc, postableRepIds } = useMemo(
    () => toFeatureCollection(items, itemById, userLocation),
    [items, itemById, userLocation],
  );

  // Ids of place-pins that actually RENDERED (survived native collision) at the
  // current camera — queried on idle. null = "not queried yet" → show all postable
  // (avoids a first-paint gap). Tying the halo to this set means a postable ring
  // disappears together with its pin when the map declutters (no orphan rings).
  const [renderedIds, setRenderedIds] = useState<Set<string> | null>(null);
  // New data → show all postable again, then the next idle prunes to what rendered.
  useEffect(() => {
    setRenderedIds(null);
  }, [fc]);

  // Postable places as their own shape — drives a halo drawn UNDER the pins, gated
  // to pins that are currently on-screen (renderedIds) so the ring never orphans.
  const postableShape = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: fc.features.filter(
        (f) =>
          f.properties.postable &&
          (renderedIds == null || renderedIds.has(String(f.properties.id))),
      ),
    }),
    [fc, renderedIds],
  );

  // Selected place as a 1-feature shape (or empty). The source stays mounted; we
  // only swap the shape, so the ring appears immediately on tap.
  const selectedShape = useMemo(() => {
    if (!selectedItemId) return EMPTY_FC;
    const sel = fc.features.find((f) =>
      (f.properties.allIds as string).split(",").includes(selectedItemId)
    );
    return sel ? { type: "FeatureCollection" as const, features: [sel] } : EMPTY_FC;
  }, [fc, selectedItemId]);

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

    // #5 — tie postable rings to pins that actually rendered. Query the place-pin
    // layer for what survived collision at this camera; the halo shape filters to
    // this set, so a ring vanishes with its pin when the map declutters.
    try {
      const rendered = await (mapRef.current as any)?.queryRenderedFeaturesInRect(
        [],
        null,
        ["place-pin"],
      );
      const ids = new Set<string>();
      for (const f of rendered?.features ?? []) {
        const id = (f?.properties as any)?.id;
        if (id != null) ids.add(String(id));
      }
      setRenderedIds(ids);
    } catch {
      // query is best-effort — on failure leave the last set (or the show-all null)
    }
  };

  const handlePlacePress = (e: any) => {
    const now = Date.now();
    lastPinTapRef.current = now;
    const repId = nearestRepId(e?.features, e?.coordinates);
    const item = repId ? itemById.get(repId) : undefined;
    if (!item || !repId) return;
    // Double-tap a postable pin (already selected, tapped again quickly) → camera.
    if (
      onCameraShortcut &&
      postableRepIds.has(repId) &&
      lastSelIdRef.current === item.id &&
      now - lastSelAtRef.current < 400
    ) {
      lastSelIdRef.current = null;
      onCameraShortcut(item);
      return;
    }
    // First tap (or a slow second tap) → select immediately; arm the double-tap.
    lastSelIdRef.current = item.id;
    lastSelAtRef.current = now;
    onSelectItem(item); // a resolved pin tap always selects; never deselects
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        styleURL={Mapbox.StyleURL.Street}
        scaleBarEnabled={false}
        // Mapbox attribution + logo are REQUIRED to stay visible (ToS) but MAY be
        // repositioned. Logo sits in the bottom-LEFT corner; the attribution "ⓘ" moves
        // to the TOP-RIGHT — both clear of the bottom-right FAB. Do NOT disable them.
        logoEnabled
        attributionEnabled
        logoPosition={{ bottom: 8, left: 8 }}
        attributionPosition={{ top: -4, right: 0 }}
        // Disable Mapbox's NATIVE double-tap-to-zoom so it stops eating the second
        // tap on a pin (that's why double-tapping a postable pin zoomed instead of
        // posting). Pinch-zoom + two-finger zoom-out stay on; the empty-map
        // double-tap-to-zoom is re-implemented in onPress below so normal map zoom
        // is preserved.
        gestureSettings={{ doubleTapToZoomInEnabled: false }}
        onPress={async (feature: any) => {
          const now = Date.now();
          // Ignore the map-level tap that immediately follows a pin tap (they can
          // both fire), which would otherwise deselect what you just selected.
          if (now - lastPinTapRef.current < 250) return;
          const coord = feature?.geometry?.coordinates as [number, number] | undefined;
          // Empty-map DOUBLE-tap → zoom in toward the tap point (re-implements the
          // native gesture we disabled above; keeps "double-tap empty map zooms").
          if (coord && now - lastMapTapRef.current < 300) {
            lastMapTapRef.current = 0;
            try {
              const z = (await (mapRef.current as any)?.getZoom?.()) ?? initialZoom;
              cameraRef.current?.setCamera({
                centerCoordinate: coord,
                zoomLevel: z + 1,
                animationDuration: 220,
              });
            } catch {
              // zoom is best-effort
            }
            return;
          }
          lastMapTapRef.current = now;
          onSelectItem(null); // single tap → deselect
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

        {/* Postable halo — a purple glow UNDER pins you're at + can post to right
            now (T8). Own source so it renders below the collision-managed pins and
            never orphans. Distinct from the selection ring (darker/thicker). */}
        <ShapeSource id="postable-places" shape={postableShape}>
          <CircleLayer
            id="postable-ring"
            style={{
              circleRadius: 22,
              circleColor: "rgba(124,58,237,0.16)",
              circleStrokeColor: Colors.primary,
              circleStrokeWidth: 2.5,
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

        {/* Selection layer — always mounted (empty until a pin is tapped), drawn
            ON TOP of the places layer. It carries BOTH the ring AND the selected
            pin with collision disabled, so the selected place stays put when you
            zoom out even if it would otherwise be collision-dropped. Deselecting
            empties the shape, so the pin then follows normal collision again.
            The selected ring is a NEUTRAL dark focus ring (not purple) — purple is
            reserved for the "postable now" halo so the two states never read alike. */}
        <ShapeSource id="selected-place" shape={selectedShape}>
          <CircleLayer
            id="selected-ring"
            style={{
              circleRadius: 25,
              circleColor: "rgba(255,255,255,0.18)",
              circleStrokeColor: "#111827",
              circleStrokeWidth: 3.5,
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

        {/* T7 — native blue current-location puck for normal users (was missing
            after the @rnmapbox switch; only the override/dev purple dot existed).
            Shown only when NOT using the override dot, so override/dev accounts (whose
            device GPS differs from their forced coords) don't get two markers. */}
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
  );
}

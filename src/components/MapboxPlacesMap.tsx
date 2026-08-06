import React, { useMemo, useRef } from "react";
import { View } from "react-native";
import Mapbox, {
  MapView,
  Camera,
  ShapeSource,
  SymbolLayer,
  CircleLayer,
} from "@rnmapbox/maps";
import { Colors } from "../config/theme";
import { aggregateToPlaces, placePriority } from "../lib/mapPlaces";
import type { MapRegion } from "../utils/mapViewport";
import type { ExploreItem } from "../types/database";

// One-time SDK token (public — safe in the client). Restricted to the map SKU.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "");

// Reused for the "nothing selected" state so the selection ShapeSource stays
// mounted (updating a shape is far cheaper than mounting a native source+layer on
// every tap — that was the ~1s selection lag).
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

// Pin colors. Event-places read in Euda purple; browsable venues are a calmer
// slate so events pop. (Emoji glyphs come back as bundled icon images in a
// follow-up — Mapbox text/`Image`-view rendering can't show color emoji here.)
const EVENT_COLOR = Colors.primary;
const VENUE_COLOR = "#7C8DA6";

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
};

// GeoJSON FeatureCollection of PLACES (one feature per venue/coordinate).
function toFeatureCollection(items: ExploreItem[]) {
  const places = aggregateToPlaces(items);
  return {
    fc: {
      type: "FeatureCollection" as const,
      features: places.map((p) => ({
        type: "Feature" as const,
        id: p.id,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          emoji: p.emoji,
          count: p.eventCount,
          hasEvents: p.hasEvents ? 1 : 0,
          // Higher priority is drawn on top (events, then notability), so the
          // notable pins win visually where things are dense.
          priority: placePriority(p),
          repId: p.itemIds[0],
          allIds: p.itemIds.join(","),
        },
      })),
    },
    places,
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
}: Props) {
  const mapRef = useRef<MapView>(null);

  const { fc } = useMemo(() => toFeatureCollection(items), [items]);

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
  };

  const handlePlacePress = (e: any) => {
    const f = e?.features?.[0];
    const repId: string | undefined = f?.properties?.repId;
    const item = repId ? itemById.get(repId) : undefined;
    onSelectItem(item ?? null);
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        styleURL={Mapbox.StyleURL.Street}
        scaleBarEnabled={false}
        onPress={() => onSelectItem(null)}
        onMapIdle={handleIdle as any}
      >
        <Camera
          defaultSettings={{
            centerCoordinate: [initialCenter.lng, initialCenter.lat],
            zoomLevel: initialZoom,
          }}
          animationDuration={0}
        />

        {/* Selection ring — always mounted, empty until a pin is tapped. */}
        <ShapeSource id="selected-place" shape={selectedShape}>
          <CircleLayer
            id="selected-ring"
            style={{
              circleRadius: 18,
              circleColor: "rgba(0,0,0,0)",
              circleStrokeColor: Colors.primaryDark,
              circleStrokeWidth: 3,
              circlePitchAlignment: "map",
            }}
          />
        </ShapeSource>

        <ShapeSource id="places" shape={fc} onPress={handlePlacePress}>
          {/* Vector dot per place — always renders (no image dependency). Event
              places are bigger + Euda purple; venues are smaller + slate. Radius
              grows with zoom so the map reads clean when zoomed out and detailed
              when zoomed in. circleSortKey puts high-priority dots on top. */}
          <CircleLayer
            id="place-dot"
            style={{
              circleColor: [
                "case",
                [">", ["get", "count"], 0],
                EVENT_COLOR,
                VENUE_COLOR,
              ],
              circleRadius: [
                "interpolate",
                ["linear"],
                ["zoom"],
                9,
                ["case", [">", ["get", "count"], 0], 5, 3],
                14,
                ["case", [">", ["get", "count"], 0], 10, 7],
              ],
              circleStrokeColor: "#ffffff",
              circleStrokeWidth: 1.5,
              circlePitchAlignment: "map",
              circleSortKey: ["get", "priority"],
            }}
          />
          {/* Event-count badge (numbers render fine in the glyph fonts). */}
          <SymbolLayer
            id="place-count"
            filter={[">", ["get", "count"], 1]}
            style={{
              textField: ["to-string", ["get", "count"]],
              textSize: 10,
              textColor: "#ffffff",
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
        </ShapeSource>

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

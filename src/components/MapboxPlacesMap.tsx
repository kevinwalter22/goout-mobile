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
          priority: placePriority(p),
          // representative item to open on tap = first id (aggregate keeps the
          // venue/top-event first via placePriority ordering upstream)
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

  // The selected place, as its own 1-feature source, so a ring can highlight it
  // without touching the main layer (no churn).
  const selectedFc = useMemo(() => {
    if (!selectedItemId) return null;
    const sel = fc.features.find((f) => (f.properties.allIds as string).split(",").includes(selectedItemId));
    return sel ? { type: "FeatureCollection" as const, features: [sel] } : null;
  }, [fc, selectedItemId]);

  const handleIdle = async (feat: any) => {
    // The idle payload carries the visible bounds + zoom when the camera settles.
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

        <ShapeSource id="places" shape={fc} onPress={handlePlacePress}>
          {/* White pin disc, drawn behind the emoji. circleSortKey mirrors the
              symbol sort so the disc under a kept emoji is the one shown. */}
          <CircleLayer
            id="place-disc"
            style={{
              circleRadius: 15,
              circleColor: "#ffffff",
              circleStrokeColor: Colors.primary,
              circleStrokeWidth: 2,
              circlePitchAlignment: "map",
              circleSortKey: ["*", -1, ["get", "priority"]],
            }}
          />
          {/* Emoji as native text — GPU-rendered, no per-marker views. Native
              collision (textAllowOverlap:false) = Apple-style LOD; higher-priority
              (events first, then notability) win via symbolSortKey. */}
          <SymbolLayer
            id="place-emoji"
            style={{
              textField: ["get", "emoji"],
              textSize: 20,
              textAllowOverlap: false,
              textIgnorePlacement: false,
              textOptional: false,
              symbolSortKey: ["*", -1, ["get", "priority"]],
            }}
          />
          {/* Event-count badge for places with upcoming events. */}
          <SymbolLayer
            id="place-count"
            filter={[">", ["get", "count"], 0]}
            style={{
              textField: ["to-string", ["get", "count"]],
              textSize: 10,
              textColor: "#ffffff",
              textHaloColor: Colors.primaryDark,
              textHaloWidth: 2,
              textOffset: [1.1, -1.1],
              textAllowOverlap: true,
              symbolSortKey: ["*", -1, ["get", "priority"]],
            }}
          />
        </ShapeSource>

        {/* Selection ring — separate source so tapping never disturbs the pins. */}
        {selectedFc && (
          <ShapeSource id="selected-place" shape={selectedFc}>
            <CircleLayer
              id="selected-ring"
              style={{
                circleRadius: 20,
                circleColor: "rgba(0,0,0,0)",
                circleStrokeColor: Colors.primaryDark,
                circleStrokeWidth: 3,
              }}
            />
          </ShapeSource>
        )}

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

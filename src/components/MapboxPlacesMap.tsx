import React, { useMemo, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import Mapbox, {
  MapView,
  Camera,
  ShapeSource,
  SymbolLayer,
  CircleLayer,
  Images,
  Image as MapImage,
} from "@rnmapbox/maps";
import { Colors } from "../config/theme";
import { aggregateToPlaces, placePriority } from "../lib/mapPlaces";
import type { MapRegion } from "../utils/mapViewport";
import type { ExploreItem } from "../types/database";

// One-time SDK token (public — safe in the client). Restricted to the map SKU.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "");

// Empty collection reused for the "nothing selected" state so the selection
// ShapeSource can stay mounted (updating a shape is far cheaper than mounting a
// native source+layer on every tap — that was the ~1s selection lag).
const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

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
          // Higher priority is placed FIRST and therefore WINS native collision
          // when pins overlap. Events rank above venues, then by notability — so
          // zoomed out you see the notable few, and the long tail fills in as the
          // map de-densifies on zoom-in. (Mapbox draws lowest sort-key first, so
          // the value is negated where it's used as symbolSortKey.)
          priority: placePriority(p),
          repId: p.itemIds[0],
          allIds: p.itemIds.join(","),
        },
      })),
    },
    places,
  };
}

// Small round pin: white disc, faint purple ring, emoji centered. Rendered once
// per UNIQUE emoji and referenced by name from the symbol layer (iconImage), so
// there are no per-marker views — the GPU composites the shared images.
function EmojiPin({ emoji }: { emoji: string }) {
  return (
    <View style={styles.pin}>
      <Text style={styles.pinEmoji} allowFontScaling={false}>
        {emoji}
      </Text>
    </View>
  );
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

  // Distinct emojis in view — one shared image per emoji (not per place).
  const uniqueEmojis = useMemo(
    () => Array.from(new Set(fc.features.map((f) => f.properties.emoji as string))),
    [fc]
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

        {/* Register one image per unique emoji. @rnmapbox snapshots each RN view
            to a native image; the symbol layer references them by emoji name. */}
        <Images>
          {uniqueEmojis.map((emoji) => (
            <MapImage key={emoji} name={emoji}>
              <EmojiPin emoji={emoji} />
            </MapImage>
          ))}
        </Images>

        {/* Selection ring — always mounted, empty until a pin is tapped. Drawn
            under the pins so it haloes the selected one without covering it. */}
        <ShapeSource id="selected-place" shape={selectedShape}>
          <CircleLayer
            id="selected-ring"
            style={{
              circleRadius: 22,
              circleColor: "rgba(0,0,0,0)",
              circleStrokeColor: Colors.primaryDark,
              circleStrokeWidth: 3,
              circlePitchAlignment: "map",
            }}
          />
        </ShapeSource>

        <ShapeSource id="places" shape={fc} onPress={handlePlacePress}>
          {/* One symbol per place: emoji-disc icon + optional event-count badge.
              iconAllowOverlap:false is the native collision that de-clutters when
              zoomed out; symbolSortKey (=-priority) decides who survives — events
              and notable venues win, the long tail fills in on zoom-in. The badge
              rides on the same symbol (textOptional) so it never floats alone. */}
          <SymbolLayer
            id="place-pin"
            style={{
              iconImage: ["get", "emoji"],
              iconSize: 0.9,
              iconAllowOverlap: false,
              iconOptional: false,
              iconPadding: 6,
              symbolSortKey: ["*", -1, ["get", "priority"]],
              textField: [
                "case",
                [">", ["get", "count"], 0],
                ["to-string", ["get", "count"]],
                "",
              ],
              textSize: 11,
              textColor: "#ffffff",
              textHaloColor: Colors.primaryDark,
              textHaloWidth: 2,
              textOffset: [0.95, -0.95],
              textAllowOverlap: true,
              textOptional: true,
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

const styles = StyleSheet.create({
  pin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    // subtle lift so pins read against the map
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  pinEmoji: {
    fontSize: 18,
    lineHeight: 22,
    textAlign: "center",
  },
});

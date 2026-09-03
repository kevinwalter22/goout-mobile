import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import Mapbox, { MapView, Camera, ShapeSource, SymbolLayer, Images } from "@rnmapbox/maps";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";
import { MAP_PIN_IMAGES } from "../utils/mapPinImages";
import { aggregatePostsToPlaces, type MapPost, type PostPlace } from "../lib/mapPosts";
import { WhoBeenHereSheet } from "./WhoBeenHereSheet";

// Standalone, reusable SOCIAL map of check-in posts (NOT the Explore discovery map). Given a
// set of check-ins, renders them as aggregated photo bubbles (one per place, latest photo +
// count) with the who's-been-here sheet on tap. Used by the profile map (own + friend) and
// the feed map. The caller passes the posts it already fetched (useUserPosts / usePosts), so
// this component adds NO data access — it inherits the exact visibility of the grid/feed.

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "");

function centroid(places: PostPlace[]): [number, number] {
  if (!places.length) return [-70.2568, 43.6591];
  const lat = places.reduce((s, p) => s + p.lat, 0) / places.length;
  const lng = places.reduce((s, p) => s + p.lng, 0) / places.length;
  return [lng, lat];
}

export function PostsMap({
  posts,
  height = 420,
  emptyLabel = "No check-ins yet",
}: {
  posts: MapPost[];
  height?: number;
  emptyLabel?: string;
}) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<PostPlace | null>(null);

  const places = useMemo(() => aggregatePostsToPlaces(posts), [posts]);
  const byId = useMemo(() => {
    const m = new Map<string, PostPlace>();
    for (const p of places) m.set(p.id, p);
    return m;
  }, [places]);

  // Fit ALL of the user's pins in view on load (not a fixed zoom on the centroid, which
  // lands "in the middle of nowhere" when pins are spread out). defaultSettings applies once
  // on mount — and the map only mounts once posts are loaded (it's behind the toggle), so the
  // bounds are real. Single pin → center on it at a close zoom.
  const cameraDefault = useMemo(() => {
    if (places.length >= 2) {
      const lats = places.map((p) => p.lat);
      const lngs = places.map((p) => p.lng);
      return {
        bounds: {
          ne: [Math.max(...lngs), Math.max(...lats)],
          sw: [Math.min(...lngs), Math.min(...lats)],
          paddingTop: 70,
          paddingBottom: 70,
          paddingLeft: 50,
          paddingRight: 50,
        },
      };
    }
    return { centerCoordinate: centroid(places), zoomLevel: 14 };
  }, [places]);

  const { fc, images } = useMemo(() => {
    const imgs: Record<string, { uri: string }> = {};
    const features = places.map((p) => {
      let pinImage = "";
      if (p.pinImageUrl) {
        pinImage = `pp:${p.id}`;
        imgs[pinImage] = { uri: p.pinImageUrl };
      }
      return {
        type: "Feature" as const,
        id: p.id,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { id: p.id, pinImage, count: p.count },
      };
    });
    return { fc: { type: "FeatureCollection" as const, features }, images: imgs };
  }, [places]);

  if (!posts.length) {
    return (
      <View
        style={{
          height,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: colors.textSecondary }}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={{ height, borderRadius: 12, overflow: "hidden" }}>
      <MapView
        style={{ flex: 1 }}
        styleURL={Mapbox.StyleURL.Street}
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled
        logoPosition={{ bottom: 8, left: 8 }}
        attributionPosition={{ bottom: 8, right: 8 }}
        onPress={() => setSelected(null)}
      >
        <Camera defaultSettings={cameraDefault as any} animationDuration={0} />
        <Images images={{ "📍": MAP_PIN_IMAGES["📍"], ...images }} />
        <ShapeSource
          id="postsmap-src"
          shape={fc}
          hitbox={{ width: 44, height: 44 }}
          onPress={(e: any) => {
            const f = e?.features?.[0];
            const id = f?.properties?.id ?? f?.id;
            const place = id != null ? byId.get(String(id)) : undefined;
            if (place) setSelected(place);
          }}
        >
          <SymbolLayer
            id="postsmap-pin"
            style={{
              iconImage: ["case", ["!=", ["get", "pinImage"], ""], ["get", "pinImage"], "📍"],
              iconSize: 0.5,
              iconAllowOverlap: false,
              iconOptional: false,
              iconPadding: 4,
              textField: ["case", [">", ["get", "count"], 1], ["to-string", ["get", "count"]], ""],
              textSize: 11,
              textColor: "#ffffff",
              textHaloColor: Colors.primary,
              textHaloWidth: 2,
              textOffset: [0.9, -0.9],
              textAllowOverlap: true,
              textOptional: true,
            }}
          />
        </ShapeSource>
      </MapView>
      <WhoBeenHereSheet place={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

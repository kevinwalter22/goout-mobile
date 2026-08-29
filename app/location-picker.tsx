import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Mapbox, { MapView, Camera, ShapeSource, CircleLayer, LocationPuck } from "@rnmapbox/maps";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../src/contexts/ThemeContext";
import { Colors } from "../src/config/theme";
import { resolveLocationPicker, cancelLocationPicker } from "../src/utils/locationPickerStore";
import { requestLocationPermission, getCurrentLocation } from "../src/utils/location";

// One-time SDK token (public — safe in the client), same as the explore map.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "");

const DEFAULT_LAT = 40.7128;
const DEFAULT_LNG = -74.006;
const PICKER_ZOOM = 14; // ~DEFAULT_DELTA 0.05 equivalent

// #6 — Mapbox pin-drop (was react-native-maps / Apple Maps). TAP-TO-DROP only,
// no draggable pin: a draggable @rnmapbox annotation fights the native map pan
// (the RNGH-over-native-map class of flakiness we hit on the explore map), so we
// keep the interaction rock-solid — tap the map to set the pin. The pin is a
// ShapeSource + CircleLayer (repositions instantly on shape update, no native
// annotation reposition bugs). The callback-store contract + both callers
// (create-event, edit-event) are unchanged: we still report {lat, lng}.
export default function LocationPicker() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lat: latParam, lng: lngParam } = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const initialLat = latParam ? parseFloat(latParam) : DEFAULT_LAT;
  const initialLng = lngParam ? parseFloat(lngParam) : DEFAULT_LNG;

  const [pinCoord, setPinCoord] = useState({ latitude: initialLat, longitude: initialLng });
  const cameraRef = useRef<Camera>(null);

  useEffect(() => {
    // Only auto-center if no prior pin coords were passed
    if (latParam || lngParam) return;

    (async () => {
      const { granted } = await requestLocationPermission();
      if (!granted) return;
      const { latitude, longitude, error } = await getCurrentLocation();
      if (error) return;
      setPinCoord({ latitude, longitude });
      cameraRef.current?.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel: PICKER_ZOOM,
        animationDuration: 400,
      });
    })();
  }, []);

  // 1-feature pin shape (Mapbox wants [lng, lat]). Updating the shape repositions
  // the pin cleanly — no draggable annotation involved.
  const pinShape = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: [pinCoord.longitude, pinCoord.latitude] },
        },
      ],
    }),
    [pinCoord.latitude, pinCoord.longitude],
  );

  function handleMapPress(e: any) {
    const coords = e?.geometry?.coordinates as [number, number] | undefined;
    if (!coords) return;
    const [lng, lat] = coords;
    setPinCoord({ latitude: lat, longitude: lng });
  }

  function handleConfirm() {
    resolveLocationPicker({ lat: pinCoord.latitude, lng: pinCoord.longitude });
    router.back();
  }

  function handleCancel() {
    cancelLocationPicker();
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ gestureEnabled: false }} />

      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: insets.top + 12,
          paddingBottom: 12,
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={handleCancel}
          hitSlop={8}
          accessibilityLabel="Cancel"
          accessibilityRole="button"
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "700", color: colors.text }}>
          Drop Pin
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Map */}
      <MapView
        style={{ flex: 1 }}
        styleURL={Mapbox.StyleURL.Street}
        scaleBarEnabled={false}
        // Mapbox attribution + logo are ToS-required (may be repositioned, not hidden).
        logoEnabled
        attributionEnabled
        logoPosition={{ bottom: 8, left: 8 }}
        attributionPosition={{ top: 8, right: 8 }}
        onPress={handleMapPress}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: [initialLng, initialLat], zoomLevel: PICKER_ZOOM }}
          animationDuration={0}
        />

        <LocationPuck visible puckBearing="heading" pulsing={{ isEnabled: true }} />

        {/* Selected-location pin: halo + dot. Repositions on tap via shape update. */}
        <ShapeSource id="picker-pin" shape={pinShape}>
          <CircleLayer
            id="picker-pin-halo"
            style={{ circleRadius: 16, circleColor: "rgba(124,58,237,0.18)", circlePitchAlignment: "map" }}
          />
          <CircleLayer
            id="picker-pin-dot"
            style={{
              circleRadius: 8,
              circleColor: Colors.primary,
              circleStrokeColor: "#ffffff",
              circleStrokeWidth: 3,
            }}
          />
        </ShapeSource>
      </MapView>

      {/* Instruction hint */}
      <View
        style={{
          position: "absolute",
          top: insets.top + 70,
          alignSelf: "center",
          backgroundColor: "rgba(0,0,0,0.55)",
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: 20,
        }}
        pointerEvents="none"
      >
        <Text style={{ color: "#fff", fontSize: 13 }}>Tap the map to set the location</Text>
      </View>

      {/* Confirm button */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 16,
          paddingTop: 16,
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Text style={{ fontSize: 12, color: colors.textTertiary, textAlign: "center", marginBottom: 10 }}>
          {pinCoord.latitude.toFixed(5)}, {pinCoord.longitude.toFixed(5)}
        </Text>
        <Pressable
          onPress={handleConfirm}
          accessibilityLabel="Use this location"
          accessibilityRole="button"
          style={{
            backgroundColor: Colors.primary,
            paddingVertical: 16,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
            Use This Location
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

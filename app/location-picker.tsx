import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../src/contexts/ThemeContext";
import { Colors } from "../src/config/theme";
import { resolveLocationPicker, cancelLocationPicker } from "../src/utils/locationPickerStore";

const DEFAULT_LAT = 40.7128;
const DEFAULT_LNG = -74.006;
const DEFAULT_DELTA = 0.05;

export default function LocationPicker() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lat: latParam, lng: lngParam } = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const initialLat = latParam ? parseFloat(latParam) : DEFAULT_LAT;
  const initialLng = lngParam ? parseFloat(lngParam) : DEFAULT_LNG;

  const [pinCoord, setPinCoord] = useState({ latitude: initialLat, longitude: initialLng });
  const mapRef = useRef<MapView>(null);

  function handleDragEnd(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    setPinCoord(e.nativeEvent.coordinate);
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
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={{
          latitude: initialLat,
          longitude: initialLng,
          latitudeDelta: DEFAULT_DELTA,
          longitudeDelta: DEFAULT_DELTA,
        }}
        onPress={(e) => setPinCoord(e.nativeEvent.coordinate)}
      >
        <Marker
          coordinate={pinCoord}
          draggable
          onDragEnd={handleDragEnd}
          pinColor={Colors.primary}
        />
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
        <Text style={{ color: "#fff", fontSize: 13 }}>Drag the pin or tap to reposition</Text>
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

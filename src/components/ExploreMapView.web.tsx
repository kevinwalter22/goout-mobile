import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import type { ExploreItem } from "../types/database";
import type {
  KindFilter,
  CategoryId,
  PriceBucket,
  TimeWindow,
  DistanceRadius,
} from "../config/exploreFilters";

interface ExploreMapViewProps {
  items: ExploreItem[];
  userLocation: { lat: number; lng: number } | null;
  kindFilter: KindFilter;
  category?: CategoryId;
  priceBucket?: PriceBucket;
  timeWindow?: TimeWindow;
  distance?: DistanceRadius;
  tags?: string[];
}

export function ExploreMapView({ items, kindFilter }: ExploreMapViewProps) {
  const { colors } = useTheme();

  const withLocation = items.filter((i) => i.lat != null && i.lng != null);
  const eventCount = withLocation.filter((i) => i.kind === "event").length;
  const activityCount = withLocation.filter((i) => i.kind === "activity").length;

  function getItemDescription(): string {
    if (kindFilter === "event") return `${eventCount} events with locations`;
    if (kindFilter === "activity") return `${activityCount} activities with locations`;
    return `${eventCount} events and ${activityCount} activities with locations`;
  }

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        padding: 24,
      }}
    >
      <Ionicons name="map-outline" size={48} color={colors.textTertiary} />
      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
        Map View
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: colors.textSecondary,
          textAlign: "center",
        }}
      >
        Map view is available on the mobile app.
      </Text>
      {withLocation.length > 0 && (
        <Text
          style={{
            fontSize: 13,
            color: colors.textTertiary,
            textAlign: "center",
          }}
        >
          {getItemDescription()}
        </Text>
      )}
    </View>
  );
}

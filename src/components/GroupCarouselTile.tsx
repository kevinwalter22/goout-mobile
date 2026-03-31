/**
 * GroupCarouselTile — Single tile in a group card's horizontal carousel
 *
 * 160px wide, compact card with image, title, distance + open-now dot, tags.
 */

import React, { useMemo } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import { Colors } from "../config/theme";
import type { ScoredItem } from "../lib/scoring";
import { getDistanceInMiles } from "../utils/location";
import { getCategoryPlaceholder } from "../utils/categoryPlaceholder";

interface GroupCarouselTileProps {
  item: ScoredItem;
  userLocation: { lat: number; lng: number } | null;
  onPress: (itemId: string) => void;
  onLongPress?: (itemId: string) => void;
}

function GroupCarouselTileInner({
  item,
  userLocation,
  onPress,
  onLongPress,
}: GroupCarouselTileProps) {
  const { colors } = useTheme();

  const distanceText = useMemo(() => {
    if (!userLocation || !item.lat || !item.lng) return null;
    return `${getDistanceInMiles(userLocation.lat, userLocation.lng, item.lat, item.lng).toFixed(1)} mi`;
  }, [userLocation, item.lat, item.lng]);

  const isOpen = item.scoreBreakdown.openNow >= 0.9;
  const tags = (item.tags || []).slice(0, 2);

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      onLongPress={() => onLongPress?.(item.id)}
      style={{
        width: 160,
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      {/* Image — prefer thumbnail, fall back to full image (user-created events only set image_url) */}
      {(item.image_thumb_url || item.image_url) ? (
        <Image
          source={{ uri: item.image_thumb_url ?? item.image_url ?? undefined }}
          style={{ width: 160, height: 120, backgroundColor: colors.border }}
          resizeMode="cover"
        />
      ) : (() => {
        const ph = getCategoryPlaceholder(item);
        return (
          <View
            style={{
              width: 160,
              height: 120,
              backgroundColor: ph.bg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={ph.icon as any} size={36} color={ph.fg} />
          </View>
        );
      })()}

      {/* Content */}
      <View style={{ padding: 8, gap: 4 }}>
        <Text
          numberOfLines={2}
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: colors.text,
            lineHeight: 17,
          }}
        >
          {item.title}
        </Text>

        {/* Distance + Open Now */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {distanceText && (
            <Text style={{ fontSize: 11, color: colors.textTertiary }}>
              {distanceText}
            </Text>
          )}
          {isOpen && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: "#22C55E",
                }}
              />
              <Text style={{ fontSize: 11, color: "#22C55E" }}>Open</Text>
            </View>
          )}
        </View>

        {/* Tags */}
        {tags.length > 0 && (
          <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
            {tags.map((tag) => (
              <View
                key={tag}
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  backgroundColor: Colors.primary + "15",
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    color: Colors.primary,
                    fontWeight: "500",
                  }}
                >
                  {tag.replace(/_/g, " ")}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

export const GroupCarouselTile = React.memo(GroupCarouselTileInner);

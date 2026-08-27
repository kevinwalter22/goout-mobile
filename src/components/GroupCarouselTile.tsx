/**
 * GroupCarouselTile — Single tile in a group card's horizontal carousel
 *
 * 160px wide, compact card with image, title, distance + open-now dot, tags.
 */

import React, { useEffect, useMemo, useRef } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import { Colors } from "../config/theme";
import type { ScoredItem } from "../lib/scoring";
import { getDistanceInMiles } from "../utils/location";
import { getCategoryPlaceholder } from "../utils/categoryPlaceholder";
import { formatTileWhen } from "../utils/formatTileWhen";

interface GroupCarouselTileProps {
  item: ScoredItem;
  userLocation: { lat: number; lng: number } | null;
  /** Tile belongs to a postable_now group → POST NOW badge + double-tap shortcut. */
  isPostable?: boolean;
  onPress: (itemId: string) => void;
  onLongPress?: (itemId: string) => void;
  onCameraShortcut?: (item: ScoredItem) => void;
}

function GroupCarouselTileInner({
  item,
  userLocation,
  isPostable = false,
  onPress,
  onLongPress,
  onCameraShortcut,
}: GroupCarouselTileProps) {
  const { colors } = useTheme();

  const distanceText = useMemo(() => {
    if (!userLocation || !item.lat || !item.lng) return null;
    return `${getDistanceInMiles(userLocation.lat, userLocation.lng, item.lat, item.lng).toFixed(1)} mi`;
  }, [userLocation, item.lat, item.lng]);

  const isOpen = item.scoreBreakdown.openNow >= 0.9;
  const tags = (item.tags || []).slice(0, 2);
  const whenText = useMemo(() => formatTileWhen(item), [item.kind, item.starts_at, item.ends_at]);

  // Double-tap → camera, single tap → detail. Same 200ms discriminator the list
  // ExploreCard uses, so the gesture feels identical across surfaces. Only armed
  // when the tile is postable AND a shortcut handler is present.
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
  }, []);

  const canShortcut = isPostable && !!onCameraShortcut;

  function handlePress() {
    if (!canShortcut) {
      onPress(item.id);
      return;
    }
    if (tapTimerRef.current !== null) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      onCameraShortcut?.(item);
    } else {
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        onPress(item.id);
      }, 200);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={() => onLongPress?.(item.id)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint={canShortcut ? "Tap to view details, double-tap to go straight to camera" : "Tap to view details"}
      style={{
        width: 160,
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: isPostable ? 2 : 1,
        borderColor: isPostable ? Colors.primary : colors.border,
        overflow: "hidden",
      }}
    >
      {/* Image — prefer thumbnail, fall back to full image (user-created events only set image_url) */}
      <View>
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

        {/* POST NOW badge — overlaid on the image for postable tiles (parity
            with the list ExploreCard badge). */}
        {isPostable && (
          <View
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 4,
              backgroundColor: Colors.primary,
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>
              POST NOW
            </Text>
          </View>
        )}
      </View>

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

        {/* When (events only) */}
        {whenText && (
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: Colors.primary,
            }}
          >
            {whenText}
          </Text>
        )}

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

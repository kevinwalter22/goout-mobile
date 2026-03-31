/**
 * GroupCard — Single group card with title + horizontal carousel
 *
 * Renders a group heading and a snapping horizontal FlatList of GroupCarouselTile.
 */

import React, { useCallback } from "react";
import { FlatList, Text, View } from "react-native";
import { useTheme } from "../contexts/ThemeContext";
import { Colors } from "../config/theme";
import { GroupCarouselTile } from "./GroupCarouselTile";
import type { ResolvedGroup } from "../lib/groupingEngine";
import type { ScoredItem } from "../lib/scoring";

interface GroupCardProps {
  group: ResolvedGroup;
  userLocation: { lat: number; lng: number } | null;
  onItemPress: (itemId: string) => void;
  onLongPressItem?: (itemId: string) => void;
}

const TILE_WIDTH = 160;
const TILE_GAP = 12;

function GroupCardInner({ group, userLocation, onItemPress, onLongPressItem }: GroupCardProps) {
  const { colors } = useTheme();
  const isPostable = group.cardType === "postable_now";

  const renderCarouselItem = useCallback(
    ({ item }: { item: ScoredItem }) => (
      <GroupCarouselTile
        item={item}
        userLocation={userLocation}
        onPress={onItemPress}
        onLongPress={onLongPressItem}
      />
    ),
    [userLocation, onItemPress, onLongPressItem]
  );

  return (
    <View
      style={{
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: isPostable ? 2 : 1,
        borderColor: isPostable ? Colors.primary : colors.border,
        overflow: "hidden",
      }}
    >
      {/* Title row */}
      <View style={{ padding: 14, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {isPostable && (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: Colors.primary,
              }}
            />
          )}
          <Text
            style={{
              fontSize: 16,
              fontWeight: "700",
              color: colors.text,
              flex: 1,
            }}
          >
            {group.title}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textTertiary }}>
            {group.items.length}
          </Text>
        </View>
        {group.subtitle ? (
          <Text
            style={{
              fontSize: 13,
              color: colors.textSecondary,
              marginTop: 2,
            }}
          >
            {group.subtitle}
          </Text>
        ) : null}
      </View>

      {/* Horizontal carousel */}
      <FlatList
        data={group.items}
        keyExtractor={(item) => `${group.id}-${item.id}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={TILE_WIDTH + TILE_GAP}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingBottom: 14,
          gap: TILE_GAP,
        }}
        initialNumToRender={4}
        getItemLayout={(_, i) => ({
          length: TILE_WIDTH + TILE_GAP,
          offset: i * (TILE_WIDTH + TILE_GAP),
          index: i,
        })}
        renderItem={renderCarouselItem}
      />
    </View>
  );
}

export const GroupCard = React.memo(
  GroupCardInner,
  (prev, next) => prev.group.id === next.group.id && prev.group.items === next.group.items
);

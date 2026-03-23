/**
 * GroupedExploreFeed — Top-level feed of group cards + overflow items
 *
 * Renders a vertical FlatList where each item is either:
 * - A GroupCard (group heading + horizontal carousel)
 * - An overflow header
 * - An ExploreCard-style overflow item (simplified)
 */

import React, { useMemo, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import { Colors } from "../config/theme";
import { GroupCard } from "./GroupCard";
import type { GroupingResult, ResolvedGroup } from "../lib/groupingEngine";
import type { ScoredItem } from "../lib/scoring";
import { formatOpeningHours } from "../utils/formatOpeningHours";
import { getCategoryPlaceholder } from "../utils/categoryPlaceholder";
import type { ExploreItem } from "../types/database";

type FeedItem =
  | { type: "group"; group: ResolvedGroup; key: string }
  | { type: "overflow_header"; key: string }
  | { type: "overflow_item"; item: ScoredItem; key: string };

interface GroupedExploreFeedProps {
  groupingResult: GroupingResult;
  userLocation: { lat: number; lng: number } | null;
  onItemPress: (itemId: string) => void;
  onSuppressItem?: (itemId: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  loading: boolean;
  flatListRef?: React.RefObject<FlatList>;
}

function formatItemDateTime(item: ExploreItem) {
  if (item.starts_at) {
    return new Date(item.starts_at).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (item.time_text) return item.time_text;
  if (item.schedule_text) {
    const { summaryLine } = formatOpeningHours(item.schedule_text);
    if (summaryLine) return summaryLine;
    return item.schedule_text;
  }
  return "Ongoing";
}

function OverflowItem({
  item,
  onPress,
  onLongPress,
}: {
  item: ScoredItem;
  onPress: (id: string) => void;
  onLongPress?: (id: string) => void;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      onLongPress={() => onLongPress?.(item.id)}
      style={{
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.cardBg,
        flexDirection: "row",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontSize: 16, fontWeight: "700", color: colors.text }}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        {item.hook_line && (
          <Text
            style={{
              marginTop: 4,
              color: colors.textSecondary,
              fontStyle: "italic",
            }}
            numberOfLines={1}
          >
            {item.hook_line}
          </Text>
        )}
        <Text style={{ marginTop: 4, color: colors.textSecondary }}>
          {formatItemDateTime(item)}
        </Text>
        <Text
          style={{ marginTop: 4, color: colors.textSecondary }}
          numberOfLines={1}
        >
          {[item.location_name, item.town].filter(Boolean).join(" · ")}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 6,
            gap: 8,
          }}
        >
          {item.category && (
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                color: colors.textSecondary,
                backgroundColor: colors.surfaceVariant,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 4,
              }}
            >
              {item.category}
            </Text>
          )}
          {item.price_bucket &&
            item.price_bucket !== "unknown" && (
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "600",
                  color:
                    item.price_bucket === "free"
                      ? Colors.primary
                      : colors.textSecondary,
                }}
              >
                {item.price_bucket === "free" ? "Free" : item.price_bucket}
              </Text>
            )}
        </View>
      </View>

      {item.image_thumb_url ? (
        <Image
          source={{ uri: item.image_thumb_url }}
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            borderWidth: 2,
            borderColor: colors.border,
            backgroundColor: colors.surfaceVariant,
          }}
          resizeMode="cover"
        />
      ) : (() => {
        const ph = getCategoryPlaceholder(item);
        return (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: ph.bg,
              borderWidth: 2,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={ph.icon as any} size={28} color={ph.fg} />
          </View>
        );
      })()}
    </Pressable>
  );
}

export function GroupedExploreFeed({
  groupingResult,
  userLocation,
  onItemPress,
  onSuppressItem,
  onRefresh,
  refreshing,
  loading,
  flatListRef,
}: GroupedExploreFeedProps) {
  const { colors } = useTheme();

  const feedData = useMemo<FeedItem[]>(() => {
    const result: FeedItem[] = [];

    for (const group of groupingResult.groups) {
      result.push({ type: "group", group, key: `group-${group.id}` });
    }

    if (groupingResult.overflow.length > 0) {
      result.push({ type: "overflow_header", key: "overflow-header" });
      for (const item of groupingResult.overflow) {
        result.push({
          type: "overflow_item",
          item,
          key: `overflow-${item.id}`,
        });
      }
    }

    return result;
  }, [groupingResult]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      switch (item.type) {
        case "group":
          return (
            <GroupCard
              group={item.group}
              userLocation={userLocation}
              onItemPress={onItemPress}
              onLongPressItem={onSuppressItem}
            />
          );
        case "overflow_header":
          return (
            <View style={{ marginTop: 8, marginBottom: 4 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: colors.textSecondary,
                }}
              >
                More to explore
              </Text>
            </View>
          );
        case "overflow_item":
          return <OverflowItem item={item.item} onPress={onItemPress} onLongPress={onSuppressItem} />;
      }
    },
    [userLocation, onItemPress, onSuppressItem, colors.textSecondary]
  );

  const keyExtractor = useCallback((item: FeedItem) => item.key, []);

  if (loading && feedData.length === 0) {
    return (
      <View
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
      >
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!loading && feedData.length === 0) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 8 }}>
        <Text
          style={{
            fontSize: 16,
            fontWeight: "600",
            textAlign: "center",
            color: colors.text,
          }}
        >
          Nothing found
        </Text>
        <Text
          style={{
            fontSize: 14,
            textAlign: "center",
            color: colors.textTertiary,
          }}
        >
          Try adjusting your filters or check back later
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={flatListRef}
      data={feedData}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.primary}
        />
      }
    />
  );
}

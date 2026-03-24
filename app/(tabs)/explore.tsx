import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
  Image,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { getCurrentLocation, requestLocationPermission } from "../../src/utils/location";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useRecommender } from "../../src/hooks/useRecommender";
import { scrollToTopEmitter } from "../../src/utils/scrollToTop";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import { FilterSheet } from "../../src/components/FilterSheet";
import { ExploreMapView } from "../../src/components/ExploreMapView";
import { GroupedExploreFeed } from "../../src/components/GroupedExploreFeed";
import { ViewModeToggle, type ViewMode } from "../../src/components/ViewModeToggle";
import { processPostableNow } from "../../src/lib/postableNow";
import { useGroupedExplore } from "../../src/hooks/useGroupedExplore";
import { getEffectiveFilters } from "../../src/config/exploreFilters";
import { logInteraction } from "../../src/lib/interactionLogger";
import { addNavigationBreadcrumb } from "../../src/lib/sentry";
import { getFallbackImage } from "../../src/lib/categoryFallbackImages";
import { logAnalyticsEvent } from "../../src/lib/analyticsLogger";
import { formatOpeningHours } from "../../src/utils/formatOpeningHours";
import { sanitizeTimeText } from "../../src/utils/formatTimeText";
import { useItemSuppressions } from "../../src/hooks/useItemSuppressions";
import type { KindFilter } from "../../src/config/exploreFilters";
import type { ExploreItem } from "../../src/types/database";
import type { ScoredItem } from "../../src/lib/scoring";

type ExploreItemWithRSVP = ExploreItem & {
  rsvp_count: number;
  user_is_going: boolean;
  friends_going_count: number;
};

type RSVPInfo = { count: number; userGoing: boolean; friendsGoing: number };

// Stable separator — avoids creating a new component on every render
const ItemSep = () => <View style={{ height: 10 }} />;

// Memoized explore card — only re-renders when its own data changes
const ExploreCard = React.memo(function ExploreCard({
  item,
  rsvpInfo,
  isPostable,
  isFirstRegular,
  kindFilter,
  onPress,
  onLongPress,
  colors,
  currentUserId,
}: {
  item: ExploreItem;
  rsvpInfo: RSVPInfo;
  isPostable: boolean;
  isFirstRegular: boolean;
  kindFilter: KindFilter;
  onPress: (id: string) => void;
  onLongPress?: (id: string) => void;
  colors: any;
  currentUserId?: string;
}) {
  return (
    <>
      {isFirstRegular && (
        <View style={{ marginTop: 8, marginBottom: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.textSecondary }}>
            {kindFilter === "activity"
              ? "More Activities"
              : kindFilter === "event"
              ? "More Events"
              : "More to Explore"}
          </Text>
        </View>
      )}
      <Pressable
        onPress={() => onPress(item.id)}
        onLongPress={() => onLongPress?.(item.id)}
        accessibilityLabel={item.title}
        accessibilityRole="button"
        accessibilityHint="Double tap to view details"
        style={{
          padding: 14,
          borderRadius: 12,
          borderWidth: isPostable ? 2 : 1,
          borderColor: isPostable ? Colors.primary : colors.border,
          backgroundColor: isPostable ? `${Colors.primary}08` : colors.cardBg,
        }}
      >
        {/* Card content: text left, thumbnail right */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          {/* Text content */}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", flex: 1, color: colors.text }}>
                {item.title}
              </Text>
              {isPostable && (
                <View
                  style={{
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
              {currentUserId && item.created_by_user_id === currentUserId && item.review_status === "quarantined" && (
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: "#F59E0B",
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>
                    PENDING
                  </Text>
                </View>
              )}
              {currentUserId && item.created_by_user_id === currentUserId && item.review_status === "rejected" && (
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: "#EF4444",
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>
                    REJECTED
                  </Text>
                </View>
              )}
              {item.recurrence && !["none", ""].includes(item.recurrence) && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: colors.surfaceVariant,
                  }}
                >
                  <Ionicons name="repeat" size={10} color={colors.textSecondary} />
                  <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textSecondary }}>
                    {item.recurrence === "weekly" ? "WEEKLY" : "MONTHLY"}
                  </Text>
                </View>
              )}
            </View>
            {item.hook_line && (
              <Text
                style={{
                  marginTop: 4,
                  color: colors.textSecondary,
                  fontStyle: "italic",
                }}
                numberOfLines={2}
              >
                {item.hook_line}
              </Text>
            )}
            <Text style={{ marginTop: 4, color: colors.textSecondary }}>
              {formatItemDateTime(item)}
            </Text>
            <Text style={{ marginTop: 4, color: colors.textSecondary }} numberOfLines={1}>
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
              {item.price_bucket && item.price_bucket !== "unknown" && (
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: item.price_bucket === "free" ? Colors.primary : colors.textSecondary,
                  }}
                >
                  {item.price_bucket === "free" ? "Free" : item.price_bucket}
                </Text>
              )}
            </View>
          </View>

          {/* Thumbnail on right — cached image or category fallback */}
          <Image
            source={{ uri: item.image_thumb_url || getFallbackImage(item.category) }}
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
        </View>

        {(rsvpInfo.count > 0 || rsvpInfo.userGoing || rsvpInfo.friendsGoing > 0) && (
          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {rsvpInfo.userGoing && (
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 6,
                    backgroundColor: Colors.primary,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff" }}>
                    ✓ Going
                  </Text>
                </View>
              )}
              {rsvpInfo.count > 0 && (
                <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                  {rsvpInfo.count} {rsvpInfo.count === 1 ? "person" : "people"} going
                </Text>
              )}
            </View>
            {rsvpInfo.friendsGoing > 0 && (
              <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.primary }}>
                {rsvpInfo.friendsGoing}{" "}
                {rsvpInfo.friendsGoing === 1 ? "friend" : "friends"} going
              </Text>
            )}
          </View>
        )}
      </Pressable>
    </>
  );
});

// Extracted so the memoized card can use it without depending on parent scope
function formatItemDateTime(item: ExploreItem) {
  if (item.starts_at) {
    const dateStr = new Date(item.starts_at).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    if (item.recurrence === "weekly") {
      return `${dateStr} (every ${new Date(item.starts_at).toLocaleDateString("en-US", { weekday: "long" })})`;
    }
    if (item.recurrence === "monthly") {
      return `${dateStr} (monthly)`;
    }
    return dateStr;
  }
  if (item.time_text) return sanitizeTimeText(item.time_text);
  // For activities with weekly hours, show compact "Open/Closed" summary
  if (item.schedule_text) {
    const { summaryLine } = formatOpeningHours(item.schedule_text);
    if (summaryLine) return summaryLine;
    return item.schedule_text;
  }
  return "Ongoing";
}

export default function Explore() {
  const { user } = useAuth();
  const { colors, effectiveMode } = useTheme();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // User location (for Postable Now feature)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Postable Now candidates (fetched independently of main sort/pagination)
  const [postableNowCandidates, setPostableNowCandidates] = useState<ExploreItem[]>([]);
  const [postableNowVersion, setPostableNowVersion] = useState(0);

  // RSVP data (loaded separately for performance)
  const [rsvpData, setRsvpData] = useState<
    Record<string, { count: number; userGoing: boolean; friendsGoing: number }>
  >({});
  const [friendIds, setFriendIds] = useState<string[]>([]);

  // Item suppressions ("Not Interested")
  const { suppressedIds, suppressItem } = useItemSuppressions(user?.id);

  // Use the recommender hook (wraps useExploreFilters with scoring)
  const {
    filters,
    hasFilters,
    filterSummary,
    setKindFilter,
    setCategory,
    setPriceBucket,
    setTimeWindow,
    setDistance,
    setSort,
    resetAdvancedFilters,
    items,
    rawItems,
    loading,
    error,
    totalCount,
    hasMore,
    loadMore,
    refresh,
    weather,
    scoringEnabled,
  } = useRecommender(userLocation, {
    enableScoring: true,
    pageSizeOverride: viewMode === "cards" ? 200 : undefined,
  });

  // Listen for scroll-to-top events
  useEffect(() => {
    addNavigationBreadcrumb("Explore");
    if (user) {
      logAnalyticsEvent(user.id, "explore_open");
    }

    const handleScrollToTop = () => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    };

    scrollToTopEmitter.on("scrollToTop:explore", handleScrollToTop);

    return () => {
      scrollToTopEmitter.off("scrollToTop:explore", handleScrollToTop);
    };
  }, []);

  // Function to get current location (reusable for initial load, refresh, and periodic updates)
  const updateLocation = useCallback(async () => {
    try {
      const { granted } = await requestLocationPermission();
      if (!granted) return;

      const { latitude, longitude, error } = await getCurrentLocation();
      if (error) return;

      setUserLocation({ lat: latitude, lng: longitude });
    } catch (error) {
      console.log("[Explore] Could not get location:", error);
    }
  }, []);

  // Get user's current location on mount and periodically update (every 30 seconds)
  useEffect(() => {
    // Initial location fetch
    updateLocation();

    // Update location every 30 seconds for accurate distance calculations
    const intervalId = setInterval(updateLocation, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, [updateLocation]);

  // Fetch postable now candidates (independent of main sort/pagination/filters)
  // This ensures the Postable Now section is consistent regardless of sort option
  useEffect(() => {
    async function fetchPostableNowCandidates() {
      if (!userLocation) return;

      const { data } = await supabase
        .from("explore_items")
        .select("*")
        .is("deleted_at", null)
        .not("lat", "is", null)
        .not("lng", "is", null);

      setPostableNowCandidates(data || []);
    }

    fetchPostableNowCandidates();
  }, [userLocation, postableNowVersion]);

  // Load friends list once
  useEffect(() => {
    async function loadFriends() {
      if (!user) return;

      const { data: friendships } = await supabase
        .from("friendships")
        .select("user_id, friend_id")
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

      const ids = (friendships || []).map((f: any) =>
        f.user_id === user.id ? f.friend_id : f.user_id
      );
      setFriendIds(ids);
    }

    loadFriends();
  }, [user]);

  // Load RSVP data for visible items
  useEffect(() => {
    async function loadRSVPData() {
      if (!items || items.length === 0) return;

      const itemIds = items.map((item) => item.id);
      const newRsvpData: typeof rsvpData = {};

      // Batch fetch RSVP counts
      const { data: allRsvps } = await supabase
        .from("explore_item_rsvps")
        .select("explore_item_id, user_id")
        .in("explore_item_id", itemIds);

      // Process RSVP data
      for (const item of items) {
        const itemRsvps = (allRsvps || []).filter(
          (r: any) => r.explore_item_id === item.id
        );

        newRsvpData[item.id] = {
          count: itemRsvps.length,
          userGoing: user
            ? itemRsvps.some((r: any) => r.user_id === user.id)
            : false,
          friendsGoing: friendIds.length > 0
            ? itemRsvps.filter((r: any) => friendIds.includes(r.user_id)).length
            : 0,
        };
      }

      setRsvpData(newRsvpData);
    }

    loadRSVPData();
  }, [items, user, friendIds]);

  // Handle pull-to-refresh (also updates location and postable now candidates)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    // Update location first, then refresh data + postable now candidates
    await updateLocation();
    setPostableNowVersion((v) => v + 1);
    await refresh();
    setRefreshing(false);
  }, [refresh, updateLocation]);

  // Handle load more (infinite scroll) — disabled in cards mode (all items pre-fetched)
  const handleLoadMore = useCallback(() => {
    if (viewMode === "cards") return;
    if (!loading && hasMore) {
      loadMore();
    }
  }, [viewMode, loading, hasMore, loadMore]);

  // Get RSVP info for an item
  function getRSVPInfo(itemId: string) {
    return rsvpData[itemId] || { count: 0, userGoing: false, friendsGoing: 0 };
  }

  // Count active filters for badge display
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.category !== "all") count++;
    if (filters.priceBucket !== "all") count++;
    if (filters.timeWindow !== "all") count++;
    if (filters.distance !== 50) count++;
    return count;
  }, [filters]);

  // Get effective filters (resolves quick filters to actual values)
  const effectiveFilters = useMemo(() => getEffectiveFilters(filters), [filters]);

  // Process Postable Now from candidates (independent of main sort/pagination)
  // Filter out suppressed items before processing
  const { postableNow: allPostableNow } = useMemo(() => {
    const unsuppressed = postableNowCandidates.filter((i) => !suppressedIds.has(i.id));
    return processPostableNow(unsuppressed, userLocation);
  }, [postableNowCandidates, userLocation, suppressedIds]);

  // Postable Now shows items that are truly postable (within range + time),
  // filtered by kind toggle but not by category/tag filters.
  // This ensures consistency with the detail page which allows posting
  // for any item that passes distance + time checks.
  const postableNow = useMemo(() => {
    if (filters.kindFilter === "all") {
      return allPostableNow;
    }
    return allPostableNow.filter((item) => item.kind === filters.kindFilter);
  }, [allPostableNow, filters.kindFilter]);

  // Grouping engine for cards mode — scored postable items for cards feed
  const postableNowScored = useMemo<ScoredItem[]>(() => {
    return postableNow.map((item) => ({
      ...item,
      recommendScore: 1,
      scoreBreakdown: {
        timeMatch: 1, distance: 1, openNow: 1, friendsGoing: 0,
        tagAffinity: 0, weather: 0.5, contextIntent: 0.5, typeAffinity: 0.5,
        quality: 1, communityFeedback: 0.5, freshness: 0.5, total: 1,
      },
    }));
  }, [postableNow]);

  // Cards mode: filter out low-confidence and suppressed items before grouping
  // so card groups only contain higher-quality, non-hidden items.
  const cardsItems = useMemo(() => {
    let filtered = items.filter((item) => !suppressedIds.has(item.id));
    if (viewMode === "cards") {
      filtered = filtered.filter((item) => {
        const conf = (item as any).normalized_confidence as number | null | undefined;
        return conf == null || conf >= 55;
      });
    }
    return filtered;
  }, [items, viewMode, suppressedIds]);

  const groupingResult = useGroupedExplore({
    items: cardsItems,
    postableNowItems: postableNowScored,
    weather: weather
      ? { isRaining: weather.isRaining, isSunny: weather.isSunny, temperature: weather.temperature }
      : null,
    userLocation,
    kindFilter: filters.kindFilter as "all" | "event" | "activity",
  });

  // Build set of postable IDs for deduplication and badge display
  const postableIds = useMemo(() => {
    return new Set(postableNow.map((p) => p.id));
  }, [postableNow]);

  // Regular items = paginated items minus postable now and suppressed items
  const regularItems = useMemo(() => {
    return items.filter((item) => !postableIds.has(item.id) && !suppressedIds.has(item.id));
  }, [items, postableIds, suppressedIds]);

  // Combine into ordered list: postable now items first, then the rest
  const orderedItems = useMemo(() => {
    return [...postableNow, ...regularItems];
  }, [postableNow, regularItems]);

  // Stable callback for item press (used by memoized ExploreCard)
  const handleItemPress = useCallback(
    (itemId: string) => {
      if (user) {
        const item = orderedItems.find((i) => i.id === itemId);
        if (item) {
          logInteraction({
            userId: user.id,
            exploreItemId: itemId,
            eventType: "open_detail",
            itemKind: item.kind,
          });
        }
      }
      router.push(`/event/${itemId}` as any);
    },
    [user, orderedItems],
  );

  // Suppress item ("Not Interested") — long-press on cards/list items
  const handleSuppressItem = useCallback(
    (itemId: string) => {
      const item = orderedItems.find((i) => i.id === itemId);
      Alert.alert(
        "Not Interested",
        item ? `Hide "${item.title}" from your feed?` : "Hide this item from your feed?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Hide",
            style: "destructive",
            onPress: () => suppressItem(itemId),
          },
        ],
      );
    },
    [suppressItem, orderedItems],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          padding: 16,
          paddingTop: insets.top + 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Image
          source={require("../../assets/images/euda.png")}
          style={{ width: 120, height: 48, marginLeft: -8 }}
          resizeMode="contain"
        />
        {/* Weather indicator (when scoring is enabled) */}
        {scoringEnabled && weather && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: colors.surfaceVariant,
            }}
          >
            <Ionicons
              name={
                weather.isRaining
                  ? "rainy"
                  : weather.isSunny
                  ? "sunny"
                  : "partly-sunny"
              }
              size={16}
              color={colors.textSecondary}
            />
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>
              {Math.round(weather.temperature)}°F
            </Text>
          </View>
        )}
      </View>

      {/* Action Bar: Kind filter pills + View mode icons + Filter button */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 8,
          gap: 6,
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        {/* Kind filter pills */}
        {(["all", "activity", "event"] as KindFilter[]).map((kind) => (
          <Pressable
            key={kind}
            onPress={() => setKindFilter(kind)}
            accessibilityLabel={kind === "all" ? "All" : kind === "activity" ? "Activities" : "Events"}
            accessibilityRole="button"
            accessibilityState={{ selected: filters.kindFilter === kind }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 16,
              backgroundColor:
                filters.kindFilter === kind ? Colors.primary : colors.surfaceVariant,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: filters.kindFilter === kind ? "#fff" : colors.textSecondary,
              }}
            >
              {kind === "all" ? "All" : kind === "activity" ? "Activities" : "Events"}
            </Text>
          </Pressable>
        ))}

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* View mode icons */}
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </View>

      {/* Results bar: filter summary + count on left, filter button on right */}
      {(hasFilters || totalCount > 0) && !loading && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 6,
            backgroundColor: colors.surfaceVariant,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 13, color: colors.textSecondary }}>
            {filterSummary}
            <Text style={{ color: colors.textTertiary }}>
              {"  ·  "}
              {items.length < totalCount
                ? `${items.length} of ${totalCount}`
                : `${totalCount} result${totalCount !== 1 ? "s" : ""}`}
            </Text>
          </Text>
          <Pressable
            onPress={() => setShowFilterSheet(true)}
            accessibilityLabel={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : "Filters"}
            accessibilityRole="button"
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 8,
              backgroundColor: activeFilterCount > 0 ? Colors.primary : colors.background,
            }}
          >
            <Ionicons
              name="options-outline"
              size={16}
              color={activeFilterCount > 0 ? "#fff" : colors.textSecondary}
            />
            {activeFilterCount > 0 && (
              <Text style={{ fontSize: 12, fontWeight: "600", color: "#fff" }}>
                {activeFilterCount}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Content: Map, Cards, or List */}
      {viewMode === "map" ? (
        <ExploreMapView
          items={orderedItems}
          userLocation={userLocation}
          kindFilter={effectiveFilters.kindFilter}
          category={effectiveFilters.category}
          priceBucket={effectiveFilters.priceBucket}
          timeWindow={effectiveFilters.timeWindow}
          distance={effectiveFilters.distance}
          tags={effectiveFilters.tags}
        />
      ) : viewMode === "cards" ? (
        <GroupedExploreFeed
          groupingResult={groupingResult}
          userLocation={userLocation}
          onItemPress={handleItemPress}
          onSuppressItem={handleSuppressItem}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          loading={loading}
        />
      ) : (
      <View style={{ flex: 1 }}>
        {loading && items.length === 0 && (
          <View style={{ marginTop: 40 }}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        )}

        {!loading && error && (
          <View style={{ padding: 24, gap: 16 }}>
            <Text
              style={{ fontSize: 16, fontWeight: "600", textAlign: "center", color: colors.text }}
            >
              Failed to load events
            </Text>
            <Text style={{ textAlign: "center", color: colors.textSecondary }}>{error}</Text>
            <Pressable
              onPress={refresh}
              accessibilityLabel="Retry"
              accessibilityRole="button"
              style={{
                padding: 16,
                borderRadius: 12,
                backgroundColor: Colors.primary,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
                Retry
              </Text>
            </Pressable>
          </View>
        )}

        {!loading && !error && items.length === 0 && (
          <View style={{ padding: 24, gap: 8 }}>
            <Text
              style={{ fontSize: 16, fontWeight: "600", textAlign: "center", color: colors.text }}
            >
              {filters.kindFilter === "activity"
                ? "No activities found"
                : filters.kindFilter === "event"
                ? "No events found"
                : "Nothing found"}
            </Text>
            <Text
              style={{ fontSize: 14, textAlign: "center", color: colors.textTertiary }}
            >
              {hasFilters
                ? "Try adjusting your filters"
                : "Check back later"}
            </Text>
            {hasFilters && (
              <Pressable
                onPress={resetAdvancedFilters}
                accessibilityLabel="Clear filters"
                accessibilityRole="button"
                style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: colors.surfaceVariant,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: Colors.primary,
                  }}
                >
                  Clear Filters
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {orderedItems.length > 0 && (
          <FlatList
            ref={flatListRef}
            data={orderedItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            ItemSeparatorComponent={ItemSep}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={Colors.primary}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={
              postableNow.length > 0 ? (
                <View style={{ marginBottom: 16 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      marginBottom: 12,
                      gap: 8,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: Colors.primary,
                      }}
                    />
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
                      Postable Now
                    </Text>
                    <Text style={{ fontSize: 14, color: colors.textTertiary }}>
                      ({postableNow.length})
                    </Text>
                  </View>
                </View>
              ) : null
            }
            ListFooterComponent={
              loading && items.length > 0 ? (
                <View style={{ paddingVertical: 20 }}>
                  <ActivityIndicator color={Colors.primary} />
                </View>
              ) : null
            }
            renderItem={({ item, index }) => (
              <ExploreCard
                item={item}
                rsvpInfo={getRSVPInfo(item.id)}
                isPostable={postableIds.has(item.id)}
                isFirstRegular={index === postableNow.length && postableNow.length > 0}
                kindFilter={filters.kindFilter}
                onPress={handleItemPress}
                onLongPress={handleSuppressItem}
                colors={colors}
                currentUserId={user?.id}
              />
            )}
          />
        )}
      </View>
      )}

      {/* Filter Sheet */}
      <FilterSheet
        visible={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        filters={filters}
        onCategoryChange={setCategory}
        onPriceBucketChange={setPriceBucket}
        onTimeWindowChange={setTimeWindow}
        onDistanceChange={setDistance}
        onSortChange={setSort}
        onReset={resetAdvancedFilters}
      />

      {/* Create Event FAB */}
      <Pressable
        onPress={() => router.push("/create-event")}
        accessibilityLabel="Create event"
        accessibilityRole="button"
        style={{
          position: "absolute",
          bottom: 32,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: Colors.primary,
          justifyContent: "center",
          alignItems: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 4,
          elevation: 5,
        }}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

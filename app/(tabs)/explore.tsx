import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
  Image,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
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
import { processPostableNow } from "../../src/lib/postableNow";
import { getEffectiveFilters } from "../../src/config/exploreFilters";
import { logInteraction } from "../../src/lib/interactionLogger";
import { addNavigationBreadcrumb } from "../../src/lib/sentry";
import { logAnalyticsEvent } from "../../src/lib/analyticsLogger";
import type { KindFilter } from "../../src/config/exploreFilters";
import type { ExploreItem } from "../../src/types/database";

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
  colors,
}: {
  item: ExploreItem;
  rsvpInfo: RSVPInfo;
  isPostable: boolean;
  isFirstRegular: boolean;
  kindFilter: KindFilter;
  onPress: (id: string) => void;
  colors: any;
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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

          {/* Thumbnail on right — only when a real image exists */}
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
          ) : null}
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
    return new Date(item.starts_at).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (item.time_text) return item.time_text;
  if (item.schedule_text) return item.schedule_text;
  return "Ongoing";
}

export default function Explore() {
  const { user } = useAuth();
  const { colors, effectiveMode } = useTheme();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

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
  } = useRecommender(userLocation, { enableScoring: true });

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
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setUserLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
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

  // Handle load more (infinite scroll)
  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadMore();
    }
  }, [loading, hasMore, loadMore]);

  // Get RSVP info for an item
  function getRSVPInfo(itemId: string) {
    return rsvpData[itemId] || { count: 0, userGoing: false, friendsGoing: 0 };
  }

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
  const { postableNow: allPostableNow } = useMemo(() => {
    return processPostableNow(postableNowCandidates, userLocation);
  }, [postableNowCandidates, userLocation]);

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

  // Build set of postable IDs for deduplication and badge display
  const postableIds = useMemo(() => {
    return new Set(postableNow.map((p) => p.id));
  }, [postableNow]);

  // Regular items = paginated items minus any that are already in Postable Now
  const regularItems = useMemo(() => {
    return items.filter((item) => !postableIds.has(item.id));
  }, [items, postableIds]);

  // Combine into ordered list: postable now items first, then the rest
  const orderedItems = useMemo(() => {
    return [...postableNow, ...regularItems];
  }, [postableNow, regularItems]);

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

      {/* Kind Toggle (All / Activities / Events) + Filter Button */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 16,
          paddingVertical: 8,
          gap: 8,
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          alignItems: "center",
        }}
      >
        {(["all", "activity", "event"] as KindFilter[]).map((kind) => (
          <Pressable
            key={kind}
            onPress={() => setKindFilter(kind)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor:
                filters.kindFilter === kind ? Colors.primary : colors.surfaceVariant,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: filters.kindFilter === kind ? "#fff" : colors.textSecondary,
              }}
            >
              {kind === "all" ? "All" : kind === "activity" ? "Activities" : "Events"}
            </Text>
          </Pressable>
        ))}

        {/* Map / List Toggle */}
        <Pressable
          onPress={() => setViewMode(viewMode === "list" ? "map" : "list")}
          style={{
            width: 40,
            height: 36,
            borderRadius: 8,
            backgroundColor: viewMode === "map" ? Colors.primary : colors.surfaceVariant,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Ionicons
            name={viewMode === "list" ? "map-outline" : "list-outline"}
            size={20}
            color={viewMode === "map" ? "#fff" : colors.textSecondary}
          />
        </Pressable>

        {/* Filter Button */}
        <Pressable
          onPress={() => setShowFilterSheet(true)}
          style={{
            width: 40,
            height: 36,
            borderRadius: 8,
            backgroundColor: activeFilterCount > 0 ? Colors.primary : colors.surfaceVariant,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={activeFilterCount > 0 ? "#fff" : colors.textSecondary}
          />
          {activeFilterCount > 0 && (
            <View
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: Colors.gray[800],
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>
                {activeFilterCount}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Results count / filter summary - Shows accurate count immediately */}
      {(hasFilters || totalCount > 0) && !loading && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
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
          </Text>
          <Text style={{ fontSize: 13, color: colors.textTertiary }}>
            {items.length < totalCount
              ? `Showing ${items.length} of ${totalCount}`
              : `${totalCount} result${totalCount !== 1 ? "s" : ""}`}
          </Text>
        </View>
      )}

      {/* Content: Map or List */}
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
                colors={colors}
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
        style={{
          position: "absolute",
          bottom: 24,
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

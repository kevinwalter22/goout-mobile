import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  Image,
  RefreshControl,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { getCurrentLocation, requestLocationPermission } from "../../src/utils/location";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useRecommender } from "../../src/hooks/useRecommender";
import { scrollToTopEmitter } from "../../src/utils/scrollToTop";
import { didSwipeNavigateRecently } from "../../src/components/SwipeableTabsContainer";
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
import { getCategoryPlaceholder } from "../../src/utils/categoryPlaceholder";
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

// Returns approximate distance in meters between two lat/lng points.
// Used to gate location state updates — only update when moved >50m.
function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

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
  onCameraShortcut,
  currentUserId,
}: {
  item: ExploreItem;
  rsvpInfo: RSVPInfo;
  isPostable: boolean;
  isFirstRegular: boolean;
  kindFilter: KindFilter;
  onPress: (id: string) => void;
  onLongPress?: (id: string) => void;
  onCameraShortcut?: (id: string) => void;
  currentUserId?: string;
}) {
  const { colors } = useTheme();
  const [imgError, setImgError] = React.useState(false);
  const tapTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  function handlePress() {
    if (!isPostable || !onCameraShortcut) {
      onPress(item.id);
      return;
    }
    if (tapTimerRef.current !== null) {
      // Second tap within the window — double-tap confirmed → go to camera
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      onCameraShortcut(item.id);
    } else {
      // First tap — wait 200ms for a possible second tap
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        onPress(item.id);
      }, 200);
    }
  }

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
        onPress={handlePress}
        onLongPress={() => onLongPress?.(item.id)}
        accessibilityLabel={item.title}
        accessibilityRole="button"
        accessibilityHint={isPostable && onCameraShortcut ? "Tap to view details, double-tap to go straight to camera" : "Tap to view details"}
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
            </View>
            {isPostable && onCameraShortcut && (
              <Text style={{ fontSize: 11, color: colors.textTertiary, marginTop: 3 }}>
                Double-tap to post now
              </Text>
            )}
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
              {item.recurrence && !["none", ""].includes(item.recurrence) && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                    backgroundColor: colors.surfaceVariant,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 4,
                  }}
                >
                  <Ionicons name="repeat" size={11} color={colors.textSecondary} />
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textSecondary }}>
                    {item.recurrence === "weekly" ? "Weekly" : "Monthly"}
                  </Text>
                </View>
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

          {/* Thumbnail on right — image with inline icon fallback on error */}
          {(() => {
            const imgUrl = item.image_thumb_url || item.image_url;
            const ph = getCategoryPlaceholder(item);
            if (imgUrl && !imgError) {
              return (
                <Image
                  source={{ uri: imgUrl }}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 36,
                    borderWidth: 2,
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceVariant,
                  }}
                  resizeMode="cover"
                  onError={() => setImgError(true)}
                />
              );
            }
            return (
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  borderWidth: 2,
                  borderColor: colors.border,
                  backgroundColor: ph.bg,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Ionicons name={ph.icon as any} size={32} color={ph.fg} />
              </View>
            );
          })()}
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
  const [searchText, setSearchText] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User location (for Postable Now feature)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Postable Now candidates (fetched independently of main sort/pagination)
  const [postableNowCandidates, setPostableNowCandidates] = useState<ExploreItem[]>([]);
  const [postableNowVersion, setPostableNowVersion] = useState(0);

  // Refresh postable candidates whenever the screen regains focus (e.g., after
  // creating an event or returning from another tab). Skip the very first focus
  // because the initial fetch is already triggered by userLocation becoming set.
  const hasHadFirstFocusRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasHadFirstFocusRef.current) {
        hasHadFirstFocusRef.current = true;
        return;
      }
      setPostableNowVersion((v) => v + 1);
    }, []),
  );

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
    toggleCategory,
    setPriceBucket,
    setTimeWindow,
    setDistance,
    setSort,
    setSearchQuery,
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
      refresh();
    };

    scrollToTopEmitter.on("scrollToTop:explore", handleScrollToTop);

    return () => {
      scrollToTopEmitter.off("scrollToTop:explore", handleScrollToTop);
    };
  }, [refresh]);

  // Debounce search text → trigger backend search query
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchText);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchText]);

  // Function to get current location (reusable for initial load, refresh, and periodic updates)
  const updateLocation = useCallback(async () => {
    try {
      const { granted } = await requestLocationPermission();
      if (!granted) return;

      const { latitude, longitude, error } = await getCurrentLocation();
      if (error) return;

      const next = { lat: latitude, lng: longitude };
      setUserLocation((prev) => {
        if (prev && haversineMeters(prev, next) < 50) return prev;
        return next;
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

      // Merge instead of replace so existing items keep their RSVP data
      // while the fetch is in flight (prevents every visible card from
      // receiving a new rsvpInfo object reference and re-rendering needlessly).
      setRsvpData((prev) => ({ ...prev, ...newRsvpData }));
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
    if (filters.categories.length > 0) count++;
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
        quality: 1, communityFeedback: 0.5, freshness: 0.5, friendCreated: 0, chainPenalty: 1.0, total: 1,
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
      if (didSwipeNavigateRecently()) return;
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

  // Double-tap shortcut on postable-now cards → skip event detail, go straight to camera
  const handleCameraShortcut = useCallback(
    (itemId: string) => {
      if (didSwipeNavigateRecently()) return;
      const item = orderedItems.find((i) => i.id === itemId);
      if (!item) return;
      router.push(`/checkin/${itemId}?itemKind=${item.kind}` as any);
    },
    [orderedItems],
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

      {/* Results bar: search / filter summary + count + filter button (hidden in map mode) */}
      {(searchActive || (!loading && (hasFilters || totalCount > 0))) && viewMode !== "map" && (
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: colors.surfaceVariant,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          {searchActive ? (
            /* Search active — TextInput fills the bar */
            <>
              <Ionicons name="search" size={14} color={colors.textSecondary} />
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search places & events..."
                placeholderTextColor={colors.textTertiary}
                autoFocus
                autoCapitalize="none"
                returnKeyType="search"
                style={{
                  flex: 1,
                  fontSize: 14,
                  color: colors.text,
                  paddingVertical: 0,
                }}
              />
              <Pressable
                onPress={() => {
                  setSearchText("");
                  setSearchQuery("");
                  setSearchActive(false);
                }}
                hitSlop={8}
                accessibilityLabel="Close search"
                accessibilityRole="button"
              >
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </Pressable>
            </>
          ) : (
            /* Normal state — count text + search icon */
            <Text style={{ fontSize: 13, color: colors.textSecondary, flex: 1 }}>
              {filterSummary}
              <Text style={{ color: colors.textTertiary }}>
                {"  ·  "}
                {items.length < totalCount
                  ? `${items.length} of ${totalCount}`
                  : `${totalCount} result${totalCount !== 1 ? "s" : ""}`}
              </Text>
            </Text>
          )}

          {/* Search icon — only shown when not already searching */}
          {!searchActive && (
            <Pressable
              onPress={() => setSearchActive(true)}
              hitSlop={8}
              accessibilityLabel="Search"
              accessibilityRole="button"
              style={{ padding: 4 }}
            >
              <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            </Pressable>
          )}

          {/* Filter button — always visible */}
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
          userId={user?.id}
          kindFilter={effectiveFilters.kindFilter}
          categories={effectiveFilters.categories}
          priceBucket={effectiveFilters.priceBucket}
          timeWindow={effectiveFilters.timeWindow}
          distance={effectiveFilters.distance}
          tags={effectiveFilters.tags}
        />
      ) : viewMode === "cards" ? (
        <GroupedExploreFeed
          flatListRef={flatListRef}
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
            removeClippedSubviews={Platform.OS === "android"}
            keyboardShouldPersistTaps="handled"
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
            windowSize={5}
            maxToRenderPerBatch={5}
            renderItem={({ item, index }) => (
              <ExploreCard
                item={item}
                rsvpInfo={getRSVPInfo(item.id)}
                isPostable={postableIds.has(item.id)}
                isFirstRegular={index === postableNow.length && postableNow.length > 0}
                kindFilter={filters.kindFilter}
                onPress={handleItemPress}
                onLongPress={handleSuppressItem}
                onCameraShortcut={handleCameraShortcut}
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
        onCategoryToggle={toggleCategory}
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

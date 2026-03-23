import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, Pressable, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";
import { getDistanceInMeters, getDistanceInMiles, isLocationOverridden } from "../utils/location";
import { formatOpeningHours } from "../utils/formatOpeningHours";
import { CHECK_IN_RADIUS_METERS } from "../config/constants";
import { getFallbackImage } from "../lib/categoryFallbackImages";
import type { ExploreItem } from "../types/database";
import type {
  KindFilter,
  CategoryId,
  PriceBucket,
  TimeWindow,
  DistanceRadius,
} from "../config/exploreFilters";

interface ExploreMapViewProps {
  items: ExploreItem[]; // Fallback items from parent
  userLocation: { lat: number; lng: number } | null;
  // Filter props
  kindFilter: KindFilter;
  category?: CategoryId;
  priceBucket?: PriceBucket;
  timeWindow?: TimeWindow;
  distance?: DistanceRadius;
  tags?: string[];
}

// 7-day window for events
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Activities mode: radius-based instead of viewport to prevent marker overload
const MAP_ACTIVITIES_RADIUS_METERS = 1000;
const MAP_ACTIVITIES_MAX_MARKERS = 150;

function computeBoundingRegion(items: ExploreItem[]) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;

  for (const item of items) {
    if (item.lat == null || item.lng == null) continue;
    minLat = Math.min(minLat, item.lat);
    maxLat = Math.max(maxLat, item.lat);
    minLng = Math.min(minLng, item.lng);
    maxLng = Math.max(maxLng, item.lng);
  }

  if (minLat === 90) {
    // No valid items
    return null;
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.3, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.3, 0.02),
  };
}

// Thumbnail marker component - memoized to prevent unnecessary re-renders
// Note: We use identifier + onMarkerPress on MapView for reliable iOS tap handling
const MARKER_SIZE = 40;

const ThumbnailMarker = React.memo(
  function ThumbnailMarker({
    item,
    isSelected,
  }: {
    item: ExploreItem;
    isSelected: boolean;
  }) {
    const imageUrl = item.image_thumb_url || item.image_url;
    const [imageError, setImageError] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);

    // Brief settling period after selection change so native view can commit the update
    const [settling, setSettling] = useState(false);
    const prevSelected = useRef(isSelected);
    useEffect(() => {
      if (prevSelected.current !== isSelected) {
        prevSelected.current = isSelected;
        setSettling(true);
        const timer = setTimeout(() => setSettling(false), 200);
        return () => clearTimeout(timer);
      }
    }, [isSelected]);

    // Default pin colors
    const defaultColor = item.kind === "event" ? "#FF6B6B" : "#4A90D9";
    const selectedColor = Colors.primary;

    if (imageUrl && !imageError) {
      return (
        <Marker
          identifier={item.id}
          coordinate={{ latitude: item.lat!, longitude: item.lng! }}
          anchor={{ x: 0.5, y: 0.5 }}
          // Track view changes only while image loads or during selection transition
          // Stable size (no resize) prevents flicker when deselecting
          tracksViewChanges={!imageLoaded || settling}
        >
          <View
            style={{
              width: MARKER_SIZE,
              height: MARKER_SIZE,
              borderRadius: MARKER_SIZE / 2,
              borderWidth: isSelected ? 3 : 2,
              borderColor: isSelected ? selectedColor : "#fff",
              backgroundColor: "#fff",
              overflow: "hidden",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 4,
              elevation: isSelected ? 6 : 4,
            }}
          >
            <Image
              source={{ uri: imageUrl }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
              onError={() => setImageError(true)}
              onLoad={() => setImageLoaded(true)}
            />
          </View>
        </Marker>
      );
    }

    // Fallback to default pin - no custom view, no tracksViewChanges needed
    return (
      <Marker
        identifier={item.id}
        coordinate={{ latitude: item.lat!, longitude: item.lng! }}
        pinColor={isSelected ? selectedColor : defaultColor}
      />
    );
  },
  // Custom comparison: only re-render if selection state or item id changes
  (prevProps, nextProps) => {
    return (
      prevProps.item.id === nextProps.item.id &&
      prevProps.isSelected === nextProps.isSelected
    );
  }
);

export function ExploreMapView({
  items: fallbackItems,
  userLocation,
  kindFilter,
  category = "all",
  priceBucket = "all",
  timeWindow = "all",
  distance = 50,
  tags = [],
}: ExploreMapViewProps) {
  const { colors } = useTheme();
  const mapRef = useRef<MapView>(null);

  // Track selected item ID separately for marker rendering optimization
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mapItems, setMapItems] = useState<ExploreItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Animation for preview card
  const previewAnim = useRef(new Animated.Value(0)).current;

  // Cache to prevent duplicate fetches
  const lastFetchRef = useRef<{
    filterKey: string;
    timestamp: number;
  } | null>(null);

  // Generate a cache key from all filter values
  const filterCacheKey = useMemo(
    () =>
      `${kindFilter}-${category}-${priceBucket}-${timeWindow}-${distance}-${tags.join(",")}-${userLocation ? "loc" : "noloc"}`,
    [kindFilter, category, priceBucket, timeWindow, distance, tags, userLocation]
  );

  // Initial region calculation
  const initialRegion = useMemo(() => {
    if (userLocation) {
      return {
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
    }

    const boundingRegion = computeBoundingRegion(fallbackItems);
    if (boundingRegion) return boundingRegion;

    // Fallback: Potsdam, NY area
    return {
      latitude: 44.66,
      longitude: -74.98,
      latitudeDelta: 0.2,
      longitudeDelta: 0.2,
    };
  }, [userLocation, fallbackItems]);

  // Compute time window date range
  const getTimeWindowRange = useCallback((): { start: Date; end: Date } | null => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    switch (timeWindow) {
      case "today":
        return { start: today, end: tomorrow };
      case "tonight": {
        const tonight6pm = new Date(today.getTime() + 18 * 60 * 60 * 1000);
        return { start: tonight6pm, end: tomorrow };
      }
      case "tomorrow":
        return { start: tomorrow, end: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000) };
      case "this_weekend": {
        const dayOfWeek = now.getDay();
        const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
        const saturday = new Date(today.getTime() + daysUntilSaturday * 24 * 60 * 60 * 1000);
        const monday = new Date(saturday.getTime() + 2 * 24 * 60 * 60 * 1000);
        return { start: dayOfWeek >= 5 ? today : saturday, end: monday };
      }
      case "this_week": {
        const endOfWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        return { start: today, end: endOfWeek };
      }
      case "this_month": {
        const endOfMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
        return { start: today, end: endOfMonth };
      }
      default:
        return null;
    }
  }, [timeWindow]);

  // Map category ID to database category values
  const getCategoryFilter = useCallback((): string[] | null => {
    const categoryMap: Record<CategoryId, string[]> = {
      all: [],
      music: ["music", "Music", "concert", "live_music"],
      sports: ["sports", "Sports", "Sports & Recreation"],
      arts: ["arts", "Arts & Culture", "Arts & Theatre", "theatre", "theater"],
      entertainment: ["entertainment", "Entertainment"],
      community: ["community", "Community"],
      food: ["food", "Food & Drink", "Food"],
      outdoors: ["outdoors", "Outdoor", "outdoor", "hiking", "nature"],
      nightlife: ["nightlife", "Nightlife", "bars", "clubs"],
    };
    const values = categoryMap[category];
    return values && values.length > 0 ? values : null;
  }, [category]);

  // Fetch map items with all filters applied
  const fetchMapItems = useCallback(
    async () => {
      // Check cache (skip if same filters within 2 seconds)
      const now = Date.now();
      if (
        lastFetchRef.current &&
        lastFetchRef.current.filterKey === filterCacheKey &&
        now - lastFetchRef.current.timestamp < 2000
      ) {
        return;
      }

      setLoading(true);

      try {
        const nowDate = new Date();
        const sevenDaysLater = new Date(nowDate.getTime() + SEVEN_DAYS_MS);

        // Time window range (or default 7-day for events)
        const timeRange = getTimeWindowRange();
        const startDate = timeRange?.start || nowDate;
        const endDate = timeRange?.end || sevenDaysLater;

        // Category filter
        const categoryValues = getCategoryFilter();

        // Distance in meters for filtering
        const distanceMeters = distance === "any" ? null : distance * 1609.344;

        let events: ExploreItem[] = [];
        let activities: ExploreItem[] = [];

        // Helper to apply common filters to a query
        const applyFilters = (query: any) => {
          // Price bucket
          if (priceBucket !== "all") {
            query = query.eq("price_bucket", priceBucket);
          }
          // Category (use ilike for case-insensitive partial match)
          if (categoryValues && categoryValues.length > 0) {
            // Match any of the category values
            const categoryOr = categoryValues.map((c) => `category.ilike.%${c}%`).join(",");
            query = query.or(categoryOr);
          }
          // Tags (if provided)
          if (tags.length > 0) {
            // This assumes tags are stored in a text field or array - adjust as needed
            for (const tag of tags) {
              query = query.or(`category.ilike.%${tag}%,title.ilike.%${tag}%`);
            }
          }
          return query;
        };

        // Fetch events for "all" and "event" modes
        if (kindFilter === "all" || kindFilter === "event") {
          // 1. Dated events within the time window
          let eventQuery = supabase
            .from("explore_items")
            .select("*")
            .eq("kind", "event")
            .is("deleted_at", null)
            .gte("starts_at", startDate.toISOString())
            .lte("starts_at", endDate.toISOString())
            .not("lat", "is", null)
            .not("lng", "is", null)
            .gte("priority", 0)
            .eq("is_duplicate", false)
            .or("review_status.is.null,review_status.in.(auto_approved,approved)");

          eventQuery = applyFilters(eventQuery);
          const { data: eventData } = await eventQuery.limit(300);

          // 2. Recurring items without starts_at (e.g., weekly wing night, trivia)
          //    These have schedule_text or recurrence but no concrete date,
          //    so they'd never match a date-range filter. Include them always.
          //    In "event" mode, only include recurring events (not activities).
          let recurringQuery = supabase
            .from("explore_items")
            .select("*")
            .is("starts_at", null)
            .is("deleted_at", null)
            .not("lat", "is", null)
            .not("lng", "is", null)
            .gte("priority", 0)
            .eq("is_duplicate", false)
            .or("review_status.is.null,review_status.in.(auto_approved,approved)")
            .or("schedule_text.not.is.null,recurrence.not.is.null");

          if (kindFilter === "event") {
            recurringQuery = recurringQuery.eq("kind", "event");
          }

          recurringQuery = applyFilters(recurringQuery);
          const { data: recurringData } = await recurringQuery.limit(200);

          // Merge and apply distance filter client-side
          const allEventCandidates = [...(eventData || []), ...(recurringData || [])];
          events = allEventCandidates.filter((item) => {
            if (!userLocation || !distanceMeters) return true;
            if (!item.lat || !item.lng) return false;
            const dist = getDistanceInMeters(
              userLocation.lat,
              userLocation.lng,
              item.lat,
              item.lng
            );
            return dist <= distanceMeters;
          });
        }

        // Fetch activities based on mode
        if (kindFilter === "all") {
          // "All" mode: activities within postable range (200m of user)
          if (userLocation) {
            const degreeRadius = (CHECK_IN_RADIUS_METERS / 111000) * 2;
            let activityQuery = supabase
              .from("explore_items")
              .select("*")
              .eq("kind", "activity")
              .is("deleted_at", null)
              .gte("lat", userLocation.lat - degreeRadius)
              .lte("lat", userLocation.lat + degreeRadius)
              .gte("lng", userLocation.lng - degreeRadius)
              .lte("lng", userLocation.lng + degreeRadius)
              .not("lat", "is", null)
              .not("lng", "is", null)
              .gte("priority", 0)
              .eq("is_duplicate", false)
              .or("review_status.is.null,review_status.in.(auto_approved,approved)");

            activityQuery = applyFilters(activityQuery);
            const { data: activityData } = await activityQuery.limit(100);

            activities = (activityData || []).filter((item) => {
              if (!item.lat || !item.lng) return false;
              const dist = getDistanceInMeters(
                userLocation.lat,
                userLocation.lng,
                item.lat,
                item.lng
              );
              return dist <= CHECK_IN_RADIUS_METERS;
            });
          }
        } else if (kindFilter === "activity") {
          // "Activities" mode: radius-based (1km or user distance setting)
          if (userLocation) {
            const activityRadius = Math.min(
              distanceMeters || MAP_ACTIVITIES_RADIUS_METERS,
              MAP_ACTIVITIES_RADIUS_METERS
            );
            const degreeRadius = (activityRadius / 111000) * 1.2;

            let activityQuery = supabase
              .from("explore_items")
              .select("*")
              .eq("kind", "activity")
              .is("deleted_at", null)
              .gte("lat", userLocation.lat - degreeRadius)
              .lte("lat", userLocation.lat + degreeRadius)
              .gte("lng", userLocation.lng - degreeRadius)
              .lte("lng", userLocation.lng + degreeRadius)
              .not("lat", "is", null)
              .not("lng", "is", null)
              .gte("priority", 0)
              .eq("is_duplicate", false)
              .or("review_status.is.null,review_status.in.(auto_approved,approved)");

            activityQuery = applyFilters(activityQuery);
            const { data: activityData } = await activityQuery.limit(500);

            const withDistance = (activityData || [])
              .map((item) => {
                const dist = getDistanceInMeters(
                  userLocation.lat,
                  userLocation.lng,
                  item.lat!,
                  item.lng!
                );
                return { item, dist };
              })
              .filter(({ dist }) => dist <= activityRadius)
              .sort((a, b) => a.dist - b.dist)
              .slice(0, MAP_ACTIVITIES_MAX_MARKERS);

            activities = withDistance.map(({ item }) => item);
          }
        }

        const combined = [...events, ...activities];
        // Deduplicate — recurring items can match both dated-event and recurring queries,
        // and "all" mode recurring query can overlap with the activities query.
        const seen = new Set<string>();
        const deduped = combined.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        setMapItems(deduped);

        // Update cache
        lastFetchRef.current = {
          filterKey: filterCacheKey,
          timestamp: now,
        };
      } catch (err) {
        console.error("[ExploreMapView] Fetch error:", err);
        setMapItems(
          fallbackItems.filter((i) => i.lat != null && i.lng != null)
        );
      } finally {
        setLoading(false);
      }
    },
    [
      filterCacheKey,
      kindFilter,
      userLocation,
      fallbackItems,
      getTimeWindowRange,
      getCategoryFilter,
      priceBucket,
      distance,
      tags,
    ]
  );

  // Fetch when any filter changes
  useEffect(() => {
    fetchMapItems();
  }, [filterCacheKey]);

  // Filter to mappable items
  const mappableItems = useMemo(
    () => mapItems.filter((item) => item.lat != null && item.lng != null),
    [mapItems]
  );

  // Derive selected item from ID (keeps marker rendering stable)
  const selectedItem = useMemo(
    () => (selectedItemId ? mappableItems.find((i) => i.id === selectedItemId) || null : null),
    [selectedItemId, mappableItems]
  );

  // Animate preview card in/out
  useEffect(() => {
    Animated.spring(previewAnim, {
      toValue: selectedItem ? 1 : 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  }, [selectedItem, previewAnim]);

  // Helper to select an item
  const selectItem = useCallback((item: ExploreItem | null) => {
    setSelectedItemId(item?.id || null);
  }, []);

  // Format helpers
  function formatDistance(item: ExploreItem): string | null {
    if (!userLocation || !item.lat || !item.lng) return null;
    const miles = getDistanceInMiles(
      userLocation.lat,
      userLocation.lng,
      item.lat,
      item.lng
    );
    if (miles < 0.1) return "Here";
    if (miles < 1) return `${(miles * 5280).toFixed(0)} ft`;
    return `${miles.toFixed(1)} mi`;
  }

  function formatDateTime(item: ExploreItem): string {
    if (item.starts_at) {
      return new Date(item.starts_at).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    // For activities with weekly hours, show compact "Open/Closed" summary
    if (item.schedule_text) {
      const { summaryLine } = formatOpeningHours(item.schedule_text);
      if (summaryLine) return summaryLine;
    }
    return item.time_text || "Ongoing";
  }

  // Count by type for badge
  const eventCount = mappableItems.filter((i) => i.kind === "event").length;
  const activityCount = mappableItems.filter((i) => i.kind === "activity").length;

  function getBadgeText(): string {
    if (kindFilter === "event") return `${eventCount} events`;
    if (kindFilter === "activity") return `${activityCount} activities`;
    if (eventCount > 0 && activityCount > 0) {
      return `${eventCount} events, ${activityCount} activities`;
    }
    if (eventCount > 0) return `${eventCount} events`;
    if (activityCount > 0) return `${activityCount} activities`;
    return "0 on map";
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        showsUserLocation={!isLocationOverridden()}
        showsMyLocationButton={!isLocationOverridden()}
        onPress={() => selectItem(null)}
        onMarkerPress={(e) => {
          // Use identifier from marker for reliable iOS tap handling
          const markerId = e.nativeEvent?.id;
          if (markerId) {
            const item = mappableItems.find((i) => i.id === markerId);
            if (item) {
              selectItem(item);
            }
          }
        }}
      >
        {mappableItems.map((item) => (
          <ThumbnailMarker
            key={item.id}
            item={item}
            isSelected={selectedItemId === item.id}
          />
        ))}
        {/* Custom "You are here" dot for review account (native blue dot disabled) */}
        {isLocationOverridden() && userLocation && (
          <Marker
            coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: "#007AFF",
              borderWidth: 3,
              borderColor: "#fff",
              shadowColor: "#007AFF",
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.4,
              shadowRadius: 4,
              elevation: 3,
            }} />
          </Marker>
        )}
      </MapView>

      {/* Item count badge */}
      <View
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 8,
          backgroundColor: colors.cardBg,
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.1,
          shadowRadius: 3,
          elevation: 2,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        {loading && <ActivityIndicator size="small" color={Colors.primary} />}
        <Text
          style={{ fontSize: 12, fontWeight: "600", color: colors.textSecondary }}
        >
          {getBadgeText()}
        </Text>
      </View>

      {/* Mode hint for Activities */}
      {kindFilter === "activity" && userLocation && (
        <View
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: colors.cardBg,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 10, color: colors.textTertiary }}>
            Nearby activities (within 1km)
          </Text>
        </View>
      )}

      {/* No items fallback */}
      {!loading && mappableItems.length === 0 && (
        <View
          style={{
            position: "absolute",
            top: "40%",
            left: 24,
            right: 24,
            padding: 20,
            borderRadius: 12,
            backgroundColor: colors.cardBg,
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons name="location-outline" size={32} color={colors.textTertiary} />
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
            {kindFilter === "activity"
              ? userLocation
                ? "No activities within 1km"
                : "Enable location to see nearby activities"
              : kindFilter === "event"
              ? "No upcoming events"
              : userLocation
              ? "No nearby activities or upcoming events"
              : "Enable location to see nearby activities"}
          </Text>
          <Text
            style={{ fontSize: 13, color: colors.textSecondary, textAlign: "center" }}
          >
            {kindFilter === "activity"
              ? userLocation
                ? "Try switching to list view for more options"
                : "Location is required for Activities map view"
              : "Try switching to list view for more options"}
          </Text>
        </View>
      )}

      {/* Bottom preview card - animated */}
      {selectedItem && (
        <Animated.View
          style={{
            position: "absolute",
            bottom: 24,
            left: 16,
            right: 16,
            opacity: previewAnim,
            transform: [
              {
                translateY: previewAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [50, 0],
                }),
              },
            ],
          }}
        >
          <Pressable
            onPress={() => router.push(`/event/${selectedItem.id}` as any)}
            style={{
              padding: 16,
              borderRadius: 14,
              backgroundColor: colors.cardBg,
              borderWidth: 1,
              borderColor: colors.border,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.15,
              shadowRadius: 8,
              elevation: 4,
              flexDirection: "row",
              gap: 12,
            }}
          >
            {/* Thumbnail in preview card — cached image or category fallback */}
            <Image
              source={{
                uri: selectedItem.image_thumb_url || selectedItem.image_url || getFallbackImage(selectedItem.category),
              }}
              style={{
                width: 60,
                height: 60,
                borderRadius: 8,
                backgroundColor: colors.surfaceVariant,
              }}
              resizeMode="cover"
            />

            <View style={{ flex: 1 }}>
              {/* Close button */}
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  selectItem(null);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  zIndex: 1,
                }}
              >
                <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
              </Pressable>

              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: colors.text,
                  paddingRight: 24,
                }}
                numberOfLines={1}
              >
                {selectedItem.title}
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color: selectedItem.kind === "event" ? "#FF6B6B" : "#4A90D9",
                    textTransform: "uppercase",
                  }}
                >
                  {selectedItem.kind}
                </Text>
                {selectedItem.category && (
                  <Text
                    style={{
                      fontSize: 11,
                      color: colors.textSecondary,
                    }}
                  >
                    {selectedItem.category}
                  </Text>
                )}
                {selectedItem.price_bucket &&
                  selectedItem.price_bucket !== "unknown" && (
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        color:
                          selectedItem.price_bucket === "free"
                            ? Colors.primary
                            : colors.textSecondary,
                      }}
                    >
                      {selectedItem.price_bucket === "free"
                        ? "Free"
                        : selectedItem.price_bucket}
                    </Text>
                  )}
              </View>

              <Text
                style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2, paddingRight: 56 }}
              >
                {formatDateTime(selectedItem)}
              </Text>

              <Text
                style={{ fontSize: 13, color: colors.textTertiary, marginTop: 2, paddingRight: 56 }}
                numberOfLines={1}
              >
                {[selectedItem.location_name, selectedItem.town]
                  .filter(Boolean)
                  .join(" \u00B7 ")}
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 6,
                  gap: 4,
                }}
              >
                {formatDistance(selectedItem) && (
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color: Colors.primary,
                    }}
                  >
                    {formatDistance(selectedItem)}
                  </Text>
                )}
                {formatDistance(selectedItem) && (
                  <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                    ·
                  </Text>
                )}
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: Colors.primary,
                  }}
                >
                  View details &rsaquo;
                </Text>
              </View>
            </View>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

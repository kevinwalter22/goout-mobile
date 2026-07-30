import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, Pressable, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";
import { getDistanceInMiles, isLocationOverridden } from "../utils/location";
import { formatOpeningHours } from "../utils/formatOpeningHours";
import { sanitizeTimeText } from "../utils/formatTimeText";
import { regionToBbox, bboxContains, type MapRegion } from "../utils/mapViewport";
import { getFallbackImage } from "../lib/categoryFallbackImages";
import { emojiForItem } from "../utils/mapEmoji";
import {
  regionToZoom,
  regionToPaddedBbox,
  selectVisiblePins,
  RENDER_PAD,
  type MapPoint,
} from "../lib/mapClustering";
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
  userId?: string;
  /** Active region — hard-scopes map markers to the current metro. */
  regionId?: string | null;
  // Filter props
  kindFilter: KindFilter;
  categories?: CategoryId[];
  priceBucket?: PriceBucket;
  timeWindow?: TimeWindow;
  distance?: DistanceRadius;
  tags?: string[];
}

// 7-day window for events
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Tier 3 map model (see docs/design/tier3_map_unification.md): fetch a whole
// region ONCE, hold it in memory, and pick which emoji pins to render with an
// Apple-Maps-style selection (mapClustering.selectVisiblePins) — notability
// tiered by zoom + a collision grid — so zooming in reveals pins additively and
// panning slides them in/out at the edges. No count bubbles, no per-marker
// <Image>. A native react-native-maps patch (patches/) fixes the New-Arch marker
// crash; this JS side keeps the rendered set small and stable.
const FETCH_LIMIT = 2000; // per-region fetch ceiling (Portland ≈ 600, so full)
// Far-guard for the no-region (pre-region-model, e.g. prod) path only: a metro
// bbox scopes the fetch, and zooming out past this blanks rather than scanning a
// whole state. With a region_id the fetch is already metro-bounded, no blank.
const MAP_MAX_VIEWPORT_DELTA = 1.2; // latitude degrees
const MAP_REGION_DEBOUNCE_MS = 350;
// No-region fetch scope: a generous metro box around the viewport center, so
// panning within a metro never refetches (only leaving it does).
const METRO_SCOPE_HALF_LAT = 0.4; // ~28 mi
const METRO_SCOPE_HALF_LNG = 0.5;

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

// Emoji teardrop marker (Tier 3, decision 5-A). Each pin shows an emoji that
// describes the place (picked from sub_category → category → kind), sitting in a
// teardrop whose tip points at the exact coordinate. The emoji is plain text, so
// the marker costs almost nothing to render — this is what replaces the photo
// thumbnails that used to exhaust native memory and crash the map. The photo
// still appears in the preview card on tap.
const PIN_HEAD = 38;

const EmojiTeardropMarker = React.memo(
  function EmojiTeardropMarker({
    item,
    isSelected,
  }: {
    item: ExploreItem;
    isSelected: boolean;
  }) {
    // Track view changes briefly on mount / selection change so the native view
    // rasterizes the current emoji + ring, then stop (nothing animates).
    const [tracks, setTracks] = useState(true);
    useEffect(() => {
      setTracks(true);
      const t = setTimeout(() => setTracks(false), 300);
      return () => clearTimeout(t);
    }, [isSelected]);

    const emoji = emojiForItem(item);
    // Euda purple ring/tail (selected = the darker purple). The emoji already
    // conveys what the place is, so the border is brand color, not a type color.
    const tint = isSelected ? Colors.primaryDark : Colors.primary;
    const head = isSelected ? PIN_HEAD + 6 : PIN_HEAD;

    return (
      <Marker
        identifier={item.id}
        coordinate={{ latitude: item.lat!, longitude: item.lng! }}
        anchor={{ x: 0.5, y: 1 }} // tip of the teardrop sits on the coordinate
        tracksViewChanges={tracks}
        zIndex={isSelected ? 10 : 1} // selected pin always renders on top
      >
        <View style={{ alignItems: "center" }}>
          <View
            style={{
              width: head,
              height: head,
              borderRadius: head / 2,
              backgroundColor: "#fff",
              borderWidth: isSelected ? 3 : 2,
              borderColor: tint,
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.28,
              shadowRadius: 3,
              elevation: 5,
            }}
          >
            <Text style={{ fontSize: isSelected ? 22 : 19 }}>{emoji}</Text>
          </View>
          {/* Downward pointer (teardrop tail) in the ring color. */}
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 7,
              borderRightWidth: 7,
              borderTopWidth: 10,
              borderLeftColor: "transparent",
              borderRightColor: "transparent",
              borderTopColor: tint,
              marginTop: -2,
            }}
          />
        </View>
      </Marker>
    );
  },
  // Only re-render if selection state or item id changes.
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
  userId,
  regionId,
  kindFilter,
  categories = [],
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

  // Cache to prevent duplicate fetches. Tracks the fetched bbox so we can skip
  // refetching when the user zooms in / nudges within an already-covered area —
  // but only when that fetch wasn't marker-capped (a capped fetch may be missing
  // markers that a tighter view should reveal).
  const lastFetchRef = useRef<{
    filterKey: string;
    timestamp: number;
    bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
    wasCapped: boolean;
  } | null>(null);

  // Latest map viewport (updated by onRegionChangeComplete). The map shows what
  // you're looking at, so the data query is driven by this region. Initialized
  // lazily against initialRegion (declared below) to avoid a TDZ reference.
  const regionRef = useRef<MapRegion | null>(null);
  const regionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The (zoom, padded bbox) the currently-rendered markers were clustered for.
  // We only re-cluster when the integer zoom changes or the viewport pans out of
  // this padded ring — so idle jitter and small pans never reshuffle the pins.
  const renderRef = useRef<{ zoom: number; padded: [number, number, number, number] } | null>(null);
  // Viewport in state (mirrors regionRef) so clustering recomputes when the user
  // zooms — the grid cell size is derived from the visible span. Updated on
  // gesture end (onRegionChangeComplete), so it changes once per pan/zoom, not
  // per frame.
  const [viewRegion, setViewRegion] = useState<MapRegion | null>(null);
  // True when the viewport is zoomed out past the county-scale ceiling — we stop
  // querying and prompt the user to zoom in rather than scan a whole state.
  const [zoomedOut, setZoomedOut] = useState(false);

  // Generate a cache key from all filter values
  const filterCacheKey = useMemo(
    () =>
      `${kindFilter}-${categories.join("+")}-${priceBucket}-${timeWindow}-${distance}-${tags.join(",")}-${regionId ?? "noregion"}-${userLocation ? "loc" : "noloc"}`,
    [kindFilter, categories, priceBucket, timeWindow, distance, tags, regionId, userLocation]
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

  // Map selected category IDs to database category values for map filtering
  const getCategoryFilter = useCallback((): string[] | null => {
    if (categories.length === 0) return null;
    const categoryMap: Record<CategoryId, string[]> = {
      all: [],
      music: ["music", "Music", "concert", "live_music", "Arts & Culture"],
      sports: ["sports", "Sports", "Sports & Recreation"],
      arts: ["arts", "Arts & Culture", "Arts & Theatre", "theatre", "theater"],
      entertainment: ["entertainment", "Entertainment", "Arts & Culture"],
      community: ["community", "Community", "Anchor"],
      food: ["food", "Food & Drink", "Food"],
      outdoors: ["outdoors", "Outdoor", "outdoor", "hiking", "nature"],
      nightlife: ["nightlife", "Nightlife", "bars", "clubs"],
    };
    const allValues = categories
      .filter((c) => c !== "all")
      .flatMap((c) => categoryMap[c] || []);
    const unique = [...new Set(allValues)];
    return unique.length > 0 ? unique : null;
  }, [categories]);

  // Fetch map items with all filters applied
  const fetchMapItems = useCallback(
    async (regionArg?: MapRegion) => {
      const now = Date.now();
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

        // The map shows the active metro. We fetch the whole scope ONCE and
        // cluster client-side, so panning/zooming never refetch.
        const region = regionArg || regionRef.current || initialRegion;

        // Far-guard for the no-region path only (pre-region-model, e.g. prod):
        // don't scan a whole state. With a region_id the fetch is metro-bounded.
        if (!regionId && region.latitudeDelta > MAP_MAX_VIEWPORT_DELTA) {
          setZoomedOut(true);
          setMapItems([]);
          lastFetchRef.current = null;
          setLoading(false);
          return;
        }
        setZoomedOut(false);

        // Fetch scope: the whole region (region_id path → a wide no-op box, the
        // region_id filter does the bounding) or a generous metro box around the
        // viewport center (no-region path).
        const scope = regionId
          ? { latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 }
          : {
              latMin: region.latitude - METRO_SCOPE_HALF_LAT,
              latMax: region.latitude + METRO_SCOPE_HALF_LAT,
              lngMin: region.longitude - METRO_SCOPE_HALF_LNG,
              lngMax: region.longitude + METRO_SCOPE_HALF_LNG,
            };

        // Skip the refetch when the same filters already loaded a scope that
        // still covers the current viewport — panning within a metro re-clusters
        // from memory instead of re-querying (this is what stops pins vanishing).
        const viewportBbox = regionToBbox(region);
        if (
          lastFetchRef.current &&
          lastFetchRef.current.filterKey === filterCacheKey &&
          bboxContains(lastFetchRef.current.bbox, viewportBbox)
        ) {
          setLoading(false);
          return;
        }

        // Bound the query to the fetch scope.
        const applyBbox = (q: any) =>
          q
            .gte("lat", scope.latMin)
            .lte("lat", scope.latMax)
            .gte("lng", scope.lngMin)
            .lte("lng", scope.lngMax);

        let events: ExploreItem[] = [];
        let activities: ExploreItem[] = [];

        // Helper to apply common filters to a query
        const applyFilters = (query: any) => {
          // Hard region boundary — the map only shows the active metro's items.
          if (regionId) {
            query = query.eq("region_id", regionId);
          }
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
          // Mirror the explore-feed filter: creator sees ALL their own events
          // regardless of review status (not just quarantined), so user-created
          // events always appear on the creator's map once they have coordinates.
          const reviewStatusFilter = userId
            ? `review_status.is.null,review_status.in.(auto_approved,approved),created_by_user_id.eq.${userId}`
            : "review_status.is.null,review_status.in.(auto_approved,approved)";

          let eventQuery = supabase
            .from("explore_items")
            .select("*")
            .eq("kind", "event")
            .is("deleted_at", null)
            .eq("is_admin_suppressed", false)
            .gte("starts_at", startDate.toISOString())
            .lte("starts_at", endDate.toISOString())
            .not("lat", "is", null)
            .not("lng", "is", null)
            .gte("priority", 0)
            .eq("is_duplicate", false)
            .or(reviewStatusFilter);

          eventQuery = applyFilters(applyBbox(eventQuery));
          const { data: eventData } = await eventQuery.limit(FETCH_LIMIT);

          // 2. Recurring items without starts_at (e.g., weekly wing night, trivia)
          //    These have schedule_text or recurrence but no concrete date,
          //    so they'd never match a date-range filter. Include them always.
          //    In "event" mode, only include recurring events (not activities).
          let recurringQuery = supabase
            .from("explore_items")
            .select("*")
            .is("starts_at", null)
            .is("deleted_at", null)
            .eq("is_admin_suppressed", false)
            .not("lat", "is", null)
            .not("lng", "is", null)
            .gte("priority", 0)
            .eq("is_duplicate", false)
            .or(reviewStatusFilter)
            .or("schedule_text.not.is.null,recurrence.not.is.null");

          if (kindFilter === "event") {
            recurringQuery = recurringQuery.eq("kind", "event");
          }

          recurringQuery = applyFilters(applyBbox(recurringQuery));
          const { data: recurringData } = await recurringQuery.limit(FETCH_LIMIT);

          // Scope already bounds these; clustering + LOD decide what renders.
          events = [...(eventData || []), ...(recurringData || [])];
        }

        // Fetch activities within the viewport ("all" and "activity" modes).
        if (kindFilter === "all" || kindFilter === "activity") {
          let activityQuery = supabase
            .from("explore_items")
            .select("*")
            .eq("kind", "activity")
            .is("deleted_at", null)
            .not("lat", "is", null)
            .not("lng", "is", null)
            .gte("priority", 0)
            .eq("is_duplicate", false)
            .or("review_status.is.null,review_status.in.(auto_approved,approved)");

          activityQuery = applyFilters(applyBbox(activityQuery));
          // Order by notability so that if a region ever exceeds FETCH_LIMIT we
          // keep the most notable items (notability_score isn't in the stale
          // generated types yet — cast the column name).
          const { data: activityData } = await activityQuery
            .order("notability_score" as any, { ascending: false, nullsFirst: false })
            .limit(FETCH_LIMIT);
          activities = activityData || [];
        }

        // Deduplicate — recurring items can match both the dated-event and
        // recurring queries, and the activities query can overlap the recurring one.
        const seen = new Set<string>();
        const deduped = [...events, ...activities].filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });

        // Hold the whole scope in memory; Supercluster + the zoom LOD decide
        // what actually renders. No proximity cap here — that's what made pins
        // vanish when the viewport center moved during a pan.
        setMapItems(deduped);

        // Remember the scope we fetched so panning within it skips the refetch.
        lastFetchRef.current = {
          filterKey: filterCacheKey,
          timestamp: now,
          bbox: scope,
          wasCapped: deduped.length >= FETCH_LIMIT,
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
      userId,
      regionId,
      fallbackItems,
      getTimeWindowRange,
      getCategoryFilter,
      priceBucket,
      tags,
      initialRegion,
    ]
  );

  // Refetch the current viewport when any filter changes.
  useEffect(() => {
    fetchMapItems(regionRef.current ?? undefined);
  }, [filterCacheKey]);

  // On pan/zoom: always re-cluster from the in-memory index (instant), and only
  // refetch when the viewport has left the loaded scope. Panning within a metro
  // never re-queries, so on-screen pins persist and nothing flickers.
  const handleRegionChangeComplete = useCallback(
    (newRegion: MapRegion) => {
      regionRef.current = newRegion;
      const vb = regionToBbox(newRegion);

      // Re-cluster ONLY on a real zoom change or when the viewport pans out of the
      // padded ring we last rendered. This is what stops emojis from popping in
      // and out on idle/small pans — the marker set is stable until you actually
      // zoom or pan somewhere new.
      const z = regionToZoom(newRegion);
      const rr = renderRef.current;
      const stillRendered =
        rr != null &&
        rr.zoom === z &&
        rr.padded[0] <= vb.lngMin &&
        rr.padded[2] >= vb.lngMax &&
        rr.padded[1] <= vb.latMin &&
        rr.padded[3] >= vb.latMax;
      if (!stillRendered) {
        renderRef.current = { zoom: z, padded: regionToPaddedBbox(newRegion, RENDER_PAD) };
        setViewRegion(newRegion);
      }

      // Refetch data only when the viewport leaves the already-fetched scope.
      const covered =
        lastFetchRef.current &&
        lastFetchRef.current.filterKey === filterCacheKey &&
        bboxContains(lastFetchRef.current.bbox, vb);
      if (covered) return;
      if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
      regionDebounceRef.current = setTimeout(() => {
        fetchMapItems(newRegion);
      }, MAP_REGION_DEBOUNCE_MS);
    },
    [fetchMapItems, filterCacheKey]
  );

  // Clear any pending debounce on unmount.
  useEffect(
    () => () => {
      if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    },
    []
  );

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

  // Map id -> item, for marker taps and the preview card.
  const itemById = useMemo(() => {
    const m = new Map<string, ExploreItem>();
    for (const it of mappableItems) m.set(it.id, it);
    return m;
  }, [mappableItems]);

  // Lightweight point list for the selection math.
  const points = useMemo<MapPoint[]>(
    () =>
      mappableItems.map((it) => ({
        id: it.id,
        lat: it.lat as number,
        lng: it.lng as number,
        notability: (it as any).notability_score ?? 0,
      })),
    [mappableItems]
  );

  // Which pins to render (Apple-Maps model, see docs/design/tier3_map_unification):
  // notability-tiered by zoom + a collision grid so pins never overlap, revealed
  // ADDITIVELY as you zoom in (a visible pin never vanishes on zoom-in). The
  // selected pin is always included, so a tap can never make it disappear.
  // Recomputes only when the region (guarded to zoom-change / big-pan) or the
  // selection changes — never on idle jitter.
  const visibleMarkers = useMemo<ExploreItem[]>(() => {
    const region = viewRegion ?? initialRegion;
    const ids = selectVisiblePins(points, region, selectedItemId);
    const out: ExploreItem[] = [];
    for (const id of ids) {
      const item = itemById.get(id);
      if (item) out.push(item);
    }
    return out;
  }, [points, viewRegion, initialRegion, selectedItemId, itemById]);

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
    return item.time_text ? sanitizeTimeText(item.time_text) : "Ongoing";
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
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation={!isLocationOverridden()}
        showsMyLocationButton={!isLocationOverridden()}
        onPress={() => selectItem(null)}
        onMarkerPress={(e) => {
          // Use identifier from marker for reliable iOS tap handling.
          const markerId = e.nativeEvent?.id;
          if (!markerId) return;
          const item = itemById.get(markerId);
          if (item) {
            selectItem(item);
          }
        }}
      >
        {visibleMarkers.map((item) => (
          <EmojiTeardropMarker
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
              backgroundColor: Colors.primary,
              borderWidth: 3,
              borderColor: "#fff",
              shadowColor: Colors.primary,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.4,
              shadowRadius: 4,
              elevation: 3,
            }} />
          </Marker>
        )}
      </MapView>

      {/* Zoom-out ceiling: prompt to zoom in rather than scan a whole state */}
      {zoomedOut && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: "45%",
            alignSelf: "center",
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 20,
            backgroundColor: colors.cardBg,
            borderWidth: 1,
            borderColor: colors.border,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.15,
            shadowRadius: 4,
            elevation: 3,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Ionicons name="search" size={14} color={colors.textSecondary} />
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textSecondary }}>
            Zoom in to load events
          </Text>
        </View>
      )}

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

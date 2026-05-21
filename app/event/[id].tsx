import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useAdmin } from "../../src/hooks/useAdmin";
import { useExploreItemRSVP } from "../../src/hooks/useExploreItemRSVP";
import { usePlaceDetails } from "../../src/hooks/usePlaceDetails";
import { verifyCheckInLocation, getLocationPermissionStatus } from "../../src/utils/location";
import { openDirections, hasLocationData } from "../../src/utils/maps";
import { shareItem } from "../../src/utils/share";
import { logInteraction } from "../../src/lib/interactionLogger";
import { logAnalyticsEvent } from "../../src/lib/analyticsLogger";
import { useItemFeedback, type FeedbackType } from "../../src/hooks/useItemFeedback";
import { FriendsGoingSheet } from "../../src/components/FriendsGoingSheet";
import { AdminEditSheet } from "../../src/components/AdminEditSheet";
import { ReportSheet } from "../../src/components/ReportSheet";
import { POSTABLE_NOW_CONFIG } from "../../src/config/exploreFilters";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import type { ExploreItem } from "../../src/types/database";
import { captureError } from "../../src/lib/logger";
import { friendlyMessage } from "../../src/lib/errorMessages";
import { getFallbackImage } from "../../src/lib/categoryFallbackImages";
import { formatOpeningHours } from "../../src/utils/formatOpeningHours";

/** Returns true for any Google Maps URL — these should not appear as "MORE INFO" links
 *  because the detail screen already has a dedicated "Open in Google Maps" CTA. */
function isGoogleMapsUrl(url: string): boolean {
  return /maps\.google\.|google\.com\/maps|goo\.gl\/maps/i.test(url);
}

export default function EventDetail() {
  const { id, title: fallbackTitle, creatorId } = useLocalSearchParams<{
    id: string;
    title?: string;
    /** Present on user-created event share links — used to show an add-friend
     *  CTA when the viewer doesn't have access (not friends with creator). */
    creatorId?: string;
  }>();
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const { colors } = useTheme();
  const [item, setItem] = useState<ExploreItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [friendsGoingCount, setFriendsGoingCount] = useState(0);
  const [showFriendsGoing, setShowFriendsGoing] = useState(false);
  const [showAdminEdit, setShowAdminEdit] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [privateEventCreator, setPrivateEventCreator] = useState<{ username: string } | null>(null);

  // Check if current user is the creator of this event
  const isUserCreated = item?.created_by_user_id === user?.id;

  const {
    isGoing,
    goingCount,
    loading: rsvpLoading,
    toggleRSVP,
  } = useExploreItemRSVP(id || "", { tags: item?.tags ?? undefined, itemKind: item?.kind ?? undefined });

  const { details: placeDetails, loading: detailsLoading } = usePlaceDetails(id);

  const {
    currentFeedback,
    submitting: feedbackSubmitting,
    submitFeedback,
  } = useItemFeedback(id || "");

  // Determine if the event has ended (activities never "end").
  const isEnded = useMemo(() => {
    if (!item || !item.starts_at) return false;
    const now = Date.now();
    const endTime = item.ends_at
      ? new Date(item.ends_at).getTime()
      : new Date(item.starts_at).getTime() + 3 * 60 * 60 * 1000;
    return now > endTime;
  }, [item]);

  async function handleCheckIn() {
    if (!item) return;

    // Time check: events must be currently happening, activities are always postable
    if (item.starts_at) {
      const now = Date.now();
      const startTime = new Date(item.starts_at).getTime();
      const endTime = item.ends_at
        ? new Date(item.ends_at).getTime()
        : startTime + 3 * 60 * 60 * 1000; // Default 3 hours if no end time

      const preBufferMs = POSTABLE_NOW_CONFIG.preEventBuffer * 60 * 1000;

      if (now < startTime - preBufferMs) {
        const minutesUntil = Math.ceil((startTime - now) / (60 * 1000));
        const totalHours = Math.floor(minutesUntil / 60);
        const remMins = minutesUntil % 60;
        const days = Math.floor(totalHours / 24);
        const remHours = totalHours % 24;
        const timeText = days >= 2
          ? (remHours >= 2 ? `${days} days ${remHours} hours` : `${days} days`)
          : totalHours >= 1
            ? `${totalHours}h${remMins > 0 ? ` ${remMins}m` : ""}`
            : `${minutesUntil} minutes`;
        Alert.alert(
          "Event Not Started",
          `This event starts in ${timeText}. You can check in starting 1 hour before it begins.`,
        );
        return;
      }

      if (now > endTime) {
        Alert.alert(
          "Event Ended",
          "This event has already ended. Check-in is no longer available.",
        );
        return;
      }
    }

    if (!item.lat || !item.lng) {
      Alert.alert(
        "Location Not Available",
        "This event doesn't have a location set yet. Check-in requires a valid location.",
      );
      return;
    }

    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Check-in is only available on mobile");
      return;
    }

    // Show in-app explanation before the OS location prompt fires on first use.
    // Users who understand the context are far more likely to tap "Allow".
    const locationStatus = await getLocationPermissionStatus();
    if (locationStatus === "undetermined") {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Location Needed for Check-In",
          "Euda uses your location to verify you\u2019re at the venue. Your location is only used during check-in and is never stored.",
          [
            { text: "Not Now", style: "cancel", onPress: () => resolve(false) },
            { text: "Continue", onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }

    setCheckingIn(true);

    try {
      const { allowed, denied, error } = await verifyCheckInLocation(
        item.lat,
        item.lng,
      );

      if (!allowed) {
        if (denied) {
          Alert.alert(
            "Enable Location for Euda",
            "Euda needs your location to verify you\u2019re at the venue for check-ins and to show nearby activities.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Settings",
                onPress: () => {
                  if (Platform.OS === "ios") {
                    Linking.openURL("app-settings:");
                  } else {
                    Linking.openSettings();
                  }
                },
              },
            ],
          );
        } else {
          Alert.alert("Cannot Check In", error || "You must be at the location");
        }
        return;
      }

      // Log post_started analytics event
      if (user) {
        logAnalyticsEvent(user.id, "post_started", { itemKind: item.kind });
      }

      // Navigate to camera mode selector (pass itemKind for interaction logging)
      router.push(`/checkin/${item.id}?itemKind=${item.kind}` as any);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to verify location",
      );
    } finally {
      setCheckingIn(false);
    }
  }

  // When we have a creatorId from the share link but the event query fails,
  // fetch the creator's username so we can personalise the "private event" screen.
  useEffect(() => {
    if (!creatorId || item) return;
    supabase
      .from("profiles")
      .select("username")
      .eq("id", creatorId)
      .single()
      .then(({ data }) => {
        if (data) setPrivateEventCreator(data as { username: string });
      });
  }, [creatorId, item]);

  useEffect(() => {
    if (!id) return;

    async function loadItem() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("explore_items")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        setError(error.message);
        setItem(null);
      } else {
        setItem(data);
      }

      // Load friends going count
      if (user) {
        const { data: friendships } = await supabase
          .from("friendships")
          .select("user_id, friend_id")
          .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

        const friendIds = (friendships || []).map((f: any) =>
          f.user_id === user.id ? f.friend_id : f.user_id
        );

        if (friendIds.length > 0) {
          const { data: friendRSVPs } = await supabase
            .from("explore_item_rsvps")
            .select("user_id")
            .eq("explore_item_id", id)
            .in("user_id", friendIds);

          setFriendsGoingCount(friendRSVPs?.length ?? 0);
        }
      }

      setLoading(false);
    }

    loadItem();
  }, [id, user]);

  // Format date/time for display
  function formatDateTime() {
    if (!item) return "";
    if (item.starts_at) {
      const dateStr = new Date(item.starts_at).toLocaleString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      if (item.recurrence === "weekly") {
        return `${dateStr}\nRepeats every ${new Date(item.starts_at).toLocaleDateString("en-US", { weekday: "long" })}`;
      }
      if (item.recurrence === "monthly") {
        return `${dateStr}\nRepeats monthly`;
      }
      return dateStr;
    }
    if (item.time_text) {
      return item.time_text;
    }
    if (item.schedule_text) {
      // Prefer the compact summary ("Open · Closes at 8 PM") over the raw
      // Google Places weekday string ("Monday: Closed; Tuesday: ..."). The
      // raw form was leaking through to the WHEN slot on venues like Sugar
      // Loaf PAC where no enrichment-generated time_text exists.
      const { summaryLine } = formatOpeningHours(item.schedule_text);
      if (summaryLine) return summaryLine;
      return item.schedule_text;
    }
    return "Ongoing";
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader />
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !item) {
    // Private event — viewer is not friends with the creator.
    // creatorId is embedded in the share link so we can show a contextual CTA.
    if (creatorId) {
      const creatorHandle = privateEventCreator
        ? `@${privateEventCreator.username}`
        : "the creator";
      return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <Stack.Screen options={{ headerShown: false }} />
          <ScreenHeader />
          <View style={{ flex: 1, padding: 24, justifyContent: "center", alignItems: "center", gap: 12 }}>
            <Ionicons name="lock-closed-outline" size={48} color={colors.textTertiary} />
            <Text style={{ fontSize: 18, fontWeight: "600", textAlign: "center", color: colors.text }}>
              This event is private
            </Text>
            <Text style={{ fontSize: 14, textAlign: "center", color: colors.textSecondary }}>
              Only friends of {creatorHandle} can view this event.
            </Text>
            <Pressable
              onPress={() => router.push(`/user/${creatorId}` as any)}
              accessibilityLabel={`View ${creatorHandle}'s profile`}
              accessibilityRole="button"
              style={{
                marginTop: 8,
                paddingHorizontal: 24,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: Colors.primary,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
                View {creatorHandle}&apos;s Profile
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              accessibilityLabel="Go back"
              accessibilityRole="button"
              style={{
                paddingHorizontal: 24,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.surfaceVariant,
              }}
            >
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>Go Back</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    // Generic error (deleted, expired, not found)
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader />
        <View style={{ flex: 1, padding: 24, justifyContent: "center", alignItems: "center", gap: 12 }}>
          <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
          <Text style={{ fontSize: 18, fontWeight: "600", textAlign: "center", color: colors.text }}>
            This event is no longer available
          </Text>
          {fallbackTitle && (
            <Text style={{ fontSize: 16, textAlign: "center", color: colors.textSecondary, fontStyle: "italic" }}>
              {fallbackTitle}
            </Text>
          )}
          <Text style={{ fontSize: 14, textAlign: "center", color: colors.textTertiary }}>
            The event may have ended or been removed.
          </Text>
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            style={{
              marginTop: 12,
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: Colors.primary,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Handle share
  const handleShare = async () => {
    const shared = await shareItem({
      title: item.title,
      locationName: item.location_name,
      town: item.town,
      startsAt: item.starts_at,
      scheduleText: item.schedule_text,
      itemId: item.id,
      creatorId: item.created_by_user_id ?? undefined,
    });
    if (shared && user) {
      logInteraction({
        userId: user.id,
        exploreItemId: item.id,
        eventType: "share",
        itemKind: item.kind,
      });
    }
  };

  // Handle edit (for user-created events)
  const handleEdit = () => {
    router.push(`/edit-event/${item.id}` as any);
  };

  // Handle delete (for user-created events)
  const isRecurring = item?.recurrence && !["none", ""].includes(item.recurrence);
  const handleDelete = () => {
    Alert.alert(
      isRecurring ? "Delete Recurring Event" : "Delete Event",
      isRecurring
        ? "Are you sure? This will stop all future occurrences of this event."
        : "Are you sure you want to delete this event? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!user) return;
            setDeleting(true);
            try {
              const { error: deleteError } = await supabase
                .from("explore_items")
                .delete()
                .eq("id", item.id)
                .eq("created_by_user_id", user.id);

              if (deleteError) {
                captureError(deleteError, { action: "deleteEvent" });
                Alert.alert("Error", friendlyMessage(deleteError));
              } else {
                router.back();
              }
            } catch (err) {
              captureError(err, { action: "deleteEvent" });
              Alert.alert("Error", "Failed to delete event");
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        right={
          <Pressable
            onPress={handleShare}
            accessibilityLabel="Share"
            accessibilityRole="button"
            style={{
              padding: 8,
              borderRadius: 20,
              backgroundColor: Colors.primary + "18",
            }}
            hitSlop={8}
          >
            <Ionicons name="share-outline" size={22} color={Colors.primary} />
          </Pressable>
        }
      />
      <ScrollView style={{ flex: 1 }}>
        {/* Event Ended Banner */}
        {isEnded && (
          <View
            style={{
              margin: 16,
              marginBottom: 0,
              padding: 12,
              borderRadius: 10,
              backgroundColor: colors.surfaceVariant,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.textSecondary }}>
              This event has ended
            </Text>
          </View>
        )}

        {/* Header Image — cached image or category fallback */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Image
            source={{ uri: item.image_url || getFallbackImage(item.category) }}
            style={{
              width: "100%",
              height: 200,
              borderRadius: 16,
              backgroundColor: colors.surfaceVariant,
            }}
            resizeMode="cover"
          />
        </View>

        <View style={{ padding: 24, gap: 24 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 28, fontWeight: "700", color: colors.text }}>
              {item.title}
            </Text>
            {item.hook_line && (
              <Text style={{ fontSize: 16, color: colors.textSecondary, fontStyle: "italic" }}>
                {item.hook_line}
              </Text>
            )}
            {item.category && (
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.textSecondary }}>
                #{item.category}
              </Text>
            )}
          </View>

          {item.description && (
            <Text style={{ fontSize: 15, lineHeight: 22, color: colors.textSecondary }}>
              {item.description}
            </Text>
          )}

          <View
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: colors.cardBg,
              borderWidth: 1,
              borderColor: colors.border,
              gap: 12,
            }}
          >
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                  WHEN
                </Text>
                {item.recurrence && !["none", ""].includes(item.recurrence) && (
                  <Ionicons name="repeat" size={14} color={Colors.primary} />
                )}
              </View>
              <Text style={{ fontSize: 16, color: colors.text }}>
                {formatDateTime()}
              </Text>
            </View>

            {(item.location_name || item.town || item.address) && (
              <View style={{ gap: 4 }}>
                <Text
                  style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}
                >
                  WHERE
                </Text>
                <Text style={{ fontSize: 16, color: colors.text }}>
                  {[item.location_name, item.town].filter(Boolean).join(", ")}
                </Text>
                {item.address && (
                  <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                    {item.address}
                  </Text>
                )}
                {hasLocationData(item) && (
                  <Pressable
                    onPress={() =>
                      openDirections({
                        lat: item.lat,
                        lng: item.lng,
                        address: item.address,
                        label: item.location_name || item.title,
                      })
                    }
                    accessibilityLabel="Get directions"
                    accessibilityRole="button"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 8,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      backgroundColor: Colors.primary,
                      borderRadius: 8,
                      alignSelf: "flex-start",
                    }}
                  >
                    <Ionicons name="navigate" size={16} color={Colors.white} />
                    <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.white }}>
                      Directions
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {item.price_bucket && item.price_bucket !== "unknown" && (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                  COST
                </Text>
                <Text style={{ fontSize: 16, color: colors.text }}>
                  {item.price_bucket === "free" ? "Free" : item.price_bucket}
                </Text>
              </View>
            )}

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                {item.kind === "activity" ? "GOING TODAY" : "GOING"}
              </Text>
              <Text style={{ fontSize: 16, color: colors.text }}>
                {rsvpLoading ? "..." : `${goingCount} ${goingCount === 1 ? "person" : "people"}`}
              </Text>
              {friendsGoingCount > 0 && (
                <Pressable
                  onPress={() => setShowFriendsGoing(true)}
                  accessibilityLabel={`${friendsGoingCount} ${friendsGoingCount === 1 ? "friend" : "friends"} going — tap to view`}
                  accessibilityRole="button"
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.primary, marginTop: 4 }}>
                    {friendsGoingCount} {friendsGoingCount === 1 ? "friend" : "friends"} going →
                  </Text>
                </Pressable>
              )}
            </View>

            {item.source_url && /^https?:\/\//i.test(item.source_url) && !isGoogleMapsUrl(item.source_url) && (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                  MORE INFO
                </Text>
                <Pressable
                  onPress={() => Linking.openURL(item.source_url!)}
                  accessibilityLabel="Learn more about this event"
                  accessibilityRole="link"
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Text style={{ fontSize: 15, color: Colors.primary }} numberOfLines={1}>
                    {item.source_url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                  </Text>
                  <Ionicons name="open-outline" size={14} color={Colors.primary} />
                </Pressable>
              </View>
            )}
          </View>

          {/* Place Details (lazy-loaded for Google Places items) */}
          {placeDetails && (
            <View
              style={{
                padding: 16,
                borderRadius: 12,
                backgroundColor: colors.cardBg,
                borderWidth: 1,
                borderColor: colors.border,
                gap: 12,
              }}
            >
              {placeDetails.rating != null && (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                    RATING
                  </Text>
                  <Text style={{ fontSize: 16, color: colors.text }}>
                    {placeDetails.rating.toFixed(1)} / 5
                    {placeDetails.user_rating_count
                      ? ` (${placeDetails.user_rating_count} reviews)`
                      : ""}
                  </Text>
                </View>
              )}

              {placeDetails.phone_number && (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                    PHONE
                  </Text>
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${placeDetails.phone_number!.replace(/[^+\d]/g, "")}`)}
                    accessibilityLabel={`Call ${placeDetails.phone_number}`}
                    accessibilityRole="link"
                  >
                    <Text style={{ fontSize: 16, color: Colors.primary }}>
                      {placeDetails.phone_number}
                    </Text>
                  </Pressable>
                </View>
              )}

              {placeDetails.website_uri && /^https?:\/\//i.test(placeDetails.website_uri) && (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                    WEBSITE
                  </Text>
                  <Pressable
                    onPress={() => Linking.openURL(placeDetails.website_uri!)}
                    accessibilityLabel="Open website"
                    accessibilityRole="link"
                  >
                    <Text style={{ fontSize: 16, color: Colors.primary }} numberOfLines={1}>
                      {placeDetails.website_uri.replace(/^https?:\/\/(www\.)?/, "")}
                    </Text>
                  </Pressable>
                </View>
              )}

              {placeDetails.reviews.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                    REVIEWS
                  </Text>
                  {placeDetails.reviews.slice(0, 3).map((review, i) => (
                    <View key={i} style={{ gap: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
                        {review.author} — {review.rating}/5
                      </Text>
                      <Text style={{ fontSize: 14, color: colors.textSecondary }} numberOfLines={3}>
                        {review.text}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {placeDetails.google_maps_uri && /^https?:\/\//i.test(placeDetails.google_maps_uri) && (
                <Pressable
                  onPress={() => Linking.openURL(placeDetails.google_maps_uri!)}
                  accessibilityLabel="Open in Google Maps"
                  accessibilityRole="link"
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.primary }}>
                    Open in Google Maps
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {detailsLoading && (
            <View style={{ alignItems: "center", paddingVertical: 8 }}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          )}

          {!isEnded && (
            <View style={{ gap: 12 }}>
              {/* RSVP button — events and activities */}
              <Pressable
                onPress={toggleRSVP}
                disabled={rsvpLoading}
                accessibilityLabel={
                  isGoing
                    ? item.kind === "activity" ? "Going today — tap to cancel" : "I'm going — tap to cancel"
                    : item.kind === "activity" ? "I'm going today" : "I'm going"
                }
                accessibilityRole="button"
                accessibilityState={{ disabled: rsvpLoading }}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: isGoing ? colors.background : colors.text,
                  borderWidth: isGoing ? 2 : 0,
                  borderColor: colors.text,
                  alignItems: "center",
                }}
              >
                {rsvpLoading ? (
                  <ActivityIndicator color={isGoing ? colors.text : colors.background} />
                ) : (
                  <Text
                    style={{
                      color: isGoing ? colors.text : colors.background,
                      fontSize: 16,
                      fontWeight: "600",
                    }}
                  >
                    {isGoing
                      ? item.kind === "activity"
                        ? "✓ Going Today"
                        : "✓ I'm Going"
                      : item.kind === "activity"
                        ? "I'm Going Today"
                        : "I'm Going"}
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={handleCheckIn}
                disabled={checkingIn}
                accessibilityLabel={item.kind === "activity" ? "Post" : "Check in and post"}
                accessibilityRole="button"
                accessibilityState={{ disabled: checkingIn }}
                style={{
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: colors.text,
                  alignItems: "center",
                }}
              >
                {checkingIn ? (
                  <ActivityIndicator color={colors.background} />
                ) : (
                  <Text
                    style={{
                      color: colors.background,
                      fontSize: 16,
                      fontWeight: "600",
                    }}
                  >
                    {item.kind === "activity" ? "Post" : "Check In & Post"}
                  </Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Community feedback buttons */}
          {user && (
            <View
              style={{
                paddingTop: 16,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                gap: 10,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                HOW WAS THIS?
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(
                  [
                    { type: "upvote" as FeedbackType, label: "Useful", icon: "thumbs-up-outline" as const, color: Colors.success },
                    { type: "confirm" as FeedbackType, label: "Confirmed", icon: "checkmark-circle-outline" as const, color: Colors.primary },
                    { type: "downvote" as FeedbackType, label: "Irrelevant", icon: "thumbs-down-outline" as const, color: Colors.warning },
                    { type: "report_closed" as FeedbackType, label: "Closed", icon: "close-circle-outline" as const, color: Colors.error },
                  ] as const
                ).map((btn) => {
                  const isActive = currentFeedback === btn.type;
                  return (
                    <Pressable
                      key={btn.type}
                      onPress={() => submitFeedback(btn.type)}
                      disabled={feedbackSubmitting}
                      accessibilityLabel={btn.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive, disabled: feedbackSubmitting }}
                      style={{
                        flex: 1,
                        alignItems: "center",
                        gap: 4,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: isActive ? btn.color : colors.border,
                        backgroundColor: isActive ? btn.color + "15" : "transparent",
                      }}
                    >
                      <Ionicons
                        name={btn.icon}
                        size={18}
                        color={isActive ? btn.color : colors.textSecondary}
                      />
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: isActive ? "600" : "400",
                          color: isActive ? btn.color : colors.textSecondary,
                        }}
                      >
                        {btn.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Edit/Delete for user-created events */}
          {isUserCreated && (
            <View
              style={{
                paddingTop: 16,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                gap: 12,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                YOUR EVENT
              </Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable
                  onPress={handleEdit}
                  accessibilityLabel="Edit event"
                  accessibilityRole="button"
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: colors.surfaceVariant,
                  }}
                >
                  <Ionicons name="pencil" size={18} color={colors.text} />
                  <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
                    Edit
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleDelete}
                  disabled={deleting}
                  accessibilityLabel="Delete event"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: deleting }}
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: Colors.error + "15",
                  }}
                >
                  {deleting ? (
                    <ActivityIndicator color={Colors.error} size="small" />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={18} color={Colors.error} />
                      <Text style={{ fontSize: 16, fontWeight: "600", color: Colors.error }}>
                        Delete
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {/* Report listing — shown to logged-in users who didn't create this item */}
          {user && !isUserCreated && (
            <Pressable
              onPress={() => setShowReport(true)}
              accessibilityLabel="Report this listing"
              accessibilityRole="button"
              style={{ alignItems: "center", paddingVertical: 8 }}
            >
              <Text style={{ fontSize: 13, color: colors.textTertiary }}>
                Report this listing
              </Text>
            </Pressable>
          )}

          {/* Admin Edit - only visible to admins */}
          {isAdmin && !isUserCreated && (
            <View
              style={{
                paddingTop: 16,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                gap: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="shield-checkmark" size={14} color={Colors.primary} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                  ADMIN
                </Text>
              </View>
              <Pressable
                onPress={() => setShowAdminEdit(true)}
                accessibilityLabel="Edit item"
                accessibilityRole="button"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: Colors.primary + "15",
                }}
              >
                <Ionicons name="create-outline" size={18} color={Colors.primary} />
                <Text style={{ fontSize: 16, fontWeight: "600", color: Colors.primary }}>
                  Edit Item
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Report Modal */}
      {item && (
        <ReportSheet
          visible={showReport}
          onClose={() => setShowReport(false)}
          targetType="explore_item"
          targetId={item.id}
        />
      )}

      {/* Friends Going Modal */}
      <FriendsGoingSheet
        visible={showFriendsGoing}
        onClose={() => setShowFriendsGoing(false)}
        eventId={id || null}
        eventTitle={item?.title || "Event"}
      />

      {/* Admin Edit Modal */}
      {isAdmin && item && (
        <AdminEditSheet
          visible={showAdminEdit}
          onClose={() => setShowAdminEdit(false)}
          item={item}
          onSaved={async () => {
            // Reload the item after admin saves
            const { data } = await supabase
              .from("explore_items")
              .select("*")
              .eq("id", id)
              .single();
            if (data) setItem(data);
          }}
        />
      )}
    </View>
  );
}

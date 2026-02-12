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
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useAdmin } from "../../src/hooks/useAdmin";
import { useExploreItemRSVP } from "../../src/hooks/useExploreItemRSVP";
import { usePlaceDetails } from "../../src/hooks/usePlaceDetails";
import { verifyCheckInLocation } from "../../src/utils/location";
import { openDirections, hasLocationData } from "../../src/utils/maps";
import { shareItem } from "../../src/utils/share";
import { logInteraction } from "../../src/lib/interactionLogger";
import { logAnalyticsEvent } from "../../src/lib/analyticsLogger";
import { FriendsGoingSheet } from "../../src/components/FriendsGoingSheet";
import { AdminEditSheet } from "../../src/components/AdminEditSheet";
import { POSTABLE_NOW_CONFIG } from "../../src/config/exploreFilters";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import type { ExploreItem } from "../../src/types/database";

export default function EventDetail() {
  const { id, title: fallbackTitle } = useLocalSearchParams<{ id: string; title?: string }>();
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
  const [deleting, setDeleting] = useState(false);

  // Check if current user is the creator of this event
  const isUserCreated = item?.created_by_user_id === user?.id;

  const {
    isGoing,
    goingCount,
    loading: rsvpLoading,
    toggleRSVP,
  } = useExploreItemRSVP(id || "", { tags: item?.tags, itemKind: item?.kind });

  const { details: placeDetails, loading: detailsLoading } = usePlaceDetails(id);

  // Determine if the event has ended (activities never "end")
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
      const postBufferMs = POSTABLE_NOW_CONFIG.postEventBuffer * 60 * 1000;

      if (now < startTime - preBufferMs) {
        const minutesUntil = Math.ceil((startTime - now) / (60 * 1000));
        const timeText = minutesUntil > 60
          ? `${Math.floor(minutesUntil / 60)}h ${minutesUntil % 60}m`
          : `${minutesUntil} minutes`;
        Alert.alert(
          "Event Not Started",
          `This event starts in ${timeText}. You can check in starting 1 hour before it begins.`,
        );
        return;
      }

      if (now > endTime + postBufferMs) {
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

    setCheckingIn(true);

    try {
      const { allowed, error } = await verifyCheckInLocation(
        item.lat,
        item.lng,
      );

      if (!allowed) {
        Alert.alert("Cannot Check In", error || "You must be at the location");
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
      return new Date(item.starts_at).toLocaleString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    if (item.time_text) {
      return item.time_text;
    }
    if (item.schedule_text) {
      return item.schedule_text;
    }
    return "Ongoing";
  }

  const headerOptions = {
    headerShown: true,
    headerBackTitle: "Back",
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
    headerTitleStyle: { color: colors.text },
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: "Event", ...headerOptions }} />
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: fallbackTitle || "Event", ...headerOptions }} />
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
  const handleDelete = () => {
    Alert.alert(
      "Delete Event",
      "Are you sure you want to delete this event? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const { error: deleteError } = await supabase
                .from("explore_items")
                .delete()
                .eq("id", item.id)
                .eq("created_by_user_id", user?.id);

              if (deleteError) {
                Alert.alert("Error", deleteError.message);
              } else {
                router.back();
              }
            } catch (err) {
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
      <Stack.Screen
        options={{
          title: item.title,
          ...headerOptions,
          headerRight: () => (
            <Pressable
              onPress={handleShare}
              style={{
                width: 36,
                height: 36,
                justifyContent: "center",
                alignItems: "center",
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="share-outline" size={22} color={Colors.primary} />
            </Pressable>
          ),
        }}
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

        {/* Header Image — only when a real image exists */}
        {item.image_url ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            <Image
              source={{ uri: item.image_url }}
              style={{
                width: "100%",
                height: 200,
                borderRadius: 16,
                backgroundColor: colors.surfaceVariant,
              }}
              resizeMode="cover"
            />
          </View>
        ) : null}

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
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                WHEN
              </Text>
              <Text style={{ fontSize: 16, color: colors.text }}>
                {formatDateTime()}
              </Text>
            </View>

            {(item.location_name || item.town) && (
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

            {item.kind === "event" && (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                  GOING
                </Text>
                <Text style={{ fontSize: 16, color: colors.text }}>
                  {rsvpLoading ? "..." : `${goingCount} ${goingCount === 1 ? "person" : "people"}`}
                </Text>
                {friendsGoingCount > 0 && (
                  <Pressable onPress={() => setShowFriendsGoing(true)}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.primary, marginTop: 4 }}>
                      {friendsGoingCount} {friendsGoingCount === 1 ? "friend" : "friends"} going →
                    </Text>
                  </Pressable>
                )}
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
                  <Pressable onPress={() => Linking.openURL(`tel:${placeDetails.phone_number}`)}>
                    <Text style={{ fontSize: 16, color: Colors.primary }}>
                      {placeDetails.phone_number}
                    </Text>
                  </Pressable>
                </View>
              )}

              {placeDetails.website_uri && (
                <View style={{ gap: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textTertiary }}>
                    WEBSITE
                  </Text>
                  <Pressable onPress={() => Linking.openURL(placeDetails.website_uri!)}>
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

              {placeDetails.google_maps_uri && (
                <Pressable onPress={() => Linking.openURL(placeDetails.google_maps_uri!)}>
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
              {/* RSVP button — events only */}
              {item.kind === "event" && (
                <Pressable
                  onPress={toggleRSVP}
                  disabled={rsvpLoading}
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
                      {isGoing ? "✓ I'm Going" : "I'm Going"}
                    </Text>
                  )}
                </Pressable>
              )}

              <Pressable
                onPress={handleCheckIn}
                disabled={checkingIn}
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

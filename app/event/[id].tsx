import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { useEventRSVP } from "../../src/hooks/useEventRSVP";
import { verifyCheckInLocation } from "../../src/utils/location";
import type { Event } from "../../src/types/database";

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  const {
    isGoing,
    goingCount,
    loading: rsvpLoading,
    toggleRSVP,
  } = useEventRSVP(id || "");

  async function handleCheckIn() {
    if (!event) return;

    if (!event.latitude || !event.longitude) {
      Alert.alert(
        "Location Not Available",
        "This event doesn't have a location set yet. Check-in requires a valid event location.",
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
        event.latitude,
        event.longitude,
      );

      if (!allowed) {
        Alert.alert("Cannot Check In", error || "You must be at the event location");
        return;
      }

      // Navigate to camera mode selector
      router.push(`/checkin/${event.id}` as any);
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

    async function loadEvent() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        setError(error.message);
        setEvent(null);
      } else {
        setEvent(data);
      }

      setLoading(false);
    }

    loadEvent();
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title: "Event" }} />
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator />
        </View>
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title: "Event" }} />
        <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
          <Text style={{ textAlign: "center", opacity: 0.7 }}>
            {error || "Event not found"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: event.title,
          headerShown: true,
        }}
      />
      <ScrollView style={{ flex: 1 }}>
        <View style={{ padding: 24, gap: 24 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 28, fontWeight: "700" }}>
              {event.title}
            </Text>
            {event.category && (
              <Text style={{ fontSize: 16, fontWeight: "600", opacity: 0.7 }}>
                #{event.category}
              </Text>
            )}
          </View>

          <View
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: "#f5f5f5",
              gap: 12,
            }}
          >
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", opacity: 0.6 }}>
                WHEN
              </Text>
              <Text style={{ fontSize: 16 }}>
                {new Date(event.starts_at).toLocaleString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </View>

            {(event.venue_name || event.city) && (
              <View style={{ gap: 4 }}>
                <Text
                  style={{ fontSize: 12, fontWeight: "600", opacity: 0.6 }}
                >
                  WHERE
                </Text>
                <Text style={{ fontSize: 16 }}>
                  {[event.venue_name, event.city].filter(Boolean).join(", ")}
                </Text>
              </View>
            )}

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", opacity: 0.6 }}>
                GOING
              </Text>
              <Text style={{ fontSize: 16 }}>
                {rsvpLoading ? "..." : `${goingCount} ${goingCount === 1 ? "person" : "people"}`}
              </Text>
            </View>
          </View>

          <View style={{ gap: 12 }}>
            <Pressable
              onPress={toggleRSVP}
              disabled={rsvpLoading}
              style={{
                padding: 16,
                borderRadius: 12,
                backgroundColor: isGoing ? "#fff" : "#000",
                borderWidth: isGoing ? 2 : 0,
                borderColor: "#000",
                alignItems: "center",
              }}
            >
              {rsvpLoading ? (
                <ActivityIndicator color={isGoing ? "#000" : "#fff"} />
              ) : (
                <Text
                  style={{
                    color: isGoing ? "#000" : "#fff",
                    fontSize: 16,
                    fontWeight: "600",
                  }}
                >
                  {isGoing ? "✓ I'm Going" : "I'm Going"}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={handleCheckIn}
              disabled={checkingIn}
              style={{
                padding: 16,
                borderRadius: 12,
                backgroundColor: "#000",
                alignItems: "center",
              }}
            >
              {checkingIn ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 16,
                    fontWeight: "600",
                  }}
                >
                  Check In & Post
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

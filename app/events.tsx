import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { supabase } from "../src/lib/supabase";
import { useAuth } from "../src/hooks/useAuth";
import { useFriendsList } from "../src/hooks/useFriendsList";
import { Colors } from "../src/config/theme";
import { useTheme } from "../src/contexts/ThemeContext";
import { FriendsGoingSheet } from "../src/components/FriendsGoingSheet";

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  venue_name: string | null;
  city: string | null;
  category: string | null;
  attendee_count: number;
  friends_going_count: number;
};

export default function Events() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { friends } = useFriendsList();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError(null);

      // Fetch events
      const { data: eventsData, error: eventsError } = await supabase
        .from("events")
        .select("id,title,starts_at,venue_name,city,category")
        .order("starts_at", { ascending: true });

      if (!alive) return;

      if (eventsError) {
        setError(eventsError.message);
        setEvents([]);
        setLoading(false);
        return;
      }

      if (!eventsData || eventsData.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      // Get event IDs
      const eventIds = eventsData.map((e: any) => e.id);

      // Fetch all RSVPs for these events
      const { data: rsvpsData } = await supabase
        .from("event_rsvps")
        .select("event_id, user_id")
        .in("event_id", eventIds);

      // Count attendees and friends going for each event
      const friendIds = friends.map((f) => f.id);
      const eventsWithCounts = eventsData.map((event: any) => {
        const eventRsvps = (rsvpsData || []).filter((r: any) => r.event_id === event.id);
        const attendeeCount = eventRsvps.length;
        const friendsGoingCount = eventRsvps.filter((r: any) => friendIds.includes(r.user_id)).length;

        return {
          ...event,
          attendee_count: attendeeCount,
          friends_going_count: friendsGoingCount,
        };
      });

      setEvents(eventsWithCounts);
      setLoading(false);
    }

    if (user) {
      load();
    }
    return () => {
      alive = false;
    };
  }, [user, friends]);

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: colors.background }}>
      <Text style={{ fontSize: 24, fontWeight: "700", marginBottom: 12, color: colors.text }}>
        Today / Tonight
      </Text>

      {loading && (
        <View style={{ marginTop: 24 }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      )}

      {!loading && error && (
        <Text style={{ marginTop: 12, color: colors.text }}>Error: {error}</Text>
      )}

      {!loading && !error && (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <View
              style={{
                padding: 14,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.cardBg,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
                {item.title}
              </Text>
              <Text style={{ marginTop: 4, color: colors.textSecondary }}>
                {new Date(item.starts_at).toLocaleDateString()} at{" "}
                {new Date(item.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
              <Text style={{ marginTop: 4, color: colors.textSecondary }}>
                {[item.venue_name, item.city].filter(Boolean).join(" • ")}
              </Text>
              {item.category ? (
                <Text style={{ marginTop: 6, fontWeight: "600", color: colors.text }}>
                  #{item.category}
                </Text>
              ) : null}

              {/* Attendee counts */}
              <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
                <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                  👥 {item.attendee_count} going
                </Text>
                {item.friends_going_count > 0 && (
                  <Pressable onPress={() => setSelectedEvent({ id: item.id, title: item.title })}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: Colors.primary }}>
                      {item.friends_going_count} {item.friends_going_count === 1 ? "friend" : "friends"} going
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />
      )}

      {/* Friends Going Modal */}
      <FriendsGoingSheet
        visible={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        eventId={selectedEvent?.id || null}
        eventTitle={selectedEvent?.title || ""}
      />
    </View>
  );
}

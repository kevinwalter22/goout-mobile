import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  venue_name: string | null;
  city: string | null;
  category: string | null;
};

type EventWithRSVP = EventRow & {
  rsvp_count: number;
  user_is_going: boolean;
};

export default function Explore() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventWithRSVP[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      // For each event, get RSVP count and user status
      const eventsWithRSVP = await Promise.all(
        (eventsData ?? []).map(async (event: EventRow) => {
          // Get total RSVP count
          const { count } = await supabase
            .from("event_rsvps")
            .select("*", { count: "exact", head: true })
            .eq("event_id", event.id);

          // Check if current user has RSVPed
          let userIsGoing = false;
          if (user) {
            const { data: userRSVP } = await supabase
              .from("event_rsvps")
              .select("id")
              .eq("event_id", event.id)
              .eq("user_id", user.id)
              .maybeSingle();

            userIsGoing = !!userRSVP;
          }

          return {
            ...event,
            rsvp_count: count ?? 0,
            user_is_going: userIsGoing,
          };
        }),
      );

      if (!alive) return;

      setEvents(eventsWithRSVP);
      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, [user]);

  return (
    <View style={{ flex: 1, padding: 16, paddingTop: 60 }}>
      <Text
        style={{
          fontSize: 24,
          fontWeight: "700",
          marginBottom: 16,
        }}
      >
        Explore
      </Text>

      {loading && (
        <View style={{ marginTop: 24 }}>
          <ActivityIndicator />
        </View>
      )}

      {!loading && error && (
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Error: {error}</Text>
      )}

      {!loading && !error && events.length === 0 && (
        <Text style={{ marginTop: 12, opacity: 0.7 }}>No events found</Text>
      )}

      {!loading && !error && events.length > 0 && (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/event/${item.id}` as any)}
              style={{ padding: 14, borderRadius: 12, borderWidth: 1 }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700" }}>
                    {item.title}
                  </Text>
                  <Text style={{ marginTop: 4, opacity: 0.8 }}>
                    {new Date(item.starts_at).toLocaleString()}
                  </Text>
                  <Text style={{ marginTop: 4, opacity: 0.8 }}>
                    {[item.venue_name, item.city].filter(Boolean).join(" • ")}
                  </Text>
                  {item.category ? (
                    <Text style={{ marginTop: 6, fontWeight: "600" }}>
                      #{item.category}
                    </Text>
                  ) : null}
                </View>
              </View>

              {(item.rsvp_count > 0 || item.user_is_going) && (
                <View
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: "#e0e0e0",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  {item.user_is_going && (
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 6,
                        backgroundColor: "#000",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color: "#fff",
                        }}
                      >
                        ✓ I&apos;m Going
                      </Text>
                    </View>
                  )}
                  {item.rsvp_count > 0 && (
                    <Text style={{ fontSize: 14, opacity: 0.7 }}>
                      {item.rsvp_count} {item.rsvp_count === 1 ? "person" : "people"} going
                    </Text>
                  )}
                </View>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

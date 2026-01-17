import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { supabase } from "../src/lib/supabase";

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  venue_name: string | null;
  city: string | null;
  category: string | null;
};

export default function Events() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("events")
        .select("id,title,starts_at,venue_name,city,category")
        .order("starts_at", { ascending: true });

      if (!alive) return;

      if (error) {
        setError(error.message);
        setEvents([]);
      } else {
        setEvents(data ?? []);
      }

      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: "700", marginBottom: 12 }}>
        Today / Tonight
      </Text>

      {loading && (
        <View style={{ marginTop: 24 }}>
          <ActivityIndicator />
        </View>
      )}

      {!loading && error && (
        <Text style={{ marginTop: 12 }}>Error: {error}</Text>
      )}

      {!loading && !error && (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <View style={{ padding: 14, borderRadius: 12, borderWidth: 1 }}>
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
          )}
        />
      )}
    </View>
  );
}

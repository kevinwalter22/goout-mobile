import { useEffect, useState, useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import { supabase } from "../../src/lib/supabase";

type AuthEventRow = {
  id: string;
  event_type: string;
  email: string | null;
  user_id: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata: any;
  created_at: string;
};

const EVENT_COLORS: Record<string, string> = {
  signup_attempt: Colors.gray[500],
  signup_succeeded: "#10B981",
  signup_failed: Colors.error,
  signin_attempt: Colors.gray[500],
  signin_succeeded: "#10B981",
  signin_failed: Colors.error,
  confirmation_arrived: Colors.primary,
  confirmation_failed: Colors.error,
};

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failures only" },
  { value: "signup", label: "Signup" },
  { value: "signin", label: "Signin" },
  { value: "confirmation", label: "Confirmation" },
];

function EventChip({ eventType }: { eventType: string }) {
  const color = EVENT_COLORS[eventType] ?? Colors.gray[500];
  return (
    <View
      style={{
        backgroundColor: color + "20",
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "700", color, letterSpacing: 0.3 }}>
        {eventType}
      </Text>
    </View>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminAuthLog() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<AuthEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    (supabase.from as any)("auth_event_log")
      .select("id, event_type, email, user_id, error_code, error_message, metadata, created_at")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }: { data: any; error: any }) => {
        if (error || !data) {
          console.error("[AdminAuthLog] fetch error:", error?.message);
          setLoading(false);
          return;
        }
        setRows(data as AuthEventRow[]);
        setLoading(false);
      });
  }, []);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "failed") return rows.filter((r) => r.event_type.endsWith("_failed"));
    if (filter === "signup") return rows.filter((r) => r.event_type.startsWith("signup_"));
    if (filter === "signin") return rows.filter((r) => r.event_type.startsWith("signin_"));
    if (filter === "confirmation") return rows.filter((r) => r.event_type.startsWith("confirmation_"));
    return rows;
  }, [rows, filter]);

  // Summary stats over the last 7 days
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.event_type] = (counts[r.event_type] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Auth Event Log" />

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <>
          {/* Summary stats */}
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textTertiary, width: "100%", marginBottom: 4 }}>
              LAST 7 DAYS
            </Text>
            {Object.entries(stats).map(([type, count]) => {
              const color = EVENT_COLORS[type] ?? Colors.gray[500];
              return (
                <View
                  key={type}
                  style={{
                    backgroundColor: color + "15",
                    borderRadius: 6,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ fontSize: 11, color, fontWeight: "600" }}>
                    {type}: {count}
                  </Text>
                </View>
              );
            })}
            {Object.keys(stats).length === 0 && (
              <Text style={{ fontSize: 13, color: colors.textTertiary }}>
                No events logged yet.
              </Text>
            )}
          </View>

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ padding: 16, gap: 8 }}
          >
            {FILTER_OPTIONS.map((opt) => {
              const selected = filter === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setFilter(opt.value)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: 16,
                    backgroundColor: selected ? Colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: selected ? Colors.primary : colors.border,
                  }}
                >
                  <Text style={{ color: selected ? "#fff" : colors.text, fontSize: 13, fontWeight: "600" }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {filteredRows.length === 0 ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
              <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
                No events match this filter.
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
              {filteredRows.map((row) => (
                <View
                  key={row.id}
                  style={{
                    borderRadius: 10,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 12,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <EventChip eventType={row.event_type} />
                    <Text style={{ fontSize: 11, color: colors.textTertiary }}>
                      {formatTimestamp(row.created_at)}
                    </Text>
                  </View>

                  {row.email && (
                    <Text style={{ fontSize: 13, color: colors.text }} selectable>
                      {row.email}
                    </Text>
                  )}

                  {row.error_code && (
                    <Text style={{ fontSize: 12, color: Colors.error, fontWeight: "600" }}>
                      {row.error_code}
                      {row.error_message ? `: ${row.error_message}` : ""}
                    </Text>
                  )}

                  {row.metadata && Object.keys(row.metadata).length > 0 && (
                    <Text style={{ fontSize: 11, color: colors.textTertiary, fontFamily: "monospace" }} selectable>
                      {JSON.stringify(row.metadata)}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import { supabase } from "../../src/lib/supabase";

type FeedbackRow = {
  id: string;
  type: "bug" | "idea" | "general";
  message: string;
  created_at: string;
  profiles: { username: string } | null;
};

const TYPE_COLORS: Record<string, string> = {
  bug: Colors.error,
  idea: Colors.primary,
  general: Colors.gray[500],
};

function TypeChip({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? Colors.gray[500];
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
      <Text style={{ fontSize: 12, fontWeight: "600", color, textTransform: "capitalize" }}>
        {type}
      </Text>
    </View>
  );
}

export default function AdminFeedback() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("feedback" as any)
      .select("id, type, message, created_at, profiles(username)")
      .order("created_at", { ascending: false })
      .then(({ data }: { data: any }) => {
        setRows((data as FeedbackRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Feedback Inbox" />

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
          <Text style={{ fontSize: 16, color: colors.textSecondary, textAlign: "center" }}>
            No feedback yet
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {rows.map((row) => (
            <View
              key={row.id}
              style={{
                borderRadius: 12,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 16,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <TypeChip type={row.type} />
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  {new Date(row.created_at).toLocaleDateString()}
                </Text>
              </View>

              <Text style={{ fontSize: 15, color: colors.text, lineHeight: 22 }}>
                {row.message}
              </Text>

              {row.profiles?.username && (
                <Text style={{ fontSize: 13, color: colors.textTertiary }}>
                  @{row.profiles.username}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

import { useCallback } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNotifications, type NotificationRow } from "../src/hooks/useNotifications";
import { routeForNotification } from "../src/lib/notifications";
import { Avatar } from "../src/components/Avatar";
import { Colors } from "../src/config/theme";
import { useTheme } from "../src/contexts/ThemeContext";

function relativeTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString();
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { items, loading, unreadCount, refresh, markRead, markAllRead } = useNotifications();

  // Refresh whenever the screen regains focus (e.g., returning from a tapped notification).
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const onTapRow = (n: NotificationRow) => {
    if (!n.read_at) markRead([n.id]);
    routeForNotification(n.type, n.reference_id ?? undefined);
  };

  const renderRow = ({ item }: { item: NotificationRow }) => {
    const unread = !item.read_at;
    return (
      <Pressable
        onPress={() => onTapRow(item)}
        accessibilityRole="button"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: unread ? colors.surface : colors.background,
        }}
      >
        <Avatar avatarUrl={item.actor_avatar_url ?? null} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: unread ? "700" : "600", fontSize: 15 }} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 1 }} numberOfLines={2}>
            {item.body}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{relativeTime(item.created_at)}</Text>
          {unread && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.primary }} />}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingTop: insets.top + 8,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back" accessibilityRole="button" style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>Notifications</Text>
        <Pressable
          onPress={markAllRead}
          disabled={unreadCount === 0}
          hitSlop={8}
          accessibilityLabel="Mark all read"
          accessibilityRole="button"
          style={{ padding: 4 }}
        >
          <Text style={{ fontSize: 14, fontWeight: "600", color: unreadCount === 0 ? colors.textTertiary : Colors.primary }}>
            Mark all read
          </Text>
        </Pressable>
      </View>

      {loading && items.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 }}>
          <Ionicons name="notifications-outline" size={40} color={colors.textTertiary} />
          <Text style={{ color: colors.textSecondary, textAlign: "center" }}>No notifications yet</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.separator, marginLeft: 72 }} />}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
        />
      )}
    </View>
  );
}

import { Alert, FlatList, Pressable, Text, View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/contexts/ThemeContext";
import { useBlockUser } from "../../src/hooks/useBlockUser";
import { Avatar } from "../../src/components/Avatar";

export default function BlockedUsers() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { blockedUsers, loading, unblockUser } = useBlockUser();

  function handleUnblock(userId: string, username: string) {
    Alert.alert(
      "Unblock User",
      `Are you sure you want to unblock ${username}? They will be able to see your content again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: async () => {
            const ok = await unblockUser(userId);
            if (!ok) {
              Alert.alert("Error", "Failed to unblock user. Please try again.");
            }
          },
        },
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 16,
          paddingTop: insets.top + 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          Blocked Users
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator />
        </View>
      ) : blockedUsers.length === 0 ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
            gap: 16,
          }}
        >
          <Ionicons name="shield-outline" size={64} color={colors.textTertiary} />
          <Text
            style={{
              fontSize: 18,
              fontWeight: "600",
              color: colors.text,
              textAlign: "center",
            }}
          >
            No Blocked Users
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: colors.textSecondary,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            When you block someone, their posts and comments will be hidden from your feed.
          </Text>
        </View>
      ) : (
        <FlatList
          data={blockedUsers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderLight,
              }}
            >
              <Avatar avatarUrl={item.profile?.avatar_url || null} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
                  {item.profile?.username || "Unknown user"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  Blocked {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  handleUnblock(
                    item.blocked_id,
                    item.profile?.username || "this user"
                  )
                }
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>
                  Unblock
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

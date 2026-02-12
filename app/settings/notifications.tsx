import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";

// TODO: Connect these settings to backend/push notification service when ready
// Currently using local state as placeholders

export default function NotificationSettings() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // Placeholder states - TODO: Connect to backend
  const [pushEnabled, setPushEnabled] = useState(true);
  const [friendRequests, setFriendRequests] = useState(true);
  const [comments, setComments] = useState(true);
  const [reactions, setReactions] = useState(true);
  const [eventReminders, setEventReminders] = useState(true);
  const [friendActivity, setFriendActivity] = useState(false);

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
          Notifications
        </Text>
      </View>

      <View style={{ padding: 16, gap: 24 }}>
        {/* Push Notifications Master Toggle */}
        <View style={{ gap: 12 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Push Notifications
          </Text>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 16,
              gap: 12,
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, color: colors.text }}>Push Notifications</Text>
              <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                Enable or disable all push notifications
              </Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={setPushEnabled}
              trackColor={{ false: colors.border, true: Colors.primary }}
            />
          </View>
        </View>

        {/* Social Notifications */}
        <View style={{ gap: 12, opacity: pushEnabled ? 1 : 0.5 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Social
          </Text>

          <View
            style={{
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="person-add-outline" size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Friend Requests</Text>
              <Switch
                value={friendRequests}
                onValueChange={setFriendRequests}
                disabled={!pushEnabled}
                trackColor={{ false: colors.border, true: Colors.primary }}
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Comments</Text>
              <Switch
                value={comments}
                onValueChange={setComments}
                disabled={!pushEnabled}
                trackColor={{ false: colors.border, true: Colors.primary }}
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="heart-outline" size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Reactions</Text>
              <Switch
                value={reactions}
                onValueChange={setReactions}
                disabled={!pushEnabled}
                trackColor={{ false: colors.border, true: Colors.primary }}
              />
            </View>
          </View>
        </View>

        {/* Events */}
        <View style={{ gap: 12, opacity: pushEnabled ? 1 : 0.5 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Events
          </Text>

          <View
            style={{
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>Event Reminders</Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  Get notified before events you're attending
                </Text>
              </View>
              <Switch
                value={eventReminders}
                onValueChange={setEventReminders}
                disabled={!pushEnabled}
                trackColor={{ false: colors.border, true: Colors.primary }}
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>Friend Activity</Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  When friends check in or post
                </Text>
              </View>
              <Switch
                value={friendActivity}
                onValueChange={setFriendActivity}
                disabled={!pushEnabled}
                trackColor={{ false: colors.border, true: Colors.primary }}
              />
            </View>
          </View>
        </View>

        {/* Info */}
        <Text style={{ fontSize: 12, color: colors.textTertiary, textAlign: "center" }}>
          You can also manage notifications in your device settings.
        </Text>
      </View>
    </View>
  );
}

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/hooks/useAuth";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { supabase } from "../../src/lib/supabase";

export default function NotificationSettings() {
  const { colors } = useTheme();
  const { profile, refreshProfile } = useAuth();

  const [eventReminders, setEventReminders] = useState(true);
  const [friendRequests, setFriendRequests] = useState(true);
  const [saving, setSaving] = useState(false);
  const [osPermission, setOsPermission] = useState<string | null>(null);

  // Sync local state from profile
  useEffect(() => {
    if (profile) {
      setEventReminders(profile.notify_event_reminders);
      setFriendRequests(profile.notify_friend_requests);
    }
  }, [profile]);

  // Check OS-level notification permission
  useEffect(() => {
    if (Platform.OS === "web") return;
    try {
      const Notifications = require("expo-notifications");
      Notifications.getPermissionsAsync().then(({ status }: { status: string }) => {
        setOsPermission(status);
      });
    } catch {
      // Native module not available (Expo Go)
      setOsPermission("granted"); // Hide warning banner in Expo Go
    }
  }, []);

  async function updatePreference(
    key: "event_reminders" | "friend_requests",
    value: boolean
  ) {
    if (!profile) return;

    const newEventReminders =
      key === "event_reminders" ? value : eventReminders;
    const newFriendRequests =
      key === "friend_requests" ? value : friendRequests;

    // Optimistic update
    if (key === "event_reminders") setEventReminders(value);
    else setFriendRequests(value);

    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_notification_preferences", {
        p_user_id: profile.id,
        p_event_reminders: newEventReminders,
        p_friend_requests: newFriendRequests,
      });

      if (error) throw error;
      await refreshProfile();
    } catch {
      // Revert on failure
      if (key === "event_reminders") setEventReminders(!value);
      else setFriendRequests(!value);
    } finally {
      setSaving(false);
    }
  }

  function openAppSettings() {
    if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    } else {
      Linking.openSettings();
    }
  }

  const permissionDenied =
    osPermission !== null && osPermission !== "granted";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Notifications"
        right={saving ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
      />

      <View style={{ padding: 16, gap: 24 }}>
        {/* OS Permission Warning */}
        {permissionDenied && (
          <Pressable
            onPress={openAppSettings}
            accessibilityLabel="Notifications are disabled — tap to open device settings"
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 12,
              gap: 10,
              borderRadius: 12,
              backgroundColor: "#FEF3C7",
              borderWidth: 1,
              borderColor: "#F59E0B",
            }}
          >
            <Ionicons name="warning-outline" size={20} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#92400E" }}>
                Notifications are disabled
              </Text>
              <Text style={{ fontSize: 12, color: "#92400E" }}>
                Tap to open device settings and enable notifications.
              </Text>
            </View>
            <Ionicons name="open-outline" size={16} color="#92400E" />
          </Pressable>
        )}

        {/* Push Notification Preferences */}
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
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            {/* Event Reminders Toggle */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons
                name="calendar-outline"
                size={20}
                color={colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>
                  Event Reminders
                </Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  1 hour before events you&apos;re going to
                </Text>
              </View>
              <Switch
                value={eventReminders}
                onValueChange={(v) => updatePreference("event_reminders", v)}
                trackColor={{ false: colors.border, true: Colors.primary }}
                disabled={saving}
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            {/* Friend Requests Toggle */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons
                name="people-outline"
                size={20}
                color={colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>
                  Friend Requests
                </Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  New requests and accepted requests
                </Text>
              </View>
              <Switch
                value={friendRequests}
                onValueChange={(v) => updatePreference("friend_requests", v)}
                trackColor={{ false: colors.border, true: Colors.primary }}
                disabled={saving}
              />
            </View>
          </View>
        </View>

        {/* Device Settings */}
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
            Device Settings
          </Text>

          <Pressable
            onPress={openAppSettings}
            accessibilityLabel="Open device settings for notifications"
            accessibilityRole="button"
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
            <Ionicons
              name="phone-portrait-outline"
              size={20}
              color={colors.textSecondary}
            />
            <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>
              Open Device Settings
            </Text>
            <Ionicons
              name="open-outline"
              size={18}
              color={colors.textTertiary}
            />
          </Pressable>
        </View>

        {/* Footer note */}
        <Text
          style={{
            fontSize: 12,
            color: colors.textTertiary,
            textAlign: "center",
            lineHeight: 18,
          }}
        >
          Push notifications must be enabled in your device settings for these
          preferences to take effect.
        </Text>
      </View>
    </View>
  );
}

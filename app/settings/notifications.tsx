import { Linking, Platform, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";

export default function NotificationSettings() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  function openAppSettings() {
    if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    } else {
      Linking.openSettings();
    }
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
          Notifications
        </Text>
      </View>

      <View style={{ padding: 16, gap: 24 }}>
        <View style={{ alignItems: "center", paddingVertical: 32, gap: 12 }}>
          <Ionicons name="notifications-outline" size={48} color={colors.textTertiary} />
          <Text
            style={{
              fontSize: 16,
              color: colors.textSecondary,
              textAlign: "center",
              lineHeight: 22,
            }}
          >
            Notification preferences are managed through your device settings.
          </Text>
        </View>

        <Pressable
          onPress={openAppSettings}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            gap: 8,
            borderRadius: 12,
            backgroundColor: Colors.primary,
          }}
        >
          <Ionicons name="settings-outline" size={20} color="#fff" />
          <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>
            Open Device Settings
          </Text>
        </Pressable>

        <Text style={{ fontSize: 12, color: colors.textTertiary, textAlign: "center" }}>
          You can enable or disable push notifications for Euda in your device&apos;s notification settings.
        </Text>
      </View>
    </View>
  );
}

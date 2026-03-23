import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import * as Location from "expo-location";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";

export default function PrivacySettings() {
  const { colors } = useTheme();
  const [locationStatus, setLocationStatus] = useState<string | null>(null);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      setLocationStatus(status);
    });
  }, []);

  function openAppSettings() {
    if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    } else {
      Linking.openSettings();
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Privacy" />

      <View style={{ padding: 16, gap: 24 }}>
        {/* Permissions */}
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
            Permissions
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
            <Pressable
              onPress={openAppSettings}
              accessibilityLabel={`Location permission: ${locationStatus === "granted" ? "allowed" : "denied"} — tap to open settings`}
              accessibilityRole="button"
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>Location</Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  {locationStatus === "granted"
                    ? "Allowed — used for check-in verification"
                    : locationStatus === "denied"
                    ? "Denied — tap to open Settings"
                    : "Not requested yet"}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: locationStatus === "granted" ? Colors.primary : Colors.error,
                }}
              >
                {locationStatus === "granted" ? "On" : "Off"}
              </Text>
            </Pressable>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            <Pressable
              onPress={() => router.push("/settings/find-contacts" as any)}
              accessibilityLabel="Contacts — find friends from contacts"
              accessibilityRole="button"
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>Contacts</Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  Used to find friends — hashes only, never stored
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </Pressable>
          </View>
        </View>

        {/* Blocked Users */}
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
            Blocking
          </Text>

          <Pressable
            onPress={() => router.push("/settings/blocked-users" as any)}
            accessibilityLabel="Blocked Users"
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
            <Ionicons name="shield-outline" size={20} color={colors.textSecondary} />
            <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Blocked Users</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </Pressable>
        </View>

        {/* Privacy Policy link */}
        <Pressable
          onPress={() => Linking.openURL("https://links.euda.live/privacy")}
          accessibilityLabel="View Privacy Policy"
          accessibilityRole="link"
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
            gap: 6,
          }}
        >
          <Ionicons name="lock-closed-outline" size={16} color={Colors.primary} />
          <Text style={{ fontSize: 14, color: Colors.primary }}>View Privacy Policy</Text>
        </Pressable>
      </View>
    </View>
  );
}

import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";

// TODO: Connect these settings to backend when ready
// Currently using local state as placeholders

export default function PrivacySettings() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [locationStatus, setLocationStatus] = useState<string | null>(null);

  // Placeholder states - TODO: Connect to backend
  const [profileVisibility, setProfileVisibility] = useState<"public" | "friends">("friends");
  const [showActivityStatus, setShowActivityStatus] = useState(true);
  const [allowTagging, setAllowTagging] = useState(true);

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
          Privacy
        </Text>
      </View>

      <View style={{ padding: 16, gap: 24 }}>
        {/* Profile Visibility */}
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
            Profile Visibility
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
              onPress={() => setProfileVisibility("public")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons
                name="earth-outline"
                size={20}
                color={profileVisibility === "public" ? Colors.primary : colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>Public</Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  Anyone can see your profile
                </Text>
              </View>
              {profileVisibility === "public" && (
                <Ionicons name="checkmark" size={20} color={Colors.primary} />
              )}
            </Pressable>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            <Pressable
              onPress={() => setProfileVisibility("friends")}
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
                color={profileVisibility === "friends" ? Colors.primary : colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>Friends Only</Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  Only your friends can see your profile
                </Text>
              </View>
              {profileVisibility === "friends" && (
                <Ionicons name="checkmark" size={20} color={Colors.primary} />
              )}
            </Pressable>
          </View>
        </View>

        {/* Activity */}
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
            Activity
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
              <Ionicons name="radio-outline" size={20} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>Show Activity Status</Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  Let friends see when you're active
                </Text>
              </View>
              <Switch
                value={showActivityStatus}
                onValueChange={setShowActivityStatus}
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
              <Ionicons name="at-outline" size={20} color={colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text }}>Allow Tagging</Text>
                <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                  Let others tag you in posts
                </Text>
              </View>
              <Switch
                value={allowTagging}
                onValueChange={setAllowTagging}
                trackColor={{ false: colors.border, true: Colors.primary }}
              />
            </View>
          </View>
        </View>

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
      </View>
    </View>
  );
}

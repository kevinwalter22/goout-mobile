import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useAuth } from "../../src/hooks/useAuth";
import { useAdmin } from "../../src/hooks/useAdmin";
import { useFeatureFlags } from "../../src/hooks/useFeatureFlags";
import { supabase } from "../../src/lib/supabase";
import { useTheme, type ThemeMode } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { Env } from "../../src/config/env";
import { sendTestException } from "../../src/lib/sentry";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
  { value: "system", label: "System", icon: "phone-portrait-outline" },
];

type SettingsItemProps = {
  icon: string;
  label: string;
  onPress: () => void;
  showChevron?: boolean;
  rightText?: string;
  danger?: boolean;
};

function SettingsItem({ icon, label, onPress, showChevron = true, rightText, danger }: SettingsItemProps) {
  const { colors } = useTheme();
  const textColor = danger ? Colors.error : colors.text;

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        gap: 12,
      }}
    >
      <Ionicons
        name={icon as any}
        size={20}
        color={danger ? Colors.error : colors.textSecondary}
      />
      <Text style={{ flex: 1, fontSize: 16, color: textColor }}>{label}</Text>
      {rightText && (
        <Text style={{ fontSize: 14, color: colors.textTertiary }}>{rightText}</Text>
      )}
      {showChevron && (
        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
      )}
    </Pressable>
  );
}

function DevRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ fontSize: 13, color: colors.textSecondary }}>{label}</Text>
      <Text
        style={{ fontSize: 13, color: colors.textTertiary, flexShrink: 1, textAlign: "right" }}
        numberOfLines={1}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { colors, mode, setMode } = useTheme();
  const { signOut, profile } = useAuth();
  const { isAdmin } = useAdmin();
  const { flags, toggleFlag } = useFeatureFlags();
  const [deleting, setDeleting] = useState(false);

  const appVersion = Constants.expoConfig?.version || "1.0.0";
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || "1";

  async function handleLogout() {
    Alert.alert(
      "Log Out",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: async () => {
            await signOut();
            router.replace("/signin");
          },
        },
      ]
    );
  }

  function handleDeleteAccount() {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account, posts, and all associated data. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete My Account",
          style: "destructive",
          onPress: () => {
            // Second confirmation
            Alert.alert(
              "Are you absolutely sure?",
              "All your data will be permanently removed. You will not be able to recover your account.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Yes, Delete Everything",
                  style: "destructive",
                  onPress: executeDeleteAccount,
                },
              ],
            );
          },
        },
      ],
    );
  }

  async function executeDeleteAccount() {
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        method: "POST",
      });

      if (error) {
        Alert.alert("Error", "Failed to delete account. Please try again or contact support.");
        return;
      }

      if (data?.error) {
        Alert.alert("Error", data.error);
        return;
      }

      // Account deleted — sign out locally and go to signin
      await signOut();
      router.replace("/signin");
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
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
          Settings
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 24 }}>
        {/* Account Section */}
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
            Account
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
            <SettingsItem
              icon="person-outline"
              label="Edit Profile"
              onPress={() => router.push("/settings/edit-profile" as any)}
            />
            <View style={{ height: 1, backgroundColor: colors.separator, marginLeft: 48 }} />
            <SettingsItem
              icon="key-outline"
              label="Change Password"
              onPress={() => router.push("/settings/change-password" as any)}
            />
            <View style={{ height: 1, backgroundColor: colors.separator, marginLeft: 48 }} />
            <SettingsItem
              icon="call-outline"
              label="Phone Number"
              rightText={profile?.phone_number ? "Added" : ""}
              onPress={() => router.push("/settings/phone-number" as any)}
            />
            <View style={{ height: 1, backgroundColor: colors.separator, marginLeft: 48 }} />
            <SettingsItem
              icon="people-outline"
              label="Find Friends from Contacts"
              onPress={() => router.push("/settings/find-contacts" as any)}
            />
          </View>
        </View>

        {/* Appearance Section */}
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
            Appearance
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
            {THEME_OPTIONS.map((option, index) => (
              <Pressable
                key={option.value}
                onPress={() => setMode(option.value)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 16,
                  gap: 12,
                  borderTopWidth: index > 0 ? 1 : 0,
                  borderTopColor: colors.separator,
                }}
              >
                <Ionicons
                  name={option.icon as any}
                  size={20}
                  color={mode === option.value ? Colors.primary : colors.textSecondary}
                />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 16,
                    color: colors.text,
                    fontWeight: mode === option.value ? "600" : "400",
                  }}
                >
                  {option.label}
                </Text>
                {mode === option.value && (
                  <Ionicons name="checkmark" size={20} color={Colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Privacy Section */}
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
            Privacy
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
            <SettingsItem
              icon="shield-outline"
              label="Privacy Settings"
              onPress={() => router.push("/settings/privacy" as any)}
            />
          </View>
        </View>

        {/* Notifications Section */}
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
            Notifications
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
            <SettingsItem
              icon="notifications-outline"
              label="Notification Preferences"
              onPress={() => router.push("/settings/notifications" as any)}
            />
          </View>
        </View>

        {/* Admin Section (visible only to admins) */}
        {isAdmin && (
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
              Admin
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
              <SettingsItem
                icon="shield-checkmark-outline"
                label="Review Queue"
                onPress={() => router.push("/settings/admin-review" as any)}
              />
            </View>
          </View>
        )}

        {/* Kill Switches (visible only to admins) */}
        {isAdmin && (
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
              Kill Switches
            </Text>

            <View
              style={{
                borderRadius: 12,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 16,
                gap: 16,
              }}
            >
              {([
                { flag: "llm_reranker", label: "LLM Reranker" },
                { flag: "weather_boost", label: "Weather Boost" },
                { flag: "contacts_sync", label: "Contacts Sync" },
                { flag: "ingestion", label: "Ingestion Jobs" },
                { flag: "tag_affinity", label: "Tag Affinity" },
                { flag: "friends_rsvp_boost", label: "Friends RSVP Boost" },
                { flag: "type_affinity_learning", label: "Type Affinity" },
              ] as const).map(({ flag, label }) => (
                <View
                  key={flag}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontSize: 15, color: colors.text }}>{label}</Text>
                  <Switch
                    value={flags.get(flag) ?? false}
                    onValueChange={(val) => toggleFlag(flag, val)}
                    trackColor={{ false: colors.border, true: Colors.primary }}
                  />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Support Section */}
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
            Support
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
            <SettingsItem
              icon="help-circle-outline"
              label="About & Help"
              onPress={() => router.push("/settings/about" as any)}
            />
          </View>
        </View>

        {/* Logout Section */}
        <View style={{ gap: 12 }}>
          <View
            style={{
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            <SettingsItem
              icon="log-out-outline"
              label="Log Out"
              onPress={handleLogout}
              showChevron={false}
              danger
            />
          </View>
        </View>

        {/* Delete Account */}
        <View style={{ gap: 12 }}>
          <View
            style={{
              borderRadius: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            {deleting ? (
              <View style={{ padding: 16, alignItems: "center" }}>
                <ActivityIndicator color={Colors.error} />
              </View>
            ) : (
              <SettingsItem
                icon="trash-outline"
                label="Delete Account"
                onPress={handleDeleteAccount}
                showChevron={false}
                danger
              />
            )}
          </View>
        </View>

        {/* Dev Info (dev builds only) */}
        {__DEV__ && (
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
              Developer
            </Text>

            <View
              style={{
                borderRadius: 12,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 16,
                gap: 8,
              }}
            >
              <DevRow label="Environment" value={Env.APP_ENV} colors={colors} />
              <DevRow label="Supabase" value={Env.SUPABASE_URL.replace("https://", "")} colors={colors} />
              <DevRow label="User ID" value={profile?.id ?? "—"} colors={colors} />
              <DevRow label="Version" value={`v${appVersion} (${buildNumber})`} colors={colors} />
              <DevRow label="Sentry DSN" value={Env.SENTRY_DSN ? "configured" : "not set"} colors={colors} />
              <Pressable
                onPress={() => {
                  sendTestException();
                  Alert.alert(
                    "Test Error Sent",
                    Env.SENTRY_DSN
                      ? "Check your Sentry dashboard for the test exception."
                      : "No DSN configured — error was not sent. Set EXPO_PUBLIC_SENTRY_DSN to enable.",
                  );
                }}
                style={{
                  marginTop: 4,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 8,
                  backgroundColor: Colors.error + "18",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.error }}>
                  Send Sentry Test Error
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* User Info & Version */}
        <View style={{ gap: 4, alignItems: "center" }}>
          {profile && (
            <Text
              style={{
                fontSize: 12,
                color: colors.textTertiary,
              }}
            >
              Logged in as @{profile.username}
            </Text>
          )}
          <Text
            style={{
              fontSize: 12,
              color: colors.textTertiary,
            }}
          >
            Euda v{appVersion} ({buildNumber})
          </Text>
        </View>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

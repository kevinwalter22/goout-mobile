import { Alert, Image, Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import Constants from "expo-constants";
import { useTheme } from "../../src/contexts/ThemeContext";


const SUPPORT_EMAIL = "support@euda.live";
const TERMS_URL = "https://links.euda.live/terms";
const PRIVACY_URL = "https://links.euda.live/privacy";
const SUPPORT_URL = "https://links.euda.live/support";

export default function About() {
  const { colors } = useTheme();

  const appVersion = Constants.expoConfig?.version || "1.0.0";
  const buildNumber = Constants.expoConfig?.ios?.buildNumber || "1";

  function openLink(url: string) {
    Linking.openURL(url).catch(() => {
      Alert.alert("Error", "Could not open link");
    });
  }

  function sendEmail(subject: string) {
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    Linking.openURL(mailtoUrl).catch(() => {
      Alert.alert("Error", "Could not open email app");
    });
  }

  function handleReportBug() {
    Alert.alert(
      "Report a Bug",
      "How would you like to report the issue?",
      [
        {
          text: "Email",
          onPress: () => sendEmail(`Bug Report - Euda v${appVersion}`),
        },
        {
          text: "Support Page",
          onPress: () => openLink(SUPPORT_URL),
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="About & Support" />

      <View style={{ padding: 16, gap: 24 }}>
        {/* App Info */}
        <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={{
              width: 80,
              height: 80,
              borderRadius: 20,
            }}
          />
          <Text style={{ fontSize: 24, fontWeight: "700", color: colors.text }}>Euda</Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary }}>
            Version {appVersion} ({buildNumber})
          </Text>
        </View>

        {/* Support */}
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
            <Pressable
              onPress={handleReportBug}
              accessibilityLabel="Report a bug"
              accessibilityRole="button"
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="bug-outline" size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Report a Bug</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </Pressable>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            <Pressable
              onPress={() => sendEmail("Feedback - Euda App")}
              accessibilityLabel="Send feedback"
              accessibilityRole="button"
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="chatbox-outline" size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Send Feedback</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </Pressable>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            <Pressable
              onPress={() => sendEmail("Support Request - Euda")}
              accessibilityLabel="Contact support"
              accessibilityRole="button"
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Contact Us</Text>
              <Text style={{ fontSize: 14, color: colors.textTertiary }}>{SUPPORT_EMAIL}</Text>
            </Pressable>
          </View>
        </View>

        {/* Legal */}
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
            Legal
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
              onPress={() => openLink(TERMS_URL)}
              accessibilityLabel="Terms of Service"
              accessibilityRole="link"
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Terms of Service</Text>
              <Ionicons name="open-outline" size={18} color={colors.textTertiary} />
            </Pressable>

            <View style={{ height: 1, backgroundColor: colors.separator }} />

            <Pressable
              onPress={() => openLink(PRIVACY_URL)}
              accessibilityLabel="Privacy Policy"
              accessibilityRole="link"
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                gap: 12,
              }}
            >
              <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} />
              <Text style={{ flex: 1, fontSize: 16, color: colors.text }}>Privacy Policy</Text>
              <Ionicons name="open-outline" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        </View>

        {/* Footer */}
        <Text
          style={{
            fontSize: 12,
            color: colors.textTertiary,
            textAlign: "center",
            marginTop: 16,
          }}
        >
          Made with love in Potsdam, NY
        </Text>
      </View>
    </View>
  );
}

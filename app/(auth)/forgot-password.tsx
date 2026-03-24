import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Link, router } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { friendlyMessage } from "../../src/lib/errorMessages";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "../../src/config/theme";

export default function ForgotPassword() {
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSendReset() {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert("Error", "Please enter your email address");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: "https://links.euda.live/auth/callback",
    });
    setLoading(false);

    if (error) {
      Alert.alert("Error", friendlyMessage(error));
    } else {
      setSent(true);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: Spacing.xl,
          justifyContent: "center",
          gap: Spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", gap: Spacing.sm }}>
          <Image
            source={require("../../assets/images/euda.png")}
            style={{ width: 140, height: 140 }}
            contentFit="contain"
            priority="high"
            cachePolicy="memory-disk"
          />
          <Text style={{ fontSize: FontSize.md, color: colors.textSecondary }}>
            Reset your password
          </Text>
        </View>

        {sent ? (
          <View style={{ alignItems: "center", gap: Spacing.md, marginTop: Spacing.xl }}>
            <Text
              style={{
                fontSize: FontSize.lg ?? 20,
                fontWeight: FontWeight.semibold,
                color: colors.text,
                textAlign: "center",
              }}
            >
              Check your email
            </Text>
            <Text
              style={{
                fontSize: FontSize.md,
                color: colors.textSecondary,
                textAlign: "center",
                lineHeight: 22,
              }}
            >
              We sent a reset link to{"\n"}
              <Text style={{ fontWeight: FontWeight.semibold, color: colors.text }}>{email}</Text>
            </Text>
            <Text
              style={{
                fontSize: FontSize.sm,
                color: colors.textTertiary,
                textAlign: "center",
                marginTop: Spacing.sm,
              }}
            >
              Tap the link in the email to set a new password. It may take a minute to arrive.
            </Text>
          </View>
        ) : (
          <View style={{ gap: Spacing.md, marginTop: Spacing.xl }}>
            <View style={{ gap: Spacing.xs + 2 }}>
              <Text
                style={{
                  fontSize: FontSize.sm,
                  fontWeight: FontWeight.semibold,
                  color: colors.text,
                }}
              >
                Email
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                accessibilityLabel="Email address"
                style={{
                  padding: Spacing.md,
                  borderRadius: BorderRadius.sm,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.inputBg,
                  fontSize: FontSize.md,
                  color: colors.text,
                }}
              />
            </View>

            <Pressable
              onPress={handleSendReset}
              disabled={loading}
              accessibilityLabel="Send reset email"
              accessibilityRole="button"
              accessibilityState={{ disabled: loading }}
              style={({ pressed }) => ({
                marginTop: Spacing.sm,
                padding: Spacing.lg,
                borderRadius: BorderRadius.md,
                backgroundColor: pressed ? Colors.primaryDark : Colors.primary,
                alignItems: "center",
                opacity: loading ? 0.7 : 1,
              })}
            >
              {loading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text
                  style={{
                    color: Colors.white,
                    fontSize: FontSize.md,
                    fontWeight: FontWeight.semibold,
                  }}
                >
                  Send Reset Email
                </Text>
              )}
            </Pressable>
          </View>
        )}

        <View
          style={{
            marginTop: Spacing.lg,
            flexDirection: "row",
            justifyContent: "center",
            gap: Spacing.xs + 2,
          }}
        >
          <Text style={{ color: colors.textSecondary }}>Remember your password?</Text>
          <Link href="/(auth)/signin" asChild>
            <Pressable accessibilityLabel="Back to sign in" accessibilityRole="link">
              <Text style={{ fontWeight: FontWeight.semibold, color: Colors.primary }}>
                Sign In
              </Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

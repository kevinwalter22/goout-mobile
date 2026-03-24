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
import { useAuth } from "../../src/hooks/useAuth";
import { friendlyMessage } from "../../src/lib/errorMessages";
import { logSecurityEvent, SEC } from "../../src/lib/securityEvents";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "../../src/config/theme";

export default function SignIn() {
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!email || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      logSecurityEvent(SEC.AUTH_FAILED_LOGIN, "medium");
      Alert.alert("Error", friendlyMessage(error));
    } else {
      router.replace("/(tabs)/feed");
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
            Stop spectating. Start living.
          </Text>
        </View>

        <View style={{ gap: Spacing.md, marginTop: Spacing.xl }}>
          <View style={{ gap: Spacing.xs + 2 }}>
            <Text style={{ fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: colors.text }}>
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

          <View style={{ gap: Spacing.xs + 2 }}>
            <Text style={{ fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: colors.text }}>
              Password
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              accessibilityLabel="Password"
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
            onPress={handleSignIn}
            disabled={loading}
            accessibilityLabel="Sign in"
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
              <Text style={{ color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.semibold }}>
                Sign In
              </Text>
            )}
          </Pressable>

          <View style={{ alignItems: "center", marginTop: Spacing.sm }}>
            <Link href="/(auth)/forgot-password" asChild>
              <Pressable accessibilityLabel="Forgot password" accessibilityRole="link">
                <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
                  Forgot password?
                </Text>
              </Pressable>
            </Link>
          </View>

          <View
            style={{
              marginTop: Spacing.lg,
              flexDirection: "row",
              justifyContent: "center",
              gap: Spacing.xs + 2,
            }}
          >
            <Text style={{ color: colors.textSecondary }}>Don&apos;t have an account?</Text>
            <Link href="/(auth)/signup" asChild>
              <Pressable accessibilityLabel="Sign up" accessibilityRole="link">
                <Text style={{ fontWeight: FontWeight.semibold, color: Colors.primary }}>
                  Sign Up
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

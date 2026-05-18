import { useState, useEffect } from "react";
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
import { logAuthEvent } from "../../src/lib/authLog";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "../../src/config/theme";
import { supabase } from "../../src/lib/supabase";

export default function SignUp() {
  const { signUp } = useAuth();
  const { colors } = useTheme();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldownEnd, setCooldownEnd] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!cooldownEnd) return;
    const tick = () => {
      const remaining = Math.ceil((cooldownEnd.getTime() - Date.now()) / 1000);
      if (remaining <= 0) {
        setSecondsLeft(0);
        setCooldownEnd(null);
      } else {
        setSecondsLeft(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownEnd]);

  async function handleSignUp() {
    if (!username || !email || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    if (!ageConfirmed) {
      Alert.alert("Error", "You must confirm you are 13 or older to create an account");
      return;
    }

    if (username.length < 3 || username.length > 30) {
      Alert.alert("Error", "Username must be between 3 and 30 characters");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      Alert.alert(
        "Error",
        "Username can only contain letters, numbers, and underscores",
      );
      return;
    }

    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    logAuthEvent("signup_attempt", { email, metadata: { username_len: username.length } });

    // Check username availability before creating the auth user.
    // Without this, a taken username causes the DB trigger to fail with
    // the opaque "Database error saving new user" Supabase error.
    const { data: usernameAvailable, error: usernameCheckError } = await supabase.rpc(
      "check_username_available" as any,
      { p_username: username },
    );
    if (usernameCheckError || usernameAvailable === false) {
      setLoading(false);
      logAuthEvent("signup_failed", {
        email,
        errorCode: "username_taken",
        errorMessage: usernameCheckError?.message ?? "Username already taken",
      });
      Alert.alert("Error", "This username is already taken. Please choose a different one.");
      return;
    }

    const { error } = await signUp(email, password, username);
    setLoading(false);

    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      const errorCode = msg.includes("rate limit")
        ? "rate_limit"
        : msg.includes("already registered") || msg.includes("user already")
        ? "email_exists"
        : (error as any).code || "unknown";
      logAuthEvent("signup_failed", {
        email,
        errorCode,
        errorMessage: error.message,
      });

      if (msg.includes("rate limit")) {
        setCooldownEnd(new Date(Date.now() + 5 * 60 * 1000));
        Alert.alert(
          "High Demand",
          "We're receiving a lot of signups right now. Please wait a few minutes and try again.\n\nIf this keeps happening, contact support.",
        );
      } else {
        Alert.alert("Error", friendlyMessage(error));
      }
    } else {
      logAuthEvent("signup_succeeded", { email });
      Alert.alert(
        "Success",
        "Account created! Please check your email to verify your account.",
        [
          {
            text: "OK",
            onPress: () => router.replace("/(auth)/signin"),
          },
        ],
      );
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
              Username
            </Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="yourname"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoComplete="username"
              accessibilityLabel="Username"
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
              autoComplete="password-new"
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
            onPress={() => setAgeConfirmed((v) => !v)}
            accessibilityLabel="I confirm I am 13 years of age or older"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ageConfirmed }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.sm + 2,
              marginTop: Spacing.xs,
            }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                borderWidth: 2,
                borderColor: ageConfirmed ? Colors.primary : colors.textTertiary,
                backgroundColor: ageConfirmed ? Colors.primary : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {ageConfirmed && (
                <Text style={{ color: Colors.white, fontSize: FontSize.sm, fontWeight: FontWeight.bold, lineHeight: 16 }}>
                  ✓
                </Text>
              )}
            </View>
            <Text style={{ fontSize: FontSize.sm, color: colors.textSecondary, flex: 1 }}>
              I confirm I am 13 years of age or older
            </Text>
          </Pressable>

          <Pressable
            onPress={handleSignUp}
            disabled={loading || cooldownEnd !== null}
            accessibilityLabel="Create account"
            accessibilityRole="button"
            accessibilityState={{ disabled: loading || cooldownEnd !== null }}
            style={({ pressed }) => ({
              marginTop: Spacing.sm,
              padding: Spacing.lg,
              borderRadius: BorderRadius.md,
              backgroundColor: pressed ? Colors.primaryDark : Colors.primary,
              alignItems: "center",
              opacity: loading || cooldownEnd !== null ? 0.5 : 1,
            })}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : cooldownEnd !== null ? (
              <Text style={{ color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.semibold }}>
                Try again in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </Text>
            ) : (
              <Text style={{ color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.semibold }}>
                Sign Up
              </Text>
            )}
          </Pressable>

          <View
            style={{
              marginTop: Spacing.lg,
              flexDirection: "row",
              justifyContent: "center",
              gap: Spacing.xs + 2,
            }}
          >
            <Text style={{ color: colors.textSecondary }}>Already have an account?</Text>
            <Link href="/(auth)/signin" asChild>
              <Pressable accessibilityLabel="Sign in" accessibilityRole="link">
                <Text style={{ fontWeight: FontWeight.semibold, color: Colors.primary }}>
                  Sign In
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

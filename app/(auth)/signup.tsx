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
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "../../src/config/theme";

export default function SignUp() {
  const { signUp } = useAuth();
  const { colors } = useTheme();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

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
    const { error } = await signUp(email, password, username);
    setLoading(false);

    if (error) {
      Alert.alert("Error", friendlyMessage(error));
    } else {
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
            disabled={loading}
            accessibilityLabel="Create account"
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

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
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { friendlyMessage } from "../../src/lib/errorMessages";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from "../../src/config/theme";

export default function ResetPassword() {
  const { colors } = useTheme();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const isValid = newPassword.length >= 6 && newPassword === confirmPassword && !loading;

  async function handleUpdatePassword() {
    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "Passwords don't match");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      Alert.alert("Error", friendlyMessage(error));
    } else {
      Alert.alert("Password Updated", "Your password has been updated successfully.", [
        { text: "OK", onPress: () => router.replace("/(tabs)/feed") },
      ]);
    }
  }

  function PasswordInput({
    label,
    value,
    onChange,
    visible,
    onToggle,
    accessLabel,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    visible: boolean;
    onToggle: () => void;
    accessLabel: string;
  }) {
    return (
      <View style={{ gap: Spacing.xs + 2 }}>
        <Text
          style={{ fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: colors.text }}
        >
          {label}
        </Text>
        <View style={{ position: "relative" }}>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="••••••••"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoComplete="new-password"
            accessibilityLabel={accessLabel}
            style={{
              padding: Spacing.md,
              paddingRight: 48,
              borderRadius: BorderRadius.sm,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.inputBg,
              fontSize: FontSize.md,
              color: colors.text,
            }}
          />
          <Pressable
            onPress={onToggle}
            accessibilityLabel={visible ? "Hide password" : "Show password"}
            style={{
              position: "absolute",
              right: 12,
              top: 0,
              bottom: 0,
              justifyContent: "center",
            }}
          >
            <Ionicons
              name={visible ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={colors.textTertiary}
            />
          </Pressable>
        </View>
      </View>
    );
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
            Choose a new password
          </Text>
        </View>

        <View style={{ gap: Spacing.md, marginTop: Spacing.xl }}>
          <PasswordInput
            label="New Password"
            value={newPassword}
            onChange={setNewPassword}
            visible={showNew}
            onToggle={() => setShowNew((v) => !v)}
            accessLabel="New password"
          />
          <PasswordInput
            label="Confirm Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            visible={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            accessLabel="Confirm new password"
          />

          <Pressable
            onPress={handleUpdatePassword}
            disabled={!isValid}
            accessibilityLabel="Update password"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
            style={({ pressed }) => ({
              marginTop: Spacing.sm,
              padding: Spacing.lg,
              borderRadius: BorderRadius.md,
              backgroundColor: pressed ? Colors.primaryDark : Colors.primary,
              alignItems: "center",
              opacity: !isValid ? 0.5 : 1,
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
                Update Password
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

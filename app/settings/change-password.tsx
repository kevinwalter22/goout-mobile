import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";

export default function ChangePassword() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const isValid =
    currentPassword.length >= 6 &&
    newPassword.length >= 6 &&
    newPassword === confirmPassword &&
    !saving;

  async function handleChangePassword() {
    if (!isValid) return;

    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "New passwords don't match");
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      Alert.alert("Success", "Your password has been updated", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update password";
      Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }
  }

  const inputContainerStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
  };

  const inputStyle = {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 16,
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
          Change Password
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 24, gap: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Current Password */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>
            Current Password
          </Text>
          <View style={inputContainerStyle}>
            <TextInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter current password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!showCurrentPassword}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
            <Pressable onPress={() => setShowCurrentPassword(!showCurrentPassword)} hitSlop={8}>
              <Ionicons
                name={showCurrentPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.textSecondary}
              />
            </Pressable>
          </View>
        </View>

        {/* New Password */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>
            New Password
          </Text>
          <View style={inputContainerStyle}>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Enter new password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!showNewPassword}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
            <Pressable onPress={() => setShowNewPassword(!showNewPassword)} hitSlop={8}>
              <Ionicons
                name={showNewPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.textSecondary}
              />
            </Pressable>
          </View>
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>
            Must be at least 6 characters
          </Text>
        </View>

        {/* Confirm New Password */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>
            Confirm New Password
          </Text>
          <View style={inputContainerStyle}>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
            />
            <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} hitSlop={8}>
              <Ionicons
                name={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.textSecondary}
              />
            </Pressable>
          </View>
          {confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <Text style={{ fontSize: 12, color: Colors.error }}>
              Passwords don't match
            </Text>
          )}
        </View>

        {/* Save Button */}
        <Pressable
          onPress={handleChangePassword}
          disabled={!isValid}
          style={{
            marginTop: 8,
            padding: 16,
            borderRadius: 12,
            backgroundColor: isValid ? Colors.primary : colors.border,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
            {saving ? "Updating..." : "Update Password"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

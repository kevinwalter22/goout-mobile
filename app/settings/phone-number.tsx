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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { normalizePhone } from "../../src/utils/phoneHash";
import { captureError } from "../../src/lib/logger";
import { friendlyMessage } from "../../src/lib/errorMessages";

export default function PhoneNumber() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, profile, refreshProfile } = useAuth();

  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile?.phone_number) {
      setPhone(profile.phone_number);
    }
  }, [profile]);

  const hasExisting = !!profile?.phone_number;
  const canSave = phone.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave || !user) return;

    const normalized = normalizePhone(phone);
    if (!normalized) {
      Alert.alert("Invalid Number", "Please enter a valid phone number (e.g. +1 555 123 4567)");
      return;
    }

    setSaving(true);

    try {
      const { error } = await (supabase.rpc as any)("save_phone_number", {
        p_user_id: user.id,
        p_phone_number: normalized,
      });

      if (error) throw new Error(error.message);

      await refreshProfile();
      router.back();
    } catch (err) {
      captureError(err, { action: "savePhoneNumber" });
      Alert.alert("Error", friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!user) return;

    Alert.alert(
      "Remove Phone Number",
      "Friends will no longer be able to find you by phone number.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              const { error } = await (supabase.rpc as any)("save_phone_number", {
                p_user_id: user.id,
                p_phone_number: "",
              });

              if (error) throw new Error(error.message);

              await refreshProfile();
              router.back();
            } catch (err) {
              captureError(err, { action: "removePhoneNumber" });
              Alert.alert("Error", friendlyMessage(err));
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  const inputStyle = {
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
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
          justifyContent: "space-between",
          padding: 16,
          paddingTop: insets.top + 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          Phone Number
        </Text>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={{
            backgroundColor: canSave ? Colors.primary : colors.border,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            {saving ? "Saving..." : "Save"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 24, gap: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Phone Input */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>
            Phone Number
          </Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 555 123 4567"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
            autoComplete="tel"
            style={inputStyle}
          />
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>
            Your phone number helps friends find you. It won't be shown publicly.
          </Text>
        </View>

        {/* Remove Button */}
        {hasExisting && (
          <Pressable onPress={handleRemove} disabled={saving}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: "600",
                color: Colors.error,
                textAlign: "center",
              }}
            >
              Remove phone number
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

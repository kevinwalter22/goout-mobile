import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { useAuth } from "../../src/hooks/useAuth";
import { useToast } from "../../src/context/ToastContext";
import { supabase } from "../../src/lib/supabase";
import { shareApp } from "../../src/utils/share";
import { router } from "expo-router";

type FeedbackType = "bug" | "idea" | "general";

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "general", label: "General" },
];

export default function FeedbackScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = selectedType !== null && message.trim().length >= 10 && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !user) return;
    setSubmitting(true);
    const { error } = await (supabase.from as any)("feedback").insert({
      user_id: user.id,
      type: selectedType,
      message: message.trim(),
    });
    setSubmitting(false);
    if (error) {
      console.error("[Feedback] insert error:", error.message);
      showToast("Couldn't send — try again", "error");
    } else {
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Give Feedback" />
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: Colors.success + "20",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
            }}
          >
            <Ionicons name="checkmark" size={32} color={Colors.success} />
          </View>

          <Text
            style={{
              fontSize: 22,
              fontWeight: "700",
              color: colors.text,
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            Thanks for the feedback.
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: colors.textSecondary,
              textAlign: "center",
              lineHeight: 22,
              marginBottom: 40,
            }}
          >
            It genuinely helps us build something worth using.
          </Text>

          <View style={{ gap: 12, width: "100%" }}>
            <Pressable
              onPress={shareApp}
              style={{
                backgroundColor: Colors.primary,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>
                Invite a Friend
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.back()}
              style={{ paddingVertical: 16, alignItems: "center" }}
            >
              <Text style={{ fontSize: 16, color: colors.textSecondary }}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Give Feedback" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 24, gap: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Type selector */}
          <View style={{ gap: 8 }}>
            <Text
              style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}
            >
              What kind of feedback?
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {TYPES.map(({ value, label }) => {
                const active = selectedType === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setSelectedType(value)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 20,
                      alignItems: "center",
                      backgroundColor: active ? Colors.primary : colors.surfaceVariant,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "600",
                        color: active ? "#fff" : colors.textSecondary,
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Message input */}
          <View style={{ gap: 8 }}>
            <Text
              style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}
            >
              Tell us more
            </Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              placeholder="Tell us what's on your mind..."
              placeholderTextColor={colors.textTertiary}
              style={{
                fontSize: 16,
                color: colors.text,
                backgroundColor: colors.inputBg,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                padding: 16,
                minHeight: 140,
                textAlignVertical: "top",
              }}
            />
            {message.trim().length > 0 && message.trim().length < 10 && (
              <Text style={{ fontSize: 12, color: colors.textTertiary }}>
                A bit more detail helps us a lot
              </Text>
            )}
          </View>

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={{
              backgroundColor: canSubmit ? Colors.primary : colors.surfaceVariant,
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "600",
                  color: canSubmit ? "#fff" : colors.textTertiary,
                }}
              >
                Send Feedback
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

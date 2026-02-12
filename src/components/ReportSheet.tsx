import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import { useContentReport } from "../hooks/useContentReport";
import { Colors } from "../config/theme";
import type { ReportReason, ReportTargetType } from "../types/database";

type ReportSheetProps = {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  /** Optional: also offer "Block user" in the sheet */
  targetUserId?: string;
  onBlockUser?: (userId: string) => void;
};

const REASONS: { value: ReportReason; label: string; icon: string }[] = [
  { value: "spam", label: "Spam", icon: "megaphone-outline" },
  { value: "harassment", label: "Harassment or bullying", icon: "warning-outline" },
  { value: "inappropriate_content", label: "Inappropriate content", icon: "eye-off-outline" },
  { value: "impersonation", label: "Impersonation", icon: "person-outline" },
  { value: "other", label: "Other", icon: "ellipsis-horizontal-outline" },
];

export function ReportSheet({
  visible,
  onClose,
  targetType,
  targetId,
  targetUserId,
  onBlockUser,
}: ReportSheetProps) {
  const { colors } = useTheme();
  const { submitReport, submitting } = useContentReport();
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [step, setStep] = useState<"reason" | "details">("reason");

  function reset() {
    setSelectedReason(null);
    setDetails("");
    setStep("reason");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!selectedReason) return;

    const { success, alreadyReported } = await submitReport(
      targetType,
      targetId,
      selectedReason,
      details.trim() || undefined
    );

    if (alreadyReported) {
      Alert.alert(
        "Already Reported",
        "You have already reported this content. Our team will review it."
      );
      handleClose();
      return;
    }

    if (success) {
      Alert.alert(
        "Report Submitted",
        "Thank you for reporting. Our team will review this content.",
        [
          {
            text: targetUserId && onBlockUser ? "Block User Too" : "OK",
            onPress: () => {
              if (targetUserId && onBlockUser) {
                onBlockUser(targetUserId);
              }
              handleClose();
            },
          },
          ...(targetUserId && onBlockUser
            ? [{ text: "OK", onPress: handleClose }]
            : []),
        ]
      );
    } else {
      Alert.alert("Error", "Failed to submit report. Please try again.");
    }
  }

  const targetLabel =
    targetType === "post" ? "post" : targetType === "comment" ? "comment" : "user";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.separator }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            Report {targetLabel}
          </Text>
          <Pressable onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        {step === "reason" ? (
          <View style={styles.content}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Why are you reporting this {targetLabel}?
            </Text>

            {REASONS.map((reason) => (
              <Pressable
                key={reason.value}
                onPress={() => {
                  setSelectedReason(reason.value);
                  setStep("details");
                }}
                style={[styles.reasonRow, { borderBottomColor: colors.borderLight }]}
              >
                <Ionicons
                  name={reason.icon as any}
                  size={20}
                  color={colors.textSecondary}
                />
                <Text style={[styles.reasonLabel, { color: colors.text }]}>
                  {reason.label}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.content}>
            <View style={styles.selectedReasonBadge}>
              <Text style={[styles.selectedReasonText, { color: colors.textSecondary }]}>
                Reason: {REASONS.find((r) => r.value === selectedReason)?.label}
              </Text>
              <Pressable onPress={() => setStep("reason")}>
                <Text style={{ color: Colors.primary, fontWeight: "600" }}>Change</Text>
              </Pressable>
            </View>

            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Any additional details? (optional)
            </Text>

            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="Tell us more about the issue..."
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={500}
              style={[
                styles.detailsInput,
                { backgroundColor: colors.inputBg, color: colors.text },
              ]}
            />

            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              style={[
                styles.submitButton,
                submitting && { opacity: 0.6 },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Submit Report</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingTop: 20,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  content: {
    padding: 16,
    gap: 12,
  },
  subtitle: {
    fontSize: 15,
    marginBottom: 4,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  reasonLabel: {
    flex: 1,
    fontSize: 16,
  },
  selectedReasonBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  selectedReasonText: {
    fontSize: 14,
  },
  detailsInput: {
    padding: 12,
    borderRadius: 12,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: "top",
  },
  submitButton: {
    marginTop: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.error,
    alignItems: "center",
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});

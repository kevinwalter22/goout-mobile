import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../contexts/ThemeContext";
import { Colors } from "../config/theme";
import { shareApp } from "../utils/share";

interface WelcomeModalProps {
  visible: boolean;
  onClose: () => void;
}

export function WelcomeModal({ visible, onClose }: WelcomeModalProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  async function handleInvite() {
    await shareApp();
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          paddingHorizontal: 32,
          paddingBottom: insets.bottom + 24,
          justifyContent: "center",
        }}
      >
        {/* Emoji */}
        <Text style={{ fontSize: 56, textAlign: "center", marginBottom: 24 }}>👋</Text>

        {/* Heading */}
        <Text
          style={{
            fontSize: 28,
            fontWeight: "700",
            color: colors.text,
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          Welcome to Euda
        </Text>

        {/* Body */}
        <Text
          style={{
            fontSize: 16,
            color: colors.textSecondary,
            textAlign: "center",
            lineHeight: 24,
            marginBottom: 40,
          }}
        >
          You&apos;re part of something bigger than just going out — you&apos;re helping build a community
          that actually shows up.
        </Text>

        {/* CTAs */}
        <View style={{ gap: 12 }}>
          <Pressable
            onPress={handleInvite}
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
            onPress={onClose}
            style={{
              paddingVertical: 16,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 16, color: colors.textSecondary }}>Let&apos;s go →</Text>
          </Pressable>
        </View>

        {/* Privacy note */}
        <Text
          style={{
            fontSize: 13,
            color: colors.textTertiary,
            textAlign: "center",
            marginTop: 32,
          }}
        >
          We don&apos;t sell your data. Ever.
        </Text>
      </View>
    </Modal>
  );
}

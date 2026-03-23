import { Platform, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import { Colors } from "../config/theme";

interface ScreenHeaderProps {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

/**
 * Shared screen header — purple pill back button, used on all detail screens.
 * Modals (create/edit event) use their own X close button instead.
 */
export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const handleBack = onBack ?? (() => router.back());

  const backButton = (
    <Pressable
      onPress={handleBack}
      hitSlop={8}
      accessibilityLabel="Back"
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        backgroundColor: Colors.primary + "18",
      }}
    >
      <Ionicons
        name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"}
        size={18}
        color={Colors.primary}
      />
      <Text style={{ fontSize: 15, fontWeight: "600", color: Colors.primary }}>Back</Text>
    </Pressable>
  );

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: insets.top + 8,
        paddingBottom: 8,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ minWidth: 90 }}>{backButton}</View>
      {title ? (
        <Text
          style={{ fontSize: 18, fontWeight: "700", color: colors.text, flex: 1, textAlign: "center" }}
          numberOfLines={1}
        >
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <View style={{ minWidth: 90, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

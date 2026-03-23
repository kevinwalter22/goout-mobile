import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CAMERA_MODES } from "../../src/config/constants";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";

export default function CheckInModeSelector() {
  // Note: Route param is named eventId for URL compatibility, but this is actually
  // an explore_item_id when coming from the Explore flow
  const { eventId, itemKind } = useLocalSearchParams<{ eventId: string; itemKind?: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  function selectMode(mode: string) {
    // Pass as exploreItemId since this flow is from Explore items
    router.push({
      pathname: "/checkin/camera",
      params: { exploreItemId: eventId, mode, itemKind },
    } as any);
  }

  return (
    <View
      style={{
        flex: 1,
        padding: 24,
        paddingTop: insets.top + 24,
        justifyContent: "center",
        gap: 20,
        backgroundColor: colors.background,
      }}
    >
      <View style={{ gap: 8, marginBottom: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: "700", color: colors.text }}>
          Choose Camera Mode
        </Text>
        <Text style={{ fontSize: 16, color: colors.textSecondary }}>
          How do you want to capture this moment?
        </Text>
      </View>

      <Pressable
        onPress={() => selectMode(CAMERA_MODES.BACK)}
        accessibilityLabel="Use back camera"
        accessibilityRole="button"
        style={{
          padding: 20,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: "600",
            marginBottom: 4,
            color: colors.text,
          }}
        >
          Back Camera
        </Text>
        <Text style={{ color: colors.textSecondary }}>
          Capture what you&apos;re seeing
        </Text>
      </Pressable>

      <Pressable
        onPress={() => selectMode(CAMERA_MODES.FRONT)}
        accessibilityLabel="Use front camera"
        accessibilityRole="button"
        style={{
          padding: 20,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: "600",
            marginBottom: 4,
            color: colors.text,
          }}
        >
          Front Camera
        </Text>
        <Text style={{ color: colors.textSecondary }}>Take a selfie</Text>
      </Pressable>

      <Pressable
        onPress={() => selectMode(CAMERA_MODES.DUAL)}
        accessibilityLabel="Use dual camera — capture back then front"
        accessibilityRole="button"
        style={{
          padding: 20,
          borderRadius: 12,
          backgroundColor: Colors.primary,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: "600",
            marginBottom: 4,
            color: "#fff",
          }}
        >
          Dual Camera
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.8)" }}>
          Capture both views (back then front)
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.back()}
        accessibilityLabel="Cancel"
        accessibilityRole="button"
        style={{
          marginTop: 16,
          padding: 16,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 16, color: colors.textSecondary }}>Cancel</Text>
      </Pressable>
    </View>
  );
}

import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../src/contexts/ThemeContext";
import { Colors } from "../src/config/theme";

export default function NotFoundScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <Ionicons
        name="alert-circle-outline"
        size={64}
        color={colors.textTertiary}
        style={{ marginBottom: 16 }}
      />
      <Text
        style={{
          fontSize: 20,
          fontWeight: "700",
          color: colors.text,
          marginBottom: 8,
        }}
      >
        Page not found
      </Text>
      <Text
        style={{
          fontSize: 15,
          color: colors.textSecondary,
          textAlign: "center",
          marginBottom: 24,
        }}
      >
        This link doesn&apos;t match anything in the app.
      </Text>
      <Pressable
        onPress={() => router.replace("/")}
        style={{
          backgroundColor: Colors.primary,
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
          Go Home
        </Text>
      </Pressable>
    </View>
  );
}

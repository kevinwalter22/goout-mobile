import { Platform, Pressable } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../config/theme";

// Rendered as a sibling of <Tabs>, not a descendant, so it sits outside the
// tab navigator's own content area and must clear the tab bar itself —
// useBottomTabBarHeight() isn't reachable from here. TAB_BAR_HEIGHT mirrors
// @react-navigation/bottom-tabs' default UIKit tab bar height (49) plus the
// iOS-only paddingTop:8 set on tabBarStyle in app/(tabs)/_layout.tsx.
const TAB_BAR_HEIGHT = 49 + (Platform.OS === "ios" ? 8 : 0);

/** Purple-plus FAB, shared across every tab. Destination is /create-event until T5 flips it to post-first. */
export function PostFab() {
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={() => router.push("/create-event")}
      accessibilityLabel="Create event"
      accessibilityRole="button"
      style={{
        position: "absolute",
        bottom: 32 + TAB_BAR_HEIGHT + insets.bottom,
        right: 24,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: Colors.primary,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
      }}
    >
      <Ionicons name="add" size={28} color="#fff" />
    </Pressable>
  );
}

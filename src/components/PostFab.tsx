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
        // Sits 12px above the tab bar. Tuned so that on the Explore/map view, when
        // the preview card is up, the FAB lands in the card's bottom-right corner
        // with bottom-gap == right-gap (~8pt each): card is bottom:14/right:16, FAB
        // is right:24 (8pt inset from the card's right edge) and this offset puts its
        // bottom edge ~8pt above the card's bottom edge. Per Kevin's screenshot.
        bottom: 12 + TAB_BAR_HEIGHT + insets.bottom,
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

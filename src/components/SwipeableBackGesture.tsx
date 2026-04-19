import { useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useRouter, usePathname } from "expo-router";
import * as Haptics from "expo-haptics";

const TAB_ROUTES = ["/feed", "/explore", "/profile"];

// Screens that explicitly disable native back gesture (gestureEnabled: false)
// because accidental back-navigation would lose unsaved form data.
// SwipeableBackGesture must respect the same intent.
const GESTURE_DISABLED_PREFIXES = ["/create-event", "/edit-event", "/location-picker"];

/**
 * Wraps the root Stack to provide mid-screen horizontal back-swipe on
 * detail screens (event/[id], settings/*, etc.).  Uses the same RNGH
 * Pan gesture pattern as SwipeableTabsContainer — failOffsetY prevents
 * activation during vertical scrolling, and an onEnd direction check
 * ensures only deliberate horizontal swipes trigger navigation.
 *
 * Disabled on tab routes — SwipeableTabsContainer handles those.
 * The native 20px edge-gesture (gestureEnabled on the Stack) is kept
 * as a fallback; this component adds mid-screen activation on top.
 */
export function SwipeableBackGesture({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const panGesture = useMemo(() => {
    const isTabScreen = TAB_ROUTES.includes(pathname);
    const isGestureDisabled = GESTURE_DISABLED_PREFIXES.some((p) => pathname.startsWith(p));

    return (
      Gesture.Pan()
        .runOnJS(true)
        // Same activation / fail thresholds as SwipeableTabsContainer
        .activeOffsetX([-12, 12])
        .failOffsetY([-20, 20])
        // Disabled on tab screens (SwipeableTabsContainer handles those)
        // and on form screens that explicitly opt out of back gestures.
        .enabled(!isTabScreen && !isGestureDisabled)
        .onEnd((event) => {
          const { translationX, translationY, velocityX } = event;

          // Only right-swipe = back navigation
          if (translationX <= 0) return;

          // Must be more horizontal than vertical
          if (Math.abs(translationX) < Math.abs(translationY)) return;

          // Need sufficient drag (50px) OR a quick flick (150 px/s)
          if (translationX < 50 && velocityX < 150) return;

          // Nothing to go back to (e.g. root screen)
          if (!router.canGoBack()) return;

          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.back();
        })
    );
  }, [pathname]);

  return (
    <GestureDetector gesture={panGesture}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}

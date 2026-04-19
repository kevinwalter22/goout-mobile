import { useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useRouter, usePathname } from "expo-router";
import * as Haptics from "expo-haptics";

const TAB_ORDER = ["/feed", "/explore", "/profile"] as const;
type TabPath = (typeof TAB_ORDER)[number];

// Module-level timestamp — set whenever a swipe navigation fires.
// Lets child press handlers ignore accidental presses that race with a swipe.
let _lastSwipeNavigatedAt = 0;

/** Returns true if a swipe navigation fired within the last 350ms. */
export function didSwipeNavigateRecently(): boolean {
  return Date.now() - _lastSwipeNavigatedAt < 350;
}

export function SwipeableTabsContainer({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const panGesture = useMemo(() => {
    const isExplore = pathname === "/explore";

    return (
      Gesture.Pan()
        .runOnJS(true)
        // Claim the gesture once 12px horizontal motion is detected.
        // This prevents scroll views from stealing the touch mid-swipe.
        .activeOffsetX([-12, 12])
        // Fail (yield to vertical scroll) if >20px vertical motion appears
        // before 12px horizontal. Unified threshold across all tabs — tighter
        // than the previous ±40 (normal) / ±30 (explore) to reduce the race
        // window where a fast diagonal scroll activates the gesture.
        .failOffsetY([-20, 20])
        .onEnd((event) => {
          const { translationX, translationY, velocityX } = event;

          const tab = pathname as TabPath;
          const currentIndex = TAB_ORDER.indexOf(tab);
          if (currentIndex === -1) return;

          // Safety net: if net displacement is more vertical than horizontal,
          // the user was scrolling, not swiping tabs. This catches cases where
          // the gesture activated (horizontal reached ±12px first) but the
          // overall motion was diagonal or vertical.
          if (Math.abs(translationX) < Math.abs(translationY)) return;

          // OR logic: either a deliberate drag OR a quick flick is sufficient.
          // Explore thresholds are slightly higher to reduce accidental triggers
          // while panning the map.
          const minX = isExplore ? 70 : 50;
          const minV = isExplore ? 250 : 150;

          if (Math.abs(translationX) < minX && Math.abs(velocityX) < minV) return;

          let targetIndex: number | null = null;
          if (translationX < 0 && currentIndex < TAB_ORDER.length - 1) {
            targetIndex = currentIndex + 1; // swipe left → next tab
          } else if (translationX > 0 && currentIndex > 0) {
            targetIndex = currentIndex - 1; // swipe right → prev tab
          }

          if (targetIndex !== null) {
            _lastSwipeNavigatedAt = Date.now();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.navigate(TAB_ORDER[targetIndex]);
          }
        })
    );
  }, [pathname]);

  return (
    <GestureDetector gesture={panGesture}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}

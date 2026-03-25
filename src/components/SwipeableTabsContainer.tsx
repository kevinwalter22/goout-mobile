import { useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useRouter, usePathname } from "expo-router";
import * as Haptics from "expo-haptics";

const TAB_ORDER = ["/feed", "/explore", "/profile"] as const;
type TabPath = (typeof TAB_ORDER)[number];

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
        // Automatically fail (yield to vertical scroll) if vertical motion
        // exceeds the limit before horizontal activation.
        // Explore is slightly tighter to protect map pan gestures.
        .failOffsetY(isExplore ? [-30, 30] : [-40, 40])
        .onEnd((event) => {
          const { translationX, velocityX } = event;

          const tab = pathname as TabPath;
          const currentIndex = TAB_ORDER.indexOf(tab);
          if (currentIndex === -1) return;

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

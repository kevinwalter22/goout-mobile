import { useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useRouter, usePathname } from "expo-router";
import * as Haptics from "expo-haptics";

const TAB_ORDER = ["/feed", "/explore", "/profile"] as const;
type TabPath = (typeof TAB_ORDER)[number];

// Per-tab thresholds.
// Explore uses tighter values to avoid conflict with map pan and horizontal carousels.
const THRESHOLDS: Record<TabPath, { minX: number; maxY: number; minV: number }> = {
  "/feed":    { minX: 80,  maxY: 40, minV: 300 },
  "/explore": { minX: 120, maxY: 25, minV: 500 },
  "/profile": { minX: 80,  maxY: 40, minV: 300 },
};

export function SwipeableTabsContainer({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onEnd((event) => {
          const { translationX, translationY, velocityX } = event;

          const tab = pathname as TabPath;
          const t = THRESHOLDS[tab];
          if (!t) return;

          const isIntentional =
            Math.abs(translationX) > t.minX &&
            Math.abs(translationY) < t.maxY &&
            Math.abs(velocityX) > t.minV;

          if (!isIntentional) return;

          const currentIndex = TAB_ORDER.indexOf(tab);
          if (currentIndex === -1) return;

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
        }),
    [pathname]
  );

  return (
    <GestureDetector gesture={panGesture}>
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}

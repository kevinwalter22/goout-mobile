import React from "react";
import { StyleProp, ViewStyle } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

const MAX_SCALE = 3;
const SPRING_CONFIG = { damping: 25, stiffness: 250 };

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Wraps any image component with pinch-to-zoom.
 *
 * - Pinch spreads up to 3× scale
 * - Releasing springs back to 1× automatically (no double-tap needed)
 * - No pan-while-zoomed: zoom is constrained to the container bounds via overflow:hidden
 * - No conflict with FlatList vertical scroll (pinch is a distinct gesture type)
 */
export function ZoomableImage({ children, style }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_SCALE);
    })
    .onEnd(() => {
      scale.value = withSpring(1, SPRING_CONFIG);
      savedScale.value = 1;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={pinch}>
      <Animated.View style={[style, animatedStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

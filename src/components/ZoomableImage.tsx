import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";

const MAX_SCALE = 3;
const RESET_TIMING = { duration: 180, easing: Easing.out(Easing.quad) };

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Wraps any image component with pinch-to-zoom.
 *
 * - Pinch spreads up to 3× scale
 * - Zoom is anchored to the actual touch focal point (not the image center)
 * - Releasing snaps back to 1× with a clean ease-out (no spring bounce)
 * - Outer View owns overflow:hidden so the clip plane doesn't move during transform
 * - No conflict with FlatList vertical scroll (pinch is a distinct gesture type)
 */
export function ZoomableImage({ children, style }: Props) {
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Focal point captured at gesture start (container-local coords from top-left)
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);

  // Container dimensions measured via onLayout
  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      // Capture the centroid of the two fingers once, at gesture start.
      // Using the start point (vs live focalX) keeps the zoom anchor fixed
      // throughout the gesture, which feels more intentional.
      startFocalX.value = e.focalX;
      startFocalY.value = e.focalY;
    })
    .onUpdate((e) => {
      const s = Math.min(Math.max(e.scale, 1), MAX_SCALE);
      scale.value = s;

      // Translate to keep the focal point visually stationary as scale grows.
      // offset = focal point relative to the view's geometric center.
      // translateX = offset * (1 - s) shifts the center such that the focal
      // point maps to the same screen position before and after scaling.
      const ox = startFocalX.value - containerWidth.value / 2;
      const oy = startFocalY.value - containerHeight.value / 2;
      translateX.value = ox * (1 - s);
      translateY.value = oy * (1 - s);
    })
    .onEnd(() => {
      scale.value = withTiming(1, RESET_TIMING);
      translateX.value = withTiming(0, RESET_TIMING);
      translateY.value = withTiming(0, RESET_TIMING);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    // Outer View: owns the layout bounds, overflow clip, and border radius.
    // It must NOT be animated — the clip plane needs to stay fixed while the
    // inner content scales/translates within it.
    <View
      style={style}
      onLayout={(e) => {
        containerWidth.value = e.nativeEvent.layout.width;
        containerHeight.value = e.nativeEvent.layout.height;
      }}
    >
      <GestureDetector gesture={pinch}>
        <Animated.View style={[{ width: "100%", height: "100%" }, animatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

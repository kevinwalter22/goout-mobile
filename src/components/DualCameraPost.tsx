import { useRef, useState } from "react";
import {
  View,
  StyleProp,
  ViewStyle,
  Animated,
  StyleSheet,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { getImageUrl } from "../utils/storage";

const OVERLAY_W = 100;
const OVERLAY_H = 133;
const MARGIN = 16;

function snapToCorner(x: number, y: number, cW: number, cH: number) {
  "worklet";
  const corners = [
    { x: MARGIN,                  y: MARGIN },
    { x: cW - OVERLAY_W - MARGIN, y: MARGIN },
    { x: MARGIN,                  y: cH - OVERLAY_H - MARGIN },
    { x: cW - OVERLAY_W - MARGIN, y: cH - OVERLAY_H - MARGIN },
  ];
  let minD = Infinity, best = corners[0];
  for (const c of corners) {
    const d = (x - c.x) ** 2 + (y - c.y) ** 2;
    if (d < minD) { minD = d; best = c; }
  }
  return best;
}

type DualCameraPostProps = {
  backPhotoPath: string;
  frontPhotoPath: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Component that displays a dual camera post with BeReal-style overlay
 * Shows back camera as main image with front camera as small overlay
 *
 * Features:
 * - Both images preloaded and kept mounted (no remount on swap)
 * - True crossfade animation (simultaneous fade in/out)
 * - Tap overlay to swap images
 * - Drag overlay to any corner (snaps on release)
 * - Hold main image > 300ms to temporarily hide the overlay
 */
export function DualCameraPost({
  backPhotoPath,
  frontPhotoPath,
  style,
}: DualCameraPostProps) {
  const [isBackMain, setIsBackMain] = useState(true);

  // Crossfade: 0 = back is main, 1 = front is main
  const crossfadeAnim = useRef(new Animated.Value(0)).current;

  // Get URLs once and keep them stable
  const backUrl = getImageUrl(backPhotoPath);
  const frontUrl = getImageUrl(frontPhotoPath);

  const handleSwap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newIsBackMain = !isBackMain;
    setIsBackMain(newIsBackMain);
    Animated.timing(crossfadeAnim, {
      toValue: newIsBackMain ? 0 : 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  // Interpolate opacities for true crossfade
  const backMainOpacity = crossfadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });
  const frontMainOpacity = crossfadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const backOverlayOpacity = crossfadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const frontOverlayOpacity = crossfadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  // Overlay position & visibility (Reanimated shared values)
  const containerW = useSharedValue(0);
  const containerH = useSharedValue(0);
  const overlayX   = useSharedValue(MARGIN);
  const overlayY   = useSharedValue(MARGIN);
  const panStartX  = useSharedValue(MARGIN);
  const panStartY  = useSharedValue(MARGIN);
  const overlayVis = useSharedValue(1);

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => runOnJS(handleSwap)());

  const pan = Gesture.Pan()
    .minDistance(10)
    .onBegin(() => {
      panStartX.value = overlayX.value;
      panStartY.value = overlayY.value;
    })
    .onUpdate((e) => {
      overlayX.value = panStartX.value + e.translationX;
      overlayY.value = panStartY.value + e.translationY;
    })
    .onEnd(() => {
      const c = snapToCorner(overlayX.value, overlayY.value, containerW.value, containerH.value);
      overlayX.value = c.x;
      overlayY.value = c.y;
      panStartX.value = c.x;
      panStartY.value = c.y;
    });

  const overlayGesture = Gesture.Race(pan, tap);

  // Hold on main image to temporarily hide the overlay
  const mainLongPress = Gesture.LongPress()
    .minDuration(300)
    .onStart(() => { overlayVis.value = withTiming(0, { duration: 150 }); })
    .onFinalize(() => { overlayVis.value = withTiming(1, { duration: 200 }); });

  const overlayAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: overlayX.value },
      { translateY: overlayY.value },
    ],
    opacity: overlayVis.value,
  }));

  return (
    <View
      style={style}
      onLayout={(e) => {
        containerW.value = e.nativeEvent.layout.width;
        containerH.value = e.nativeEvent.layout.height;
      }}
    >
      {/* Main images — hold to temporarily hide the overlay */}
      <GestureDetector gesture={mainLongPress}>
        <View style={{ width: "100%", height: "100%" }}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: backMainOpacity }]}>
            <ExpoImage source={backUrl} contentFit="cover" style={StyleSheet.absoluteFill} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: frontMainOpacity }]}>
            <ExpoImage source={frontUrl} contentFit="cover" style={StyleSheet.absoluteFill} />
          </Animated.View>
        </View>
      </GestureDetector>

      {/* Overlay — draggable to any corner, tap to swap */}
      <GestureDetector gesture={overlayGesture}>
        <ReAnimated.View
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              width: OVERLAY_W,
              height: OVERLAY_H,
              borderRadius: 12,
              borderWidth: 3,
              borderColor: "white",
              overflow: "hidden",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 3.84,
              elevation: 5,
            },
            overlayAnimStyle,
          ]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: backOverlayOpacity }]}>
            <ExpoImage source={backUrl} contentFit="cover" style={StyleSheet.absoluteFill} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: frontOverlayOpacity }]}>
            <ExpoImage source={frontUrl} contentFit="cover" style={StyleSheet.absoluteFill} />
          </Animated.View>
        </ReAnimated.View>
      </GestureDetector>
    </View>
  );
}

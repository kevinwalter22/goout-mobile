import { useRef, useState } from "react";
import {
  View,
  StyleProp,
  ViewStyle,
  Pressable,
  Animated,
  StyleSheet,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import * as Haptics from "expo-haptics";
import { getImageUrl } from "../utils/storage";

type DualCameraPostProps = {
  backPhotoPath: string;
  frontPhotoPath: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Component that displays a dual camera post with BeReal-style overlay
 * Shows back camera as main image with front camera as small overlay in top-left corner
 * Tap the overlay to swap images
 *
 * Features:
 * - Both images preloaded and kept mounted (no remount on swap)
 * - True crossfade animation (simultaneous fade in/out)
 * - Instant swap feel with haptic feedback
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
    // Trigger haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const newIsBackMain = !isBackMain;
    setIsBackMain(newIsBackMain);

    // Animate crossfade: 0 = back main, 1 = front main
    Animated.timing(crossfadeAnim, {
      toValue: newIsBackMain ? 0 : 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  // Interpolate opacities for true crossfade
  // Main images: back fades out as front fades in
  const backMainOpacity = crossfadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });
  const frontMainOpacity = crossfadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  // Overlay images: opposite of main
  const backOverlayOpacity = crossfadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const frontOverlayOpacity = crossfadeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <View style={style}>
      {/* Main images - both rendered, opacity controls visibility */}
      <View style={{ width: "100%", height: "100%" }}>
        {/* Back camera as main */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backMainOpacity }]}>
          <ExpoImage source={backUrl} contentFit="cover" style={StyleSheet.absoluteFill} />
        </Animated.View>
        {/* Front camera as main */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: frontMainOpacity }]}>
          <ExpoImage source={frontUrl} contentFit="cover" style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>

      {/* Overlay image - tappable to swap */}
      <Pressable
        onPress={handleSwap}
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          width: 100,
          height: 133, // maintain 3:4 aspect ratio
          borderRadius: 12,
          borderWidth: 3,
          borderColor: "white",
          overflow: "hidden",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
          elevation: 5,
        }}
      >
        {/* Back camera as overlay */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backOverlayOpacity }]}>
          <ExpoImage source={backUrl} contentFit="cover" style={StyleSheet.absoluteFill} />
        </Animated.View>
        {/* Front camera as overlay */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: frontOverlayOpacity }]}>
          <ExpoImage source={frontUrl} contentFit="cover" style={StyleSheet.absoluteFill} />
        </Animated.View>
      </Pressable>
    </View>
  );
}

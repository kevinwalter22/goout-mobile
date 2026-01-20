import { useState } from "react";
import { View, StyleProp, ViewStyle, Pressable, Animated } from "react-native";
import * as Haptics from "expo-haptics";
import { PostImage } from "./PostImage";

type DualCameraPostProps = {
  backPhotoPath: string;
  frontPhotoPath: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Component that displays a dual camera post with BeReal-style overlay
 * Shows back camera as main image with front camera as small overlay in top-left corner
 * Tap the overlay to swap images
 */
export function DualCameraPost({
  backPhotoPath,
  frontPhotoPath,
  style,
}: DualCameraPostProps) {
  const [isBackMain, setIsBackMain] = useState(true);
  const [fadeAnim] = useState(new Animated.Value(1));

  const handleSwap = () => {
    // Trigger haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Crossfade animation
    Animated.sequence([
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
      // Fade in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Swap photos
    setIsBackMain(!isBackMain);
  };

  const mainPhotoPath = isBackMain ? backPhotoPath : frontPhotoPath;
  const overlayPhotoPath = isBackMain ? frontPhotoPath : backPhotoPath;

  return (
    <View style={style}>
      {/* Main image with fade animation */}
      <Animated.View style={{ opacity: fadeAnim, width: "100%", height: "100%" }}>
        <PostImage
          photoPath={mainPhotoPath}
          style={{ width: "100%", height: "100%" }}
        />
      </Animated.View>

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
        }}
      >
        <Animated.View style={{ opacity: fadeAnim, width: "100%", height: "100%" }}>
          <PostImage
            photoPath={overlayPhotoPath}
            style={{ width: "100%", height: "100%" }}
          />
        </Animated.View>
      </Pressable>
    </View>
  );
}

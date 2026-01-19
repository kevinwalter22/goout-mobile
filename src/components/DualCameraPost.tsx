import { View, StyleProp, ViewStyle } from "react-native";
import { PostImage } from "./PostImage";

type DualCameraPostProps = {
  backPhotoPath: string;
  frontPhotoPath: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Component that displays a dual camera post with BeReal-style overlay
 * Shows back camera as main image with front camera as small overlay in top-left corner
 */
export function DualCameraPost({
  backPhotoPath,
  frontPhotoPath,
  style,
}: DualCameraPostProps) {
  return (
    <View style={style}>
      {/* Main back camera image */}
      <PostImage
        photoPath={backPhotoPath}
        style={{ width: "100%", height: "100%" }}
      />

      {/* Front camera overlay in top-left corner (BeReal style) */}
      <View
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
        <PostImage
          photoPath={frontPhotoPath}
          style={{ width: "100%", height: "100%" }}
        />
      </View>
    </View>
  );
}

import { useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import ViewShot from "react-native-view-shot";

type DualCameraCompositeProps = {
  backPhotoUri: string;
  frontPhotoUri: string;
  onCapture: (uri: string) => void;
};

/**
 * Component that renders two camera images composited together
 * and captures them as a single image
 */
export function DualCameraComposite({
  backPhotoUri,
  frontPhotoUri,
  onCapture,
}: DualCameraCompositeProps) {
  const viewShotRef = useRef<ViewShot>(null);
  const [backLoaded, setBackLoaded] = useState(false);
  const [frontLoaded, setFrontLoaded] = useState(false);
  const [captured, setCaptured] = useState(false);

  const captureComposite = async () => {
    if (!viewShotRef.current) return;
    if (!backLoaded || !frontLoaded) {
      console.log("[Composite] Images not loaded yet, waiting...");
      return;
    }

    try {
      console.log("[Composite] Capturing composite view");
      const uri = await viewShotRef.current.capture?.();
      if (uri) {
        console.log("[Composite] Composite captured:", uri);
        setCaptured(true);
        onCapture(uri);
      }
    } catch (error) {
      console.error("[Composite] Error capturing:", error);
      // Fallback to back camera photo
      setCaptured(true);
      onCapture(backPhotoUri);
    }
  };

  // Trigger capture after both images load (only once)
  useEffect(() => {
    if (backLoaded && frontLoaded && !captured) {
      console.log("[Composite] Both images loaded, waiting for render...");
      // Wait a bit for render to complete
      const timer = setTimeout(() => captureComposite(), 500);
      return () => clearTimeout(timer);
    }
  }, [backLoaded, frontLoaded, captured, captureComposite]);

  return (
    <ViewShot
      ref={viewShotRef}
      options={{ format: "jpg", quality: 0.8 }}
      style={{ width: 1080, height: 1440 }} // 3:4 aspect ratio
    >
      {/* Main back camera image */}
      <Image
        source={{ uri: backPhotoUri }}
        style={{ width: "100%", height: "100%", position: "absolute" }}
        resizeMode="cover"
        onLoad={() => {
          console.log("[Composite] Back image loaded");
          setBackLoaded(true);
        }}
      />

      {/* Front camera overlay in top-right corner */}
      <View
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 324, // 30% of 1080
          height: 432, // maintain 3:4 aspect ratio
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
        <Image
          source={{ uri: frontPhotoUri }}
          style={{ width: "100%", height: "100%"}}
          resizeMode="cover"
          onLoad={() => {
            console.log("[Composite] Front image loaded");
            setFrontLoaded(true);
          }}
        />
      </View>
    </ViewShot>
  );
}

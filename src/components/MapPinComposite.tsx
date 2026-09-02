import { useCallback, useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import ViewShot from "react-native-view-shot";
import { Colors } from "../config/theme";

// Plan B photo-bubble pins. Composites a user-created event's photo ONCE into a fixed-size
// circular disc pin (photo masked in a 72px circle + a state ring), captured as a
// transparent PNG so it drops into the Mapbox symbol layer at the SAME on-screen size as
// every emoji pin. Modeled on DualCameraComposite (react-native-view-shot). Rendered
// off-screen; onCapture returns a local file uri to upload + cache (render-once/cache-forever).
//
// Geometry matches the baked ring pins (assets/mappins/ring/*, 100px): a 72px photo circle
// centered in a 100px canvas, ringed. iconImage renders both at iconSize 0.5 → identical size.

const PIN_SIZE = 100;   // canvas — matches RING_PIN_IMAGES so photo + emoji pins render equal
const PHOTO_SIZE = 72;  // inner photo circle — matches the base emoji disc
const RING_DIAMETER = 92;
const RING_WIDTH = 6;

// INNER×RING framework — ring colour by state (single highest-priority state).
// V1 bakes the creator-facing default ("yours"); the seam accepts any state colour.
export type PinRingState = "postable" | "invited" | "yours";
export const PIN_RING_COLORS: Record<PinRingState, string> = {
  postable: Colors.primary, // brand purple — "you can post here now" (matches emoji ring language)
  invited: "#3B82F6",       // blue — "you're invited"
  yours: "#22C55E",         // green — "your own"
};

type Props = {
  photoUri: string;
  ringState?: PinRingState;
  /** Fired once with a local file uri of the captured PNG (or null if capture failed). */
  onCapture: (uri: string | null) => void;
};

export function MapPinComposite({ photoUri, ringState = "yours", onCapture }: Props) {
  const viewShotRef = useRef<ViewShot>(null);
  const [loaded, setLoaded] = useState(false);
  const [done, setDone] = useState(false);

  const finish = useCallback(
    (uri: string | null) => {
      setDone((d) => {
        if (!d) onCapture(uri);
        return true;
      });
    },
    [onCapture],
  );

  const capture = useCallback(async () => {
    if (!viewShotRef.current || done) return;
    try {
      const uri = await viewShotRef.current.capture?.();
      finish(uri ?? null);
    } catch {
      finish(null);
    }
  }, [done, finish]);

  // Capture once the photo has loaded — 500ms (the delay the working DualCameraComposite
  // uses) so the masked photo + ring are fully painted before ViewShot captures.
  useEffect(() => {
    if (loaded && !done) {
      const t = setTimeout(capture, 500);
      return () => clearTimeout(t);
    }
  }, [loaded, done, capture]);

  // Safety net: never hang the create flow. If the image never loads (or capture never
  // fires), give up after 4s and emit null so the caller proceeds with the emoji fallback.
  useEffect(() => {
    const hard = setTimeout(() => finish(null), 4000);
    return () => clearTimeout(hard);
  }, [finish]);

  return (
    <ViewShot
      ref={viewShotRef}
      options={{ format: "png", quality: 1 }}
      style={{
        width: PIN_SIZE,
        height: PIN_SIZE,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
      }}
    >
      {/* State ring (drawn behind the photo circle) */}
      <View
        style={{
          position: "absolute",
          width: RING_DIAMETER,
          height: RING_DIAMETER,
          borderRadius: RING_DIAMETER / 2,
          borderWidth: RING_WIDTH,
          borderColor: PIN_RING_COLORS[ringState],
          backgroundColor: "rgba(255,255,255,0.16)",
        }}
      />
      {/* Photo masked into the standard-sized circle, white hairline for definition */}
      <View
        style={{
          width: PHOTO_SIZE,
          height: PHOTO_SIZE,
          borderRadius: PHOTO_SIZE / 2,
          overflow: "hidden",
          borderWidth: 2,
          borderColor: "#ffffff",
        }}
      >
        <Image
          source={{ uri: photoUri }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
        />
      </View>
    </ViewShot>
  );
}

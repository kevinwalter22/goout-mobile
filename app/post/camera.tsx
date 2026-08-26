// Post-first camera-select + capture screen (Phase 3 · T5).
// New, additive entry point reached from the purple-plus FAB (any tab). Focused on
// shooting: pick Back / Front / Dual, capture, then hand the photo(s) to the compose
// screen (place-picker → details → post). Carries a SECONDARY "Create an event" link
// (the old FAB destination) so event creation is still reachable, de-emphasized.
//
// The existing item-gated /checkin/camera.tsx is intentionally left untouched — this
// duplicates its proven capture logic rather than modifying it, keeping the check-in
// path 100% safe. See docs/phase3_post_first.md §2.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { CAMERA_MODES, type CameraMode } from "../../src/config/constants";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { heavyHaptic, errorHaptic } from "../../src/utils/haptics";
import { captureError } from "../../src/lib/logger";
import { normalizePostImage } from "../../src/utils/imageTransform";
import { setPostDraft } from "../../src/utils/postDraftStore";

const MODE_OPTIONS: { key: CameraMode; label: string }[] = [
  { key: CAMERA_MODES.BACK, label: "Back" },
  { key: CAMERA_MODES.DUAL, label: "Dual" },
  { key: CAMERA_MODES.FRONT, label: "Front" },
];

export default function PostCamera() {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();

  const [mode, setMode] = useState<CameraMode>(CAMERA_MODES.BACK);
  const [facing, setFacing] = useState<CameraType>("back");
  const [photos, setPhotos] = useState<string[]>([]);
  const cameraRef = useRef<CameraView>(null);

  const isDualMode = mode === CAMERA_MODES.DUAL;
  const needsBackPhoto = isDualMode && photos.length === 0;
  const needsFrontPhoto = isDualMode && photos.length === 1;
  const isComplete =
    (isDualMode && photos.length === 2) || (!isDualMode && photos.length === 1);

  const handleCancel = useCallback(() => {
    if (photos.length > 0) {
      Alert.alert("Discard Photo?", "You have unsaved photos. Are you sure you want to leave?", [
        { text: "Stay", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  }, [photos.length]);

  // Android hardware back.
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        handleCancel();
        return true;
      };
      const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
      return () => sub.remove();
    }, [handleCancel]),
  );

  useEffect(() => {
    if (permission && !permission.granted) requestPermission();
  }, [permission, requestPermission]);

  // Switching mode resets any captured photos + camera facing.
  function selectMode(next: CameraMode) {
    setPhotos([]);
    setMode(next);
    setFacing(next === CAMERA_MODES.FRONT ? "front" : "back");
  }

  async function takePhoto() {
    if (!cameraRef.current) return;
    try {
      heavyHaptic();
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo) return;
      const normalizedUri = await normalizePostImage(photo.uri, {
        isFromFrontCamera: facing === "front",
      });
      setPhotos((prev) => [...prev, normalizedUri]);
      // Dual: after the back photo, flip to the front camera for step 2.
      if (isDualMode && photos.length === 0) setFacing("front");
    } catch (error) {
      captureError(error, { action: "postCameraTakePhoto" });
      errorHaptic();
      Alert.alert("Error", "Failed to take photo");
    }
  }

  function retake() {
    Alert.alert(
      "Retake Photo?",
      "This will discard your current photo" + (isDualMode && photos.length === 2 ? "s" : "") + ".",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Retake",
          style: "destructive",
          onPress: () => {
            setPhotos([]);
            setFacing(mode === CAMERA_MODES.FRONT ? "front" : "back");
          },
        },
      ],
    );
  }

  // Hand the capture to the compose screen (place-picker → details → post).
  function next() {
    setPostDraft({ photos, mode });
    router.push("/post/compose" as any);
  }

  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: colors.background }}>
        <Text style={{ textAlign: "center", fontSize: 18, color: colors.text }}>
          Camera is not available on web. Please use the mobile app.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16, backgroundColor: colors.background }}>
        <Text style={{ fontSize: 20, fontWeight: "700", textAlign: "center", color: colors.text }}>
          Camera Access Required
        </Text>
        <Text style={{ fontSize: 16, textAlign: "center", color: colors.textSecondary }}>
          Euda needs camera access to let you capture and share moments.
        </Text>
        <Pressable
          onPress={requestPermission}
          accessibilityLabel="Grant camera permission"
          accessibilityRole="button"
          style={{ padding: 16, borderRadius: 12, backgroundColor: colors.text, alignItems: "center", marginTop: 8 }}
        >
          <Text style={{ color: colors.background, fontSize: 16, fontWeight: "600" }}>
            Grant Camera Permission
          </Text>
        </Pressable>
        <Text style={{ fontSize: 14, textAlign: "center", color: colors.textTertiary, marginTop: 8 }}>
          If you previously denied access, enable it in Settings → Euda → Camera
        </Text>
      </View>
    );
  }

  // Preview + proceed once photo(s) are captured.
  if (isComplete) {
    const previewUri = photos[photos.length - 1];
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <Pressable
          onPress={handleCancel}
          accessibilityLabel="Cancel"
          accessibilityRole="button"
          style={closeBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>

        <View style={{ flex: 1, justifyContent: "center" }}>
          <Image source={{ uri: previewUri }} style={{ width: "100%", aspectRatio: 3 / 4 }} resizeMode="contain" />
        </View>

        <View style={{ padding: 24, backgroundColor: colors.surface, gap: 12, flexDirection: "row" }}>
          <Pressable
            onPress={retake}
            accessibilityLabel="Retake photo"
            accessibilityRole="button"
            style={{ flex: 1, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: "center" }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>Retake</Text>
          </Pressable>
          <Pressable
            onPress={next}
            accessibilityLabel="Next"
            accessibilityRole="button"
            style={{ flex: 1, padding: 16, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
    );
  }

  // Camera view.
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing}>
        <Pressable
          onPress={handleCancel}
          accessibilityLabel="Cancel"
          accessibilityRole="button"
          style={closeBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>

        <View style={{ flex: 1, justifyContent: "flex-end", padding: 24, gap: 20 }}>
          {isDualMode && (
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "600", textAlign: "center" }}>
              {needsBackPhoto && "Step 1: Capture back camera"}
              {needsFrontPhoto && "Step 2: Capture front camera"}
            </Text>
          )}

          {/* Shutter */}
          <Pressable
            onPress={takePhoto}
            accessibilityLabel="Take photo"
            accessibilityRole="button"
            style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: "#fff", alignSelf: "center", borderWidth: 4, borderColor: "#000" }}
          />

          {/* Mode selector — hidden mid dual-capture so it can't reset a half-done shot. */}
          {photos.length === 0 && (
            <View style={{ flexDirection: "row", alignSelf: "center", backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 22, padding: 4, gap: 4 }}>
              {MODE_OPTIONS.map((opt) => {
                const active = mode === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => selectMode(opt.key)}
                    accessibilityLabel={`${opt.label} camera mode`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{ paddingVertical: 8, paddingHorizontal: 18, borderRadius: 18, backgroundColor: active ? "#fff" : "transparent" }}
                  >
                    <Text style={{ color: active ? "#000" : "#fff", fontWeight: "600", fontSize: 14 }}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Secondary, de-emphasized: create an event instead. */}
          {photos.length === 0 && (
            <Pressable
              onPress={() => router.replace("/create-event")}
              accessibilityLabel="Create an event instead"
              accessibilityRole="button"
              style={{ alignSelf: "center", paddingVertical: 6 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, textDecorationLine: "underline" }}>
                Create an event instead
              </Text>
            </Pressable>
          )}
        </View>
      </CameraView>
    </View>
  );
}

const closeBtn = {
  position: "absolute" as const,
  top: Platform.OS === "ios" ? 60 : 40,
  left: 16,
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: "rgba(0,0,0,0.5)",
  justifyContent: "center" as const,
  alignItems: "center" as const,
  zIndex: 10,
};

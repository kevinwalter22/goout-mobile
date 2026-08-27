// Unified capture screen (Phase 3 · T5). Reached from the purple-plus FAB (post-first)
// AND from the item-gated route (event / postable pin → strict check-in verify), which
// now routes HERE too with the place pre-linked via params — so there is ONE camera
// experience regardless of how posting started. Focused on shooting: pick Back / Front
// / Dual, capture, then hand the photo(s) (+ any pre-linked place) to compose.
//
// A secondary "Create an event instead" chip (post-first only) keeps event creation
// reachable, de-emphasized. Top chrome uses the safe-area inset so the close button
// clears the notch/Dynamic Island (prod) and the staging env banner (staging).
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
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CAMERA_MODES, type CameraMode } from "../../src/config/constants";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { heavyHaptic, errorHaptic } from "../../src/utils/haptics";
import { captureError } from "../../src/lib/logger";
import { normalizePostImage } from "../../src/utils/imageTransform";
import { setPostDraft } from "../../src/utils/postDraftStore";
import { DualCameraPost } from "../../src/components/DualCameraPost";

const MODE_OPTIONS: { key: CameraMode; label: string }[] = [
  { key: CAMERA_MODES.BACK, label: "Back" },
  { key: CAMERA_MODES.DUAL, label: "Dual" },
  { key: CAMERA_MODES.FRONT, label: "Front" },
];

export default function PostCamera() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();

  // Item-gated entry (unified in): a pre-linked, pre-verified place from the strict
  // check-in verify at the event / postable pin. Absent for the post-first FAB entry.
  const params = useLocalSearchParams<{
    exploreItemId?: string;
    itemTitle?: string;
    itemLocationName?: string;
    itemKind?: string;
    verified_lat?: string;
    verified_lng?: string;
    verified_at?: string;
  }>();
  const isItemGated = !!params.exploreItemId;

  const [mode, setMode] = useState<CameraMode>(CAMERA_MODES.BACK);
  const [facing, setFacing] = useState<CameraType>("back");
  const [photos, setPhotos] = useState<string[]>([]);
  const cameraRef = useRef<CameraView>(null);

  const isDualMode = mode === CAMERA_MODES.DUAL;
  const needsBackPhoto = isDualMode && photos.length === 0;
  const needsFrontPhoto = isDualMode && photos.length === 1;
  const isComplete =
    (isDualMode && photos.length === 2) || (!isDualMode && photos.length === 1);

  const closeBtn = {
    position: "absolute" as const,
    top: insets.top + 8,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    zIndex: 10,
  };

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
      const normalizedUri = await normalizePostImage(photo.uri, { isFromFrontCamera: facing === "front" });
      setPhotos((prev) => [...prev, normalizedUri]);
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

  // Hand the capture (+ any pre-linked place) to compose.
  function next() {
    const lat = params.verified_lat ? parseFloat(params.verified_lat) : NaN;
    const lng = params.verified_lng ? parseFloat(params.verified_lng) : NaN;
    const linked =
      isItemGated && !Number.isNaN(lat) && !Number.isNaN(lng) && params.verified_at
        ? {
            exploreItemId: params.exploreItemId!,
            title: params.itemTitle || "This place",
            locationName: params.itemLocationName || null,
            itemKind: (params.itemKind as "event" | "activity" | undefined) ?? null,
            lat,
            lng,
            at: params.verified_at,
          }
        : null;
    setPostDraft({ photos, mode, linked });
    router.push("/post/compose" as any);
  }

  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: colors.background }}>
        <Text style={{ textAlign: "center", fontSize: 18, color: colors.text }}>Camera is not available on web. Please use the mobile app.</Text>
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
        <Text style={{ fontSize: 20, fontWeight: "700", textAlign: "center", color: colors.text }}>Camera Access Required</Text>
        <Text style={{ fontSize: 16, textAlign: "center", color: colors.textSecondary }}>Euda needs camera access to let you capture and share moments.</Text>
        <Pressable onPress={requestPermission} accessibilityLabel="Grant camera permission" accessibilityRole="button" style={{ padding: 16, borderRadius: 12, backgroundColor: Colors.primary, alignItems: "center", marginTop: 8 }}>
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Grant Camera Permission</Text>
        </Pressable>
        <Text style={{ fontSize: 14, textAlign: "center", color: colors.textTertiary, marginTop: 8 }}>If you previously denied access, enable it in Settings → Euda → Camera</Text>
      </View>
    );
  }

  // Preview + proceed once photo(s) are captured.
  if (isComplete) {
    const previewUri = photos[photos.length - 1];
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <Pressable onPress={handleCancel} accessibilityLabel="Cancel" accessibilityRole="button" style={closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
        {/* Preview mirrors the home feed: rounded 3:4; dual shows the BeReal overlay
            (tap to swap, drag the inset, hold to peek) — same component the feed uses. */}
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 16 }}>
          <View style={{ width: "100%", aspectRatio: 3 / 4, borderRadius: 16, overflow: "hidden", backgroundColor: "#111" }}>
            {isDualMode && photos.length === 2 ? (
              <DualCameraPost backUri={photos[0]} frontUri={photos[1]} style={{ flex: 1 }} />
            ) : (
              <Image source={{ uri: previewUri }} style={{ flex: 1 }} resizeMode="cover" />
            )}
          </View>
        </View>
        <View style={{ padding: 24, paddingBottom: Math.max(insets.bottom, 24), backgroundColor: colors.surface, gap: 12, flexDirection: "row" }}>
          <Pressable onPress={retake} accessibilityLabel="Retake photo" accessibilityRole="button" style={{ flex: 1, padding: 16, borderRadius: 14, borderWidth: 2, borderColor: colors.border, alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>Retake</Text>
          </Pressable>
          <Pressable onPress={next} accessibilityLabel="Next" accessibilityRole="button" style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: Colors.primary, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}>
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
        <Pressable onPress={handleCancel} accessibilityLabel="Cancel" accessibilityRole="button" style={closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>

        {/* Pre-linked place pill (item-gated) so it's clear you're posting AT a place. */}
        {isItemGated && !!params.itemTitle && (
          <View style={{ position: "absolute", top: insets.top + 8, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.primary, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 18, maxWidth: "70%" }}>
            <Ionicons name="location" size={14} color="#fff" />
            <Text numberOfLines={1} style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>{params.itemTitle}</Text>
          </View>
        )}

        <View style={{ flex: 1, justifyContent: "flex-end", padding: 24, paddingBottom: Math.max(insets.bottom, 24) + 8, gap: 22 }}>
          {isDualMode && (
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "600", textAlign: "center" }}>
              {needsBackPhoto && "Step 1: Capture back camera"}
              {needsFrontPhoto && "Step 2: Capture front camera"}
            </Text>
          )}

          {/* Shutter — large + a generous tap target, but subtle: a soft purple ring
              and a translucent inner disc (not solid white) so it doesn't over-pop. */}
          <Pressable
            onPress={takePhoto}
            accessibilityLabel="Take photo"
            accessibilityRole="button"
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            style={{ width: 84, height: 84, borderRadius: 42, alignSelf: "center", alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "rgba(124,58,237,0.85)", backgroundColor: "rgba(255,255,255,0.18)" }}
          >
            <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: "rgba(255,255,255,0.45)" }} />
          </Pressable>

          {/* Mode selector — hidden mid dual-capture so it can't reset a half-done shot. */}
          {photos.length === 0 && (
            <View style={{ flexDirection: "row", alignSelf: "center", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 22, padding: 4, gap: 4 }}>
              {MODE_OPTIONS.map((opt) => {
                const active = mode === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => selectMode(opt.key)}
                    accessibilityLabel={`${opt.label} camera mode`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{ paddingVertical: 8, paddingHorizontal: 20, borderRadius: 18, backgroundColor: active ? Colors.primary : "transparent" }}
                  >
                    <Text style={{ color: "#fff", fontWeight: active ? "700" : "500", fontSize: 14 }}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Secondary chip: create an event instead (post-first only). */}
          {photos.length === 0 && !isItemGated && (
            <Pressable
              onPress={() => router.replace("/create-event")}
              accessibilityLabel="Create an event instead"
              accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)" }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="calendar-outline" size={15} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Create an event instead</Text>
            </Pressable>
          )}
        </View>
      </CameraView>
    </View>
  );
}

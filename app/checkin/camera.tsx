import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as Crypto from "expo-crypto";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/hooks/useAuth";
import { useToast } from "../../src/context/ToastContext";
import { uploadImage, deleteImage } from "../../src/utils/storage";
import { supabase } from "../../src/lib/supabase";
import { CAMERA_MODES, MAX_CAPTION_LENGTH, XP_REWARDS } from "../../src/config/constants";
import { useTheme } from "../../src/contexts/ThemeContext";
import { heavyHaptic, successHaptic, errorHaptic } from "../../src/utils/haptics";
import { logInteraction } from "../../src/lib/interactionLogger";
import { captureError } from "../../src/lib/logger";

export default function CameraCapture() {
  const { eventId, exploreItemId, mode, itemKind } = useLocalSearchParams<{
    eventId?: string;
    exploreItemId?: string;
    mode: string;
    itemKind?: string;
  }>();
  const { user, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const { colors } = useTheme();

  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(
    mode === CAMERA_MODES.FRONT ? "front" : "back",
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);

  const cameraRef = useRef<CameraView>(null);

  // Handle back/cancel - confirm if photos have been taken
  const handleCancel = useCallback(() => {
    if (photos.length > 0) {
      Alert.alert(
        "Discard Photo?",
        "You have unsaved photos. Are you sure you want to leave?",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => router.back(),
          },
        ]
      );
    } else {
      router.back();
    }
  }, [photos.length]);

  // Handle Android hardware back button
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (uploading) {
          // Don't allow back during upload
          return true;
        }
        handleCancel();
        return true; // Prevent default back behavior
      };

      const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);
      return () => subscription.remove();
    }, [handleCancel, uploading])
  );

  useEffect(() => {
    if (permission && !permission.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const isDualMode = mode === CAMERA_MODES.DUAL;
  const needsBackPhoto = isDualMode && photos.length === 0;
  const needsFrontPhoto = isDualMode && photos.length === 1;
  const photosComplete = (isDualMode && photos.length === 2) || (!isDualMode && photos.length === 1);
  const isComplete = photosComplete;

  async function takePhoto() {
    if (!cameraRef.current) return;

    try {
      heavyHaptic(); // Haptic feedback on capture
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
      });

      if (!photo) return;

      setPhotos((prev) => [...prev, photo.uri]);

      // For dual mode, switch to front camera after back photo
      if (isDualMode && photos.length === 0) {
        setFacing("front");
      }
    } catch (error) {
      captureError(error, { action: "takePhoto" });
      errorHaptic();
      Alert.alert("Error", "Failed to take photo");
    }
  }

  async function handlePost() {
    if (!user || photos.length === 0) return;

    setUploading(true);

    let uploadedBackPath: string | null = null;
    let uploadedFrontPath: string | null = null;

    try {
      // Create post ID first
      const postId = Crypto.randomUUID();

      // Step 1: Upload back camera photo (or single photo)
      const backPhotoUri = photos[0];
      const { path: backPath, error: backError } = await uploadImage(backPhotoUri, user.id, `${postId}-back`);

      if (backError || !backPath) {
        throw new Error(backError || "Failed to upload photo");
      }

      uploadedBackPath = backPath;

      // Step 2: For dual mode, upload front camera photo
      let frontPath: string | null = null;
      if (isDualMode && photos.length === 2) {
        const frontPhotoUri = photos[1];
        const { path: fPath, error: frontError } = await uploadImage(frontPhotoUri, user.id, `${postId}-front`);

        if (frontError || !fPath) {
          throw new Error(frontError || "Failed to upload front camera photo");
        }

        uploadedFrontPath = fPath;
        frontPath = fPath;
      }

      // Step 3: Insert post record
      // Determine which ID to use: exploreItemId (new flow) or eventId (legacy)
      const postData: any = {
        id: postId,
        user_id: user.id,
        caption: caption.trim() || null,
        photo_path: backPath,
        front_photo_path: frontPath,
        camera_mode: mode as "front" | "back" | "dual",
        latitude: null,
        longitude: null,
      };

      // Set the appropriate foreign key
      if (exploreItemId) {
        postData.explore_item_id = exploreItemId;
        postData.event_id = null;
        console.log("[Post] Creating post for explore_item_id:", exploreItemId);
      } else if (eventId) {
        postData.event_id = eventId;
        postData.explore_item_id = null;
        console.log("[Post] Creating post for legacy event_id:", eventId);
      } else {
        // No event/item - just a standalone post
        postData.event_id = null;
        postData.explore_item_id = null;
        console.log("[Post] Creating standalone post (no event/item)");
      }

      const { error: postError } = await supabase.from("posts").insert(postData);

      if (postError) {
        captureError(postError, { action: "postInsert" });
        throw new Error(postError.message || "Failed to save post");
      }

      console.log("[Post] Post created successfully with data:", {
        explore_item_id: postData.explore_item_id,
        event_id: postData.event_id,
      });

      // Step 4: Update XP and streak progression
      try {
        // Give event bonus if posting to any event/activity
        const hasEventContext = !!(eventId || exploreItemId);
        const xpAmount = hasEventContext ? XP_REWARDS.BASE_POST + XP_REWARDS.EVENT_BONUS : XP_REWARDS.BASE_POST;

        console.log(`[Progression] Calling RPC with xp_amount=${xpAmount}, hasEventContext=${hasEventContext}`);

        const { data: progressionData, error: progressionError } = await (supabase
          .rpc as any)('update_user_progression', {
            p_user_id: user.id,
            p_xp_amount: xpAmount,
            p_post_date: new Date().toISOString(),
          });

        if (progressionError) {
          console.error("[Progression] RPC error:", progressionError);
          // Don't fail the post if progression fails - just log it
        } else if (progressionData && Array.isArray(progressionData) && progressionData.length > 0) {
          const { new_xp, new_streak } = progressionData[0];
          console.log(`[Progression] Updated! XP: ${new_xp}, Streak: ${new_streak}`);

          // Refresh profile to show updated XP/streak immediately
          await refreshProfile();
        }
      } catch (progressionError) {
        console.error("[Progression] Error updating progression:", progressionError);
        // Don't fail the post if progression fails
      }

      // Log check_in_post interaction (fire and forget)
      if (exploreItemId && itemKind) {
        logInteraction({
          userId: user.id,
          exploreItemId,
          eventType: "check_in_post",
          itemKind: itemKind as "event" | "activity",
        });
      }

      // Show success toast and navigate to feed
      successHaptic();
      showToast("Post created!", "success");
      setTimeout(() => {
        router.replace("/(tabs)/feed" as any);
      }, 500);
    } catch (error) {
      captureError(error, { action: "createPost" });

      // Cleanup: Delete uploaded images if post creation failed
      if (uploadedBackPath) {
        await deleteImage(uploadedBackPath);
      }
      if (uploadedFrontPath) {
        await deleteImage(uploadedFrontPath);
      }

      errorHaptic();
      showToast(
        error instanceof Error ? error.message : "Failed to create post",
        "error"
      );
    } finally {
      setUploading(false);
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
            if (isDualMode && photos.length === 2) {
              // Retake from beginning
              setPhotos([]);
              setFacing("back");
            } else if (isDualMode && photos.length === 1) {
              // Retake front photo
              setPhotos((prev) => prev.slice(0, 1));
            } else {
              // Retake single photo
              setPhotos([]);
            }
          },
        },
      ]
    );
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
          Euda needs camera access to let you capture and share moments from events
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{
            padding: 16,
            borderRadius: 12,
            backgroundColor: colors.text,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <Text style={{ color: colors.background, fontSize: 16, fontWeight: "600" }}>
            Grant Camera Permission
          </Text>
        </Pressable>
        <Text style={{ fontSize: 14, textAlign: "center", color: colors.textTertiary, marginTop: 8 }}>
          If you previously denied access, please enable it in Settings → Euda → Camera
        </Text>
      </View>
    );
  }

  // Show preview and caption input
  if (isComplete) {
    // Always show the last photo taken (front camera for dual, the only photo for single)
    const previewUri = photos[photos.length - 1];

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: "#000" }}
        keyboardVerticalOffset={0}
      >
        {/* Back/Cancel button - top left on preview */}
        <Pressable
          onPress={handleCancel}
          disabled={uploading}
          style={{
            position: "absolute",
            top: Platform.OS === "ios" ? 60 : 40,
            left: 16,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 10,
            opacity: uploading ? 0.5 : 1,
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>

        <View style={{ flex: 1, justifyContent: "center" }}>
          <Image
            source={{ uri: previewUri }}
            style={{ width: "100%", aspectRatio: 3 / 4 }}
            resizeMode="contain"
          />
        </View>

        <View style={{ padding: 24, backgroundColor: colors.surface, gap: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 18, fontWeight: "600", color: colors.text }}>Add a caption</Text>
            <Text style={{ fontSize: 14, color: colors.textTertiary }}>
              {caption.length}/{MAX_CAPTION_LENGTH}
            </Text>
          </View>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Optional"
            placeholderTextColor={colors.textTertiary}
            maxLength={MAX_CAPTION_LENGTH}
            style={{
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              fontSize: 16,
              color: colors.text,
              backgroundColor: colors.inputBg,
            }}
          />

          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable
              onPress={retake}
              disabled={uploading}
              style={{
                flex: 1,
                padding: 16,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: colors.border,
                alignItems: "center",
                opacity: uploading ? 0.5 : 1,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>Retake</Text>
            </Pressable>

            <Pressable
              onPress={handlePost}
              disabled={uploading}
              style={{
                flex: 1,
                padding: 16,
                borderRadius: 12,
                backgroundColor: uploading ? colors.textSecondary : colors.text,
                alignItems: "center",
              }}
            >
              {uploading ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text
                  style={{ color: colors.background, fontSize: 16, fontWeight: "600" }}
                >
                  Post
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Show camera view
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing}>
        {/* Back/Cancel button - top left */}
        <Pressable
          onPress={handleCancel}
          style={{
            position: "absolute",
            top: Platform.OS === "ios" ? 60 : 40,
            left: 16,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 10,
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>

        <View style={{ flex: 1, justifyContent: "flex-end", padding: 24 }}>
          {isDualMode && (
            <Text
              style={{
                color: "#fff",
                fontSize: 18,
                fontWeight: "600",
                textAlign: "center",
                marginBottom: 24,
              }}
            >
              {needsBackPhoto && "Step 1: Capture back camera"}
              {needsFrontPhoto && "Step 2: Capture front camera"}
            </Text>
          )}

          <Pressable
            onPress={takePhoto}
            style={{
              width: 70,
              height: 70,
              borderRadius: 35,
              backgroundColor: "#fff",
              alignSelf: "center",
              borderWidth: 4,
              borderColor: "#000",
            }}
          />
        </View>
      </CameraView>
    </View>
  );
}

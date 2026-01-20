import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useAuth } from "../../src/hooks/useAuth";
import { uploadImage, deleteImage } from "../../src/utils/storage";
import { supabase } from "../../src/lib/supabase";
import { CAMERA_MODES, MAX_CAPTION_LENGTH } from "../../src/config/constants";
export default function CameraCapture() {
  const { eventId, mode } = useLocalSearchParams<{
    eventId: string;
    mode: string;
  }>();
  const { user } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(
    mode === CAMERA_MODES.FRONT ? "front" : "back",
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);

  const cameraRef = useRef<CameraView>(null);

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
      console.error("Error taking photo:", error);
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
      const { error: postError } = await supabase.from("posts").insert({
        id: postId,
        user_id: user.id,
        event_id: eventId,
        caption: caption.trim() || null,
        photo_path: backPath,
        front_photo_path: frontPath,
        camera_mode: mode as "front" | "back" | "dual",
        latitude: null,
        longitude: null,
      } as any);

      if (postError) {
        console.error("[Post] DB insert failed:", postError);
        throw new Error(postError.message || "Failed to save post");
      }

      console.log("[Post] Post created successfully");

      // Navigate to feed
      Alert.alert("Success", "Post created!", [
        {
          text: "OK",
          onPress: () => router.replace("/(tabs)/feed" as any),
        },
      ]);
    } catch (error) {
      console.error("[Post] Error:", error);

      // Cleanup: Delete uploaded images if post creation failed
      if (uploadedBackPath) {
        await deleteImage(uploadedBackPath);
      }
      if (uploadedFrontPath) {
        await deleteImage(uploadedFrontPath);
      }

      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to create post",
      );
    } finally {
      setUploading(false);
    }
  }

  function retake() {
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
  }

  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <Text style={{ textAlign: "center", fontSize: 18 }}>
          Camera is not available on web. Please use the mobile app.
        </Text>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 18, textAlign: "center" }}>
          Camera permission is required to post
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{
            padding: 16,
            borderRadius: 12,
            backgroundColor: "#000",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
            Grant Permission
          </Text>
        </Pressable>
      </View>
    );
  }

  // Show preview and caption input
  if (isComplete) {
    // Always show the last photo taken (front camera for dual, the only photo for single)
    const previewUri = photos[photos.length - 1];

    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Image
            source={{ uri: previewUri }}
            style={{ width: "100%", aspectRatio: 3 / 4 }}
            resizeMode="contain"
          />
        </View>

        <View style={{ padding: 24, backgroundColor: "#fff", gap: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: "600" }}>Add a caption</Text>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Optional (max 100 characters)"
            maxLength={MAX_CAPTION_LENGTH}
            style={{
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              fontSize: 16,
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
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600" }}>Retake</Text>
            </Pressable>

            <Pressable
              onPress={handlePost}
              disabled={uploading}
              style={{
                flex: 1,
                padding: 16,
                borderRadius: 12,
                backgroundColor: "#000",
                alignItems: "center",
              }}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text
                  style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}
                >
                  Post
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // Show camera view
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing={facing}>
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

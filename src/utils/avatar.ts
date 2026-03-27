import { supabase } from "../lib/supabase";
import * as ImagePicker from "expo-image-picker";

const AVATARS_BUCKET = "avatars";

/**
 * Pick an image from library and upload as avatar
 */
export async function pickAndUploadAvatar(
  userId: string
): Promise<{ avatarUrl: string | null; error: string | null }> {
  try {
    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return { avatarUrl: null, error: "Photo library permission required" };
    }

    // Pick image
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled) {
      return { avatarUrl: null, error: "Cancelled" };
    }

    const uri = result.assets[0].uri;

    // Upload to storage
    return await uploadAvatar(uri, userId);
  } catch (error) {
    console.error("[Avatar] Pick error:", error);
    return {
      avatarUrl: null,
      error: error instanceof Error ? error.message : "Failed to pick image",
    };
  }
}

/**
 * Upload avatar image to Supabase Storage
 */
export async function uploadAvatar(
  uri: string,
  userId: string
): Promise<{ avatarUrl: string | null; error: string | null }> {
  try {
    // Fetch image and convert to ArrayBuffer
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();

    // Storage path: userId/avatar.jpg
    const filePath = `${userId}/avatar.jpg`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(filePath, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: true, // Allow overwrite
      });

    if (error) {
      console.error("[Avatar] Upload failed:", error.message);
      return { avatarUrl: null, error: error.message };
    }

    // Get public URL — append cache-bust timestamp so React Native's image
    // cache doesn't serve the previous avatar after an upload to the same path.
    const { data: urlData } = supabase.storage
      .from(AVATARS_BUCKET)
      .getPublicUrl(data.path);

    return { avatarUrl: `${urlData.publicUrl}?t=${Date.now()}`, error: null };
  } catch (error) {
    console.error("[Avatar] Upload exception:", error);
    return {
      avatarUrl: null,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Get avatar URL from storage path
 */
export function getAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  // If it's already a full URL, return it
  if (avatarUrl.startsWith("http")) return avatarUrl;
  // Otherwise, construct the public URL
  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(avatarUrl);
  return data.publicUrl;
}

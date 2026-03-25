import { supabase } from "../lib/supabase";

const BUCKET_NAME = "posts";

// In-memory cache for signed URLs
const signedUrlCache = new Map<
  string,
  { url: string; expiresAt: number }
>();

/**
 * Upload image to Supabase Storage using ArrayBuffer (Expo iOS compatible)
 * Returns storage path on success
 */
export async function uploadImage(
  uri: string,
  userId: string,
  postId: string,
): Promise<{ path: string | null; error: string | null }> {
  try {
    // Fetch image and convert to ArrayBuffer
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();

    // Deterministic storage path: userId/postId.jpg
    const filePath = `${userId}/${postId}.jpg`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: true, // Allow overwrite for retries
      });

    if (error) {
      console.error("[Upload] Failed:", error.message);
      return { path: null, error: error.message };
    }

    return { path: data.path, error: null };
  } catch (error) {
    console.error("[Upload] Exception:", error);
    return {
      path: null,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Get image URL for display
 * Uses public URL - bucket must be set to public
 */
export async function getPostImageUrl(
  path: string,
): Promise<string | null> {
  try {
    return getImageUrl(path);
  } catch (error) {
    console.error("[URL] Exception:", error);
    return null;
  }
}

/**
 * Get public URL for image in storage
 * Only use this if you know the bucket is public
 */
export function getImageUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload an event cover image to Supabase Storage.
 * Returns the public URL on success, null on failure.
 */
export async function uploadEventImage(
  uri: string,
  userId: string,
  eventId: string,
): Promise<string | null> {
  try {
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    const path = `events/${userId}/${eventId}.jpg`;
    const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(path, arrayBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) {
      console.error("[UploadEventImage] Failed:", error.message);
      return null;
    }
    return getImageUrl(data.path);
  } catch (error) {
    console.error("[UploadEventImage] Exception:", error);
    return null;
  }
}

/**
 * Delete image from storage
 * Use this if post creation fails after upload
 */
export async function deleteImage(
  path: string,
): Promise<{ success: boolean; error: string | null }> {
  try {
    console.log("[Delete] Removing image:", path);

    const { error } = await supabase.storage.from(BUCKET_NAME).remove([path]);

    if (error) {
      console.error("[Delete] Error:", error);
      return { success: false, error: error.message };
    }

    // Clear from cache
    signedUrlCache.delete(path);

    console.log("[Delete] Success");
    return { success: true, error: null };
  } catch (error) {
    console.error("[Delete] Exception:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Delete failed",
    };
  }
}

/**
 * Clear expired entries from signed URL cache
 * Call this periodically to prevent memory leaks
 */
export function clearExpiredUrlCache(): void {
  const now = Date.now();
  for (const [path, cached] of signedUrlCache.entries()) {
    if (cached.expiresAt <= now) {
      signedUrlCache.delete(path);
    }
  }
}

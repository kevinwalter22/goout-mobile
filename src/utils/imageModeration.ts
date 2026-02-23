/**
 * Image Moderation — fire-and-forget client helper.
 *
 * Calls the moderate-image edge function after a successful upload.
 * Never blocks UI, never throws. Errors are logged in __DEV__ only.
 *
 * Pattern matches src/lib/interactionLogger.ts — synchronous function
 * that starts a promise chain and silently catches errors.
 */

import { supabase } from "../lib/supabase";

interface ModerateImageParams {
  bucket: "posts" | "avatars";
  path: string;
}

/**
 * Request server-side image moderation for an uploaded file.
 * Fire-and-forget: returns void immediately, never throws.
 */
export function requestImageModeration(params: ModerateImageParams): void {
  const { bucket, path } = params;

  if (!bucket || !path) {
    if (__DEV__) {
      console.log("[imageModeration] Skipped: missing bucket or path");
    }
    return;
  }

  supabase.functions
    .invoke("moderate-image", {
      body: { bucket, path },
    })
    .then(({ error }) => {
      if (error && __DEV__) {
        console.log("[imageModeration] Edge function error:", error.message);
      }
    })
    .catch((err: unknown) => {
      if (__DEV__) {
        console.log("[imageModeration] Network error:", err);
      }
    });
}

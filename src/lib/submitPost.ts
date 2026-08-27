// The unified post insert (Phase 3 · T5): rate-limit → upload → posts.insert →
// moderation → XP. Both posting routes flow through here now — the post-first FAB
// route and the item-gated route (event / postable pin → strict check-in → the same
// /post/camera → /post/compose). The old /checkin/camera handlePost it was extracted
// from has been retired. Feeds the posts-table shape in §3 of docs/phase3_post_first.md.
//
// Every post-first post carries the poster's real post-time coords in
// verified_lat/lng/at (required by migration 173 for standalone "My Location"
// posts, and by 137 for linked posts). Linked posts also set verified_at_event.
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";
import { uploadImage, deleteImage } from "../utils/storage";
import { requestImageModeration } from "../utils/imageModeration";
import { checkBeforeSubmit } from "./moderation/textModeration";
import { logInteraction } from "./interactionLogger";
import { captureError } from "./logger";
import { XP_REWARDS, type CameraMode } from "../config/constants";

export type SubmitPostInput = {
  userId: string;
  /** [back] for single/front mode, [back, front] for dual. */
  photos: string[];
  mode: CameraMode;
  caption: string;
  /** Poster's real post-time coords — REQUIRED on every post-first post. */
  verifiedLat: number;
  verifiedLng: number;
  verifiedAt: string;
  /** The linked place's id when in range; null for a "My Location" post. */
  exploreItemId: string | null;
  /** kind of the linked item (for the interaction log); ignored when My Location. */
  itemKind?: "event" | "activity" | null;
};

export type SubmitPostResult = { postId: string | null; error: string | null };

export async function submitPost(input: SubmitPostInput): Promise<SubmitPostResult> {
  if (!input.photos.length) {
    return { postId: null, error: "No photo to post" };
  }

  // Rate limit — same RPC the check-in path uses. Don't hard-block on RPC failure.
  try {
    const { error: rlError } = await supabase.rpc("check_post_rate_limit");
    if (rlError) {
      return { postId: null, error: "You're posting too quickly. Please try again later." };
    }
  } catch {
    // ignore transient rate-limit RPC failures
  }

  // Caption moderation (pre-submit).
  const trimmed = input.caption.trim();
  if (trimmed) {
    const mod = checkBeforeSubmit(trimmed, "caption");
    if (!mod.allowed) {
      return { postId: null, error: mod.reason };
    }
  }

  const postId = Crypto.randomUUID();
  let uploadedBack: string | null = null;
  let uploadedFront: string | null = null;

  try {
    // Upload back / single photo.
    const { path: backPath, error: backErr } = await uploadImage(
      input.photos[0],
      input.userId,
      `${postId}-back`,
    );
    if (backErr || !backPath) throw new Error(backErr || "Failed to upload photo");
    uploadedBack = backPath;

    // Upload front photo for dual mode.
    let frontPath: string | null = null;
    if (input.mode === "dual" && input.photos[1]) {
      const { path: fPath, error: fErr } = await uploadImage(
        input.photos[1],
        input.userId,
        `${postId}-front`,
      );
      if (fErr || !fPath) throw new Error(fErr || "Failed to upload front camera photo");
      uploadedFront = fPath;
      frontPath = fPath;
    }

    // Build the posts row — same shape as camera.tsx handlePost.
    const postData: any = {
      id: postId,
      user_id: input.userId,
      caption: trimmed || null,
      photo_path: backPath,
      front_photo_path: frontPath,
      camera_mode: input.mode,
      // Legacy columns kept null; authoritative coords live in verified_lat/lng.
      latitude: null,
      longitude: null,
      // Post-time coords on EVERY post-first post (My Location + linked).
      verified_lat: input.verifiedLat,
      verified_lng: input.verifiedLng,
      verified_at: input.verifiedAt,
      event_id: null,
    };

    if (input.exploreItemId) {
      // Linked, in range → the geo+time invariant's verified-at-the-place shape.
      postData.explore_item_id = input.exploreItemId;
      postData.verified_at_event = true;
    } else {
      // My Location — coords only; migration 173 requires them, no verified_at_event.
      postData.explore_item_id = null;
    }

    const { error: postError } = await supabase.from("posts").insert(postData);
    if (postError) {
      captureError(postError, { action: "postFirstInsert" });
      throw new Error(postError.message || "Failed to save post");
    }

    // Fire-and-forget image moderation.
    requestImageModeration({ bucket: "posts", path: backPath });
    if (frontPath) requestImageModeration({ bucket: "posts", path: frontPath });

    // XP / streak — don't fail the post if this errors.
    try {
      const hasEventContext = !!input.exploreItemId;
      const xpAmount = hasEventContext
        ? XP_REWARDS.BASE_POST + XP_REWARDS.EVENT_BONUS
        : XP_REWARDS.BASE_POST;
      await (supabase.rpc as any)("update_user_progression", {
        p_user_id: input.userId,
        p_xp_amount: xpAmount,
        p_post_date: new Date().toISOString(),
      });
    } catch {
      // progression is best-effort
    }

    // Interaction log for a linked post (fire and forget).
    if (input.exploreItemId && input.itemKind) {
      logInteraction({
        userId: input.userId,
        exploreItemId: input.exploreItemId,
        eventType: "check_in_post",
        itemKind: input.itemKind,
      });
    }

    return { postId, error: null };
  } catch (error) {
    captureError(error, { action: "submitPost" });
    // Roll back uploaded images so a failed insert doesn't orphan storage.
    if (uploadedBack) await deleteImage(uploadedBack);
    if (uploadedFront) await deleteImage(uploadedFront);
    return {
      postId: null,
      error: error instanceof Error ? error.message : "Failed to create post",
    };
  }
}

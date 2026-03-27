/**
 * moderate-image Edge Function
 *
 * Called fire-and-forget by the client after uploading a post photo or avatar.
 * Downloads the image from Supabase Storage, runs it through the configured
 * image moderation provider, and applies the result to the DB.
 *
 * POST body:
 *   { bucket: "posts" | "avatars", path: string }
 *
 * Returns:
 *   { categories, severity, action, provider_meta }
 *
 * Auth: Requires a valid user JWT. Ownership enforced (path must start with userId/).
 * DB writes: Uses service_role client to update moderation_status and insert flags.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth-guard.ts";
import {
  createImageModerationProvider,
  type ImageModerationResult,
} from "./provider.ts";

const VALID_BUCKETS = new Set(["posts", "avatars"]);

Deno.serve(async (req) => {
  // ── CORS ────────────────────────────────────────────────
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  const corsHeaders = getCorsHeaders(req);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Auth ────────────────────────────────────────────────
  const auth = await requireUser(req);
  if (auth.error || !auth.user) {
    return json({ error: auth.error ?? "Unauthorized" }, 401);
  }
  const userId = auth.user.id;

  // ── Parse body ──────────────────────────────────────────
  let bucket: string;
  let path: string;
  try {
    const body = await req.json();
    bucket = body.bucket;
    path = body.path;
    if (!bucket || !path) throw new Error("missing fields");
  } catch {
    return json({ error: "Invalid body: { bucket, path } required" }, 400);
  }

  if (!VALID_BUCKETS.has(bucket)) {
    return json({ error: "Invalid bucket" }, 400);
  }

  // ── Ownership check ─────────────────────────────────────
  const isOwned =
    path.startsWith(`${userId}/`) ||
    path.startsWith(`events/${userId}/`);
  if (!isOwned) {
    return json({ error: "Forbidden: not your file" }, 403);
  }

  try {
    // ── Service-role client ─────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── Feature flag check ──────────────────────────────────
    const { data: flagRow } = await adminClient
      .from("feature_flags")
      .select("is_enabled")
      .eq("flag_name", "image_moderation_enabled")
      .maybeSingle();

    if (!flagRow?.is_enabled) {
      return json({
        categories: [],
        severity: 0,
        action: "allow",
        provider_meta: { skipped: "flag_disabled" },
      });
    }

    // ── Dedup check (posts only) ────────────────────────────
    if (bucket === "posts") {
      const postId = extractPostId(path);
      if (postId) {
        const { data: post } = await adminClient
          .from("posts")
          .select("moderated_at")
          .eq("id", postId)
          .maybeSingle();

        if (post?.moderated_at) {
          return json({
            categories: [],
            severity: 0,
            action: "allow",
            provider_meta: { skipped: "already_moderated" },
          });
        }
      }
    }
    // Avatars: always re-moderate (path is overwritten on each upload)

    // ── Download image ──────────────────────────────────────
    const { data: fileData, error: dlError } = await adminClient.storage
      .from(bucket)
      .download(path);

    if (dlError || !fileData) {
      console.error("[moderate-image] Download failed:", dlError);
      return json({ error: "Failed to download image" }, 500);
    }

    const imageBytes = new Uint8Array(await fileData.arrayBuffer());
    const contentType = fileData.type || "image/jpeg";

    // ── Run provider ────────────────────────────────────────
    const provider = createImageModerationProvider();
    const result = await provider.moderate(imageBytes, contentType);

    console.log(
      `[moderate-image] ${provider.name}: ${bucket}/${path} => ` +
        `action=${result.action}, severity=${result.severity}`,
    );

    // ── Apply result to DB ──────────────────────────────────
    if (bucket === "posts") {
      if (path.startsWith("events/")) {
        await applyEventResult(adminClient, path, result, provider.name);
      } else {
        await applyPostResult(adminClient, path, result, provider.name);
      }
    } else if (bucket === "avatars") {
      await applyAvatarResult(adminClient, userId, result, provider.name);
    }

    return json(result);
  } catch (err) {
    console.error("[moderate-image] Error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

// ── Helpers ─────────────────────────────────────────────────

/** Extract post UUID from a storage path like `{userId}/{postId}-back.jpg` */
function extractPostId(path: string): string | null {
  const fileName = path.split("/").pop() ?? "";
  const match = fileName.match(/^([a-f0-9-]+)-(back|front)\.jpg$/);
  return match ? match[1] : null;
}

/** Map provider action to DB content_moderation_status enum */
function toDbStatus(action: string): string {
  switch (action) {
    case "allow":
      return "approved";
    case "quarantine":
    case "blurred":
      return "quarantined";
    case "blocked":
      return "blocked";
    default:
      return "approved";
  }
}

async function applyPostResult(
  client: ReturnType<typeof createClient>,
  path: string,
  result: ImageModerationResult,
  providerName: string,
) {
  const postId = extractPostId(path);
  if (!postId) return;

  const now = new Date().toISOString();

  if (result.action !== "allow") {
    // Flag the post — only escalate, never downgrade
    await (client as any)
      .from("posts")
      .update({
        moderation_status: toDbStatus(result.action),
        moderation_reason: `auto_image: ${result.categories.join(", ") || "flagged"}`,
        moderated_at: now,
      })
      .eq("id", postId)
      .eq("moderation_status", "approved"); // prevent downgrading a flagged post

    // Insert audit flag
    await (client as any).from("moderation_flags").insert({
      target_type: "post",
      target_id: postId,
      source: "auto_image",
      category: result.categories[0] ?? "other",
      severity: result.severity,
      action: result.action,
      reason: `Image flagged by ${providerName}`,
      metadata: result.provider_meta,
      status: result.action === "blocked" ? "resolved" : "open",
    });
  } else {
    // Clean — mark as moderated for dedup
    await (client as any)
      .from("posts")
      .update({ moderated_at: now })
      .eq("id", postId);
  }
}

/** Extract event UUID from a storage path like `events/{userId}/{eventId}.jpg` */
function extractEventId(path: string): string | null {
  const parts = path.split("/");
  if (parts[0] !== "events" || parts.length !== 3) return null;
  return parts[2].replace(/\.jpg$/, "");
}

async function applyEventResult(
  client: ReturnType<typeof createClient>,
  path: string,
  result: ImageModerationResult,
  providerName: string,
) {
  const eventId = extractEventId(path);
  if (!eventId) return;

  if (result.action !== "allow") {
    await (client as any)
      .from("explore_items")
      .update({ review_status: "quarantined" })
      .eq("id", eventId)
      .eq("review_status", "auto_approved"); // only escalate, never downgrade

    await (client as any).from("moderation_flags").insert({
      target_type: "explore_item",
      target_id: eventId,
      source: "auto_image",
      category: result.categories[0] ?? "other",
      severity: result.severity,
      action: result.action,
      reason: `Image flagged by ${providerName}`,
      metadata: result.provider_meta,
      status: result.action === "blocked" ? "resolved" : "open",
    });
  }
  // Clean images: no update needed (review_status stays auto_approved)
}

async function applyAvatarResult(
  client: ReturnType<typeof createClient>,
  userId: string,
  result: ImageModerationResult,
  providerName: string,
) {
  const now = new Date().toISOString();

  if (result.action !== "allow") {
    await (client as any)
      .from("profiles")
      .update({
        avatar_moderation_status: toDbStatus(result.action),
        avatar_moderation_reason: `auto_image: ${result.categories.join(", ") || "flagged"}`,
        avatar_moderated_at: now,
      })
      .eq("id", userId);

    await (client as any).from("moderation_flags").insert({
      target_type: "profile",
      target_id: userId,
      source: "auto_image",
      category: result.categories[0] ?? "other",
      severity: result.severity,
      action: result.action,
      reason: `Avatar flagged by ${providerName}`,
      metadata: { ...result.provider_meta, target: "avatar" },
      status: result.action === "blocked" ? "resolved" : "open",
    });
  } else {
    // Clean — mark as moderated
    await (client as any)
      .from("profiles")
      .update({
        avatar_moderation_status: "approved",
        avatar_moderated_at: now,
      })
      .eq("id", userId);
  }
}

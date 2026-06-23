/**
 * send-notification
 *
 * Sends push notifications for social events:
 *   - friend_request   : someone sent you a friend request
 *   - friend_accepted  : someone accepted your friend request
 *   - post_reaction    : someone reacted to your post
 *   - post_comment     : someone commented on your post
 *
 * Friend types: called by the client after friendship actions (fire-and-forget).
 * Post types:   called by the client after reaction/comment writes.
 *
 * Requires authenticated user JWT.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth-guard.ts";
import {
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "../_shared/cors.ts";

type NotificationType =
  | "friend_request"
  | "friend_accepted"
  | "post_reaction"
  | "post_comment";

// ── Request body shapes ────────────────────────────────────────────────────

interface FriendRequestBody {
  type: "friend_request" | "friend_accepted";
  recipient_id: string;
}

interface PostNotificationBody {
  type: "post_reaction" | "post_comment";
  post_id: string;
  actor_id: string;
  comment_id?: string; // required for post_comment, used as dedup reference_id
}

type RequestBody = FriendRequestBody | PostNotificationBody;

// ── Notification copy ──────────────────────────────────────────────────────

const NOTIFICATION_MESSAGES: Record<
  NotificationType,
  { title: string; body: (actor: string) => string }
> = {
  friend_request: {
    title: "Friend Request",
    body: (actor) => `${actor} wants to be your friend`,
  },
  friend_accepted: {
    title: "Friend Accepted",
    body: (actor) => `${actor} accepted your friend request`,
  },
  post_reaction: {
    title: "New Reaction",
    body: (actor) => `${actor} reacted to your post`,
  },
  post_comment: {
    title: "New Comment",
    body: (actor) => `${actor} commented on your post`,
  },
};

// ── Preference column by notification type ────────────────────────────────
const PREFERENCE_COLUMN: Record<NotificationType, string> = {
  friend_request: "notify_friend_requests",
  friend_accepted: "notify_friend_requests",
  post_reaction: "notify_post_reactions",
  post_comment: "notify_post_comments",
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function sendExpoPush(
  tokens: { token: string }[],
  type: NotificationType,
  actorName: string,
  referenceId: string,
  supabase: ReturnType<typeof createClient>
): Promise<number> {
  const msgConfig = NOTIFICATION_MESSAGES[type];
  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default" as const,
    title: msgConfig.title,
    body: msgConfig.body(actorName),
    data: { type, reference_id: referenceId },
  }));

  const pushResponse = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  const pushResult = await pushResponse.json();

  // Remove any tokens the device no longer considers valid
  if (pushResult.data) {
    for (let i = 0; i < pushResult.data.length; i++) {
      const ticket = pushResult.data[i];
      if (
        ticket.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered"
      ) {
        await supabase
          .from("push_tokens")
          .delete()
          .eq("token", tokens[i].token);
      }
    }
  }

  return messages.length;
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightIfNeeded(req);
  if (corsResponse) return corsResponse;
  const headers = getCorsHeaders(req);

  const { user, error: authError } = await requireUser(req);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: authError }), {
      status: 401,
      headers,
    });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const { type } = body;

    if (!type || !NOTIFICATION_MESSAGES[type]) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing type" }),
        { status: 400, headers }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (type === "post_reaction" || type === "post_comment") {
      return await handlePostNotification(
        body as PostNotificationBody,
        user,
        supabase,
        headers
      );
    } else {
      return await handleFriendNotification(
        body as FriendRequestBody,
        user,
        supabase,
        headers
      );
    }
  } catch (err) {
    console.error("send-notification error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers,
    });
  }
});

// ── Friend notification handler (original logic, unchanged) ───────────────

async function handleFriendNotification(
  body: FriendRequestBody,
  user: { id: string },
  supabase: ReturnType<typeof createClient>,
  headers: Record<string, string>
): Promise<Response> {
  const { type, recipient_id } = body;

  if (!recipient_id) {
    return new Response(
      JSON.stringify({ error: "Missing recipient_id" }),
      { status: 400, headers }
    );
  }

  // 1. Check recipient preference
  const prefCol = PREFERENCE_COLUMN[type];
  const { data: recipientProfile } = await supabase
    .from("profiles")
    .select(prefCol)
    .eq("id", recipient_id)
    .single();

  if (!recipientProfile?.[prefCol]) {
    return new Response(
      JSON.stringify({ skipped: "preferences_off" }),
      { status: 200, headers }
    );
  }

  // 2. Dedup: (recipient, type, sender_id)
  const dedupRefId = user.id;
  const { data: existing } = await supabase
    .from("notifications_sent")
    .select("id")
    .eq("user_id", recipient_id)
    .eq("notification_type", type)
    .eq("reference_id", dedupRefId)
    .maybeSingle();

  if (existing) {
    return new Response(
      JSON.stringify({ skipped: "already_sent" }),
      { status: 200, headers }
    );
  }

  // 3. Get sender username
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();
  const actorName = senderProfile?.username || "Someone";

  // 4. Get recipient push tokens
  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", recipient_id);

  if (!tokens || tokens.length === 0) {
    return new Response(
      JSON.stringify({ skipped: "no_tokens" }),
      { status: 200, headers }
    );
  }

  // 5. Send — for friend_accepted the tap-target is the sender's profile
  const referenceId =
    type === "friend_accepted" ? user.id : recipient_id;

  const sent = await sendExpoPush(
    tokens,
    type,
    actorName,
    referenceId,
    supabase
  );

  // 6. Record dedup entry
  await supabase.from("notifications_sent").insert({
    user_id: recipient_id,
    notification_type: type,
    reference_id: dedupRefId,
  });

  return new Response(JSON.stringify({ sent }), { status: 200, headers });
}

// ── Post notification handler ─────────────────────────────────────────────

async function handlePostNotification(
  body: PostNotificationBody,
  user: { id: string },
  supabase: ReturnType<typeof createClient>,
  headers: Record<string, string>
): Promise<Response> {
  const { type, post_id, actor_id, comment_id } = body;

  if (!post_id || !actor_id) {
    return new Response(
      JSON.stringify({ error: "Missing post_id or actor_id" }),
      { status: 400, headers }
    );
  }
  if (type === "post_comment" && !comment_id) {
    return new Response(
      JSON.stringify({ error: "Missing comment_id for post_comment" }),
      { status: 400, headers }
    );
  }

  // 1. Look up the post to find the recipient (post author)
  const { data: post } = await supabase
    .from("posts")
    .select("user_id")
    .eq("id", post_id)
    .single();

  if (!post?.user_id) {
    return new Response(
      JSON.stringify({ skipped: "post_not_found" }),
      { status: 200, headers }
    );
  }

  const recipient_id: string = post.user_id;

  // 2. Never notify someone about their own activity
  if (actor_id === recipient_id) {
    return new Response(
      JSON.stringify({ skipped: "self_action" }),
      { status: 200, headers }
    );
  }

  // 3. Check recipient preference
  const prefCol = PREFERENCE_COLUMN[type];
  const { data: recipientProfile } = await supabase
    .from("profiles")
    .select(prefCol)
    .eq("id", recipient_id)
    .single();

  if (!recipientProfile?.[prefCol]) {
    return new Response(
      JSON.stringify({ skipped: "preferences_off" }),
      { status: 200, headers }
    );
  }

  // 4. Dedup:
  //    post_reaction → reference_id = post_id
  //      One notification per post. First reactor triggers it; subsequent
  //      reactions are silent (prevents notification spam on popular posts).
  //    post_comment  → reference_id = comment_id
  //      Each unique comment notifies once; prevents double-send on retries.
  const dedupRefId = type === "post_comment" ? comment_id! : post_id;

  const { data: existing } = await supabase
    .from("notifications_sent")
    .select("id")
    .eq("user_id", recipient_id)
    .eq("notification_type", type)
    .eq("reference_id", dedupRefId)
    .maybeSingle();

  if (existing) {
    return new Response(
      JSON.stringify({ skipped: "already_sent" }),
      { status: 200, headers }
    );
  }

  // 5. Get actor username
  const { data: actorProfile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", actor_id)
    .single();
  const actorName = actorProfile?.username || "Someone";

  // 6. Get recipient push tokens
  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", recipient_id);

  if (!tokens || tokens.length === 0) {
    return new Response(
      JSON.stringify({ skipped: "no_tokens" }),
      { status: 200, headers }
    );
  }

  // 7. Send — reference_id in the data payload is post_id so the client
  //    can route to the feed (or a per-post screen in a future release).
  const sent = await sendExpoPush(
    tokens,
    type,
    actorName,
    post_id,
    supabase
  );

  // 8. Record dedup entry
  await supabase.from("notifications_sent").insert({
    user_id: recipient_id,
    notification_type: type,
    reference_id: dedupRefId,
  });

  return new Response(JSON.stringify({ sent }), { status: 200, headers });
}

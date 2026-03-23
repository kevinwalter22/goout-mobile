/**
 * send-notification
 *
 * Sends push notifications for friend request / accept events.
 * Called by the client after friendship actions (fire-and-forget).
 *
 * Requires authenticated user JWT.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth-guard.ts";
import {
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "../_shared/cors.ts";

type NotificationType = "friend_request" | "friend_accepted";

interface RequestBody {
  type: NotificationType;
  recipient_id: string;
}

const NOTIFICATION_MESSAGES: Record<
  NotificationType,
  { title: string; body: (sender: string) => string }
> = {
  friend_request: {
    title: "Friend Request",
    body: (sender) => `${sender} wants to be your friend`,
  },
  friend_accepted: {
    title: "Friend Accepted",
    body: (sender) => `${sender} accepted your friend request`,
  },
};

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightIfNeeded(req);
  if (corsResponse) return corsResponse;
  const headers = getCorsHeaders(req);

  // Authenticate the caller
  const { user, error: authError } = await requireUser(req);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: authError }), {
      status: 401,
      headers,
    });
  }

  try {
    const { type, recipient_id } = (await req.json()) as RequestBody;

    if (!type || !recipient_id) {
      return new Response(
        JSON.stringify({ error: "Missing type or recipient_id" }),
        { status: 400, headers }
      );
    }

    if (!NOTIFICATION_MESSAGES[type]) {
      return new Response(JSON.stringify({ error: "Invalid type" }), {
        status: 400,
        headers,
      });
    }

    // Use service-role client for server-side operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Check recipient's notification preferences
    const { data: recipientProfile } = await supabase
      .from("profiles")
      .select("notify_friend_requests")
      .eq("id", recipient_id)
      .single();

    if (!recipientProfile?.notify_friend_requests) {
      return new Response(JSON.stringify({ skipped: "preferences_off" }), {
        status: 200,
        headers,
      });
    }

    // 2. Check deduplication — use sender+recipient as reference
    const dedupRefId = user.id; // The sender is the unique reference per recipient+type
    const { data: existing } = await supabase
      .from("notifications_sent")
      .select("id")
      .eq("user_id", recipient_id)
      .eq("notification_type", type)
      .eq("reference_id", dedupRefId)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ skipped: "already_sent" }), {
        status: 200,
        headers,
      });
    }

    // 3. Get sender's username for the notification message
    const { data: senderProfile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    const senderName = senderProfile?.username || "Someone";

    // 4. Get recipient's push tokens
    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", recipient_id);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: "no_tokens" }), {
        status: 200,
        headers,
      });
    }

    // 5. Build messages for Expo Push API
    const msgConfig = NOTIFICATION_MESSAGES[type];
    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      sound: "default" as const,
      title: msgConfig.title,
      body: msgConfig.body(senderName),
      data: {
        type,
        reference_id:
          type === "friend_accepted" ? user.id : recipient_id,
      },
    }));

    // 6. Send via Expo Push API
    const pushResponse = await fetch(
      "https://exp.host/--/api/v2/push/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      }
    );

    const pushResult = await pushResponse.json();

    // 7. Handle invalid tokens — remove them
    if (pushResult.data) {
      const invalidIndices: number[] = [];
      for (let i = 0; i < pushResult.data.length; i++) {
        const ticket = pushResult.data[i];
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          invalidIndices.push(i);
        }
      }
      // Delete invalid tokens
      for (const idx of invalidIndices) {
        await supabase
          .from("push_tokens")
          .delete()
          .eq("token", tokens[idx].token);
      }
    }

    // 8. Record dedup entry
    await supabase.from("notifications_sent").insert({
      user_id: recipient_id,
      notification_type: type,
      reference_id: dedupRefId,
    });

    return new Response(JSON.stringify({ sent: messages.length }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("send-notification error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers }
    );
  }
});

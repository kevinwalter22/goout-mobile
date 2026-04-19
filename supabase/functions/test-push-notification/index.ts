/**
 * test-push-notification
 *
 * Sends a test push notification to the authenticated user's registered
 * device tokens. Use this to verify the full push pipeline end-to-end
 * without needing to trigger a real friend request or event RSVP.
 *
 * Usage (from app or curl):
 *   POST /functions/v1/test-push-notification
 *   Authorization: Bearer <user-jwt>
 *   Body: {} (optional: { "token": "ExponentPushToken[...]" } to target one token)
 *
 * Returns:
 *   { tokens_found: number, expo_response: <raw Expo API response> }
 *   or { error: "no_tokens" } if no tokens registered
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth-guard.ts";
import {
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightIfNeeded(req);
  if (corsResponse) return corsResponse;
  const headers = {
    ...getCorsHeaders(req),
    "Content-Type": "application/json",
  };

  // Require authenticated user
  const { user, error: authError } = await requireUser(req);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: authError || "Unauthorized" }), {
      status: 401,
      headers,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Optional: caller can pass a specific token to test
    let specificToken: string | null = null;
    try {
      const body = await req.json();
      specificToken = body?.token ?? null;
    } catch {
      // No body or invalid JSON — that's fine
    }

    // Fetch user's registered tokens
    const { data: tokenRows, error: tokenErr } = await supabase
      .from("push_tokens")
      .select("token, platform")
      .eq("user_id", user.id);

    if (tokenErr) {
      console.error("[test-push-notification] DB error:", tokenErr.message);
      return new Response(
        JSON.stringify({ error: "Failed to fetch tokens", details: tokenErr.message }),
        { status: 500, headers }
      );
    }

    const tokens = specificToken
      ? [{ token: specificToken, platform: "unknown" }]
      : (tokenRows ?? []);

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({
          error: "no_tokens",
          message:
            "No push tokens found for this user. Open the app, grant notification permission, and try again.",
        }),
        { status: 200, headers }
      );
    }

    // Build Expo push messages
    const messages = tokens.map((t: { token: string; platform: string }) => ({
      to: t.token,
      sound: "default" as const,
      title: "Test Notification",
      body: "Push notifications are working correctly.",
      data: {
        type: "test",
        timestamp: new Date().toISOString(),
      },
    }));

    // Send via Expo Push API
    let expoResult: any;
    try {
      const pushResponse = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });
      expoResult = await pushResponse.json();
    } catch (expoErr) {
      console.error("[test-push-notification] Expo API error:", expoErr);
      return new Response(
        JSON.stringify({
          error: "Expo push API unreachable",
          details: expoErr instanceof Error ? expoErr.message : String(expoErr),
        }),
        { status: 500, headers }
      );
    }

    // Check for invalid tokens and clean up
    if (expoResult.data) {
      for (let i = 0; i < expoResult.data.length; i++) {
        const ticket = expoResult.data[i];
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

    return new Response(
      JSON.stringify({
        tokens_found: tokens.length,
        tokens: tokens.map((t: { token: string; platform: string }) => ({
          token: t.token.slice(0, 30) + "...", // truncate for safety
          platform: t.platform,
        })),
        expo_response: expoResult,
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("[test-push-notification] Unhandled error:", err);
    return new Response(
      JSON.stringify({
        error: "Internal error",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers }
    );
  }
});

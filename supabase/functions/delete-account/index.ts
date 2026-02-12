/**
 * Delete Account Edge Function
 *
 * Permanently deletes a user's account and all associated data.
 * Required for Apple App Store compliance.
 *
 * Flow:
 * 1. Verify the caller's JWT
 * 2. Delete user's storage files (posts, avatars)
 * 3. Delete the auth user (all DB rows cascade via ON DELETE CASCADE)
 *
 * Usage:
 *   POST /delete-account
 *   Headers: Authorization: Bearer <user-jwt>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Create a client with the user's JWT to verify identity
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the user's JWT
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired session" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userId = user.id;

    // Use service role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Delete user's files from storage buckets
    const buckets = ["posts", "avatars"];
    for (const bucket of buckets) {
      try {
        const { data: files } = await adminClient.storage
          .from(bucket)
          .list(userId);

        if (files && files.length > 0) {
          const paths = files.map((f) => `${userId}/${f.name}`);
          await adminClient.storage.from(bucket).remove(paths);
        }
      } catch {
        // Storage cleanup is best-effort; continue even if bucket doesn't exist
      }
    }

    // Step 2: Delete the auth user
    // This cascades to all DB tables via ON DELETE CASCADE foreign keys:
    // profiles, posts, post_reactions, post_comments, friendships,
    // event_rsvps, explore_item_rsvps, user_item_events,
    // user_type_affinity, user_tag_affinity, analytics_events, etc.
    const { error: deleteError } =
      await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error("[delete-account] Failed to delete user:", deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to delete account" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(`[delete-account] User ${userId} deleted successfully`);

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[delete-account] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

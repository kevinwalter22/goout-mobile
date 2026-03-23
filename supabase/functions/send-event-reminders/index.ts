/**
 * send-event-reminders
 *
 * Scheduled edge function that sends push notifications to users
 * who RSVP'd to events starting in ~1 hour.
 *
 * Called by pg_cron or an external scheduler every 15 minutes.
 * Requires service-role key for authorization.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import {
  getCorsHeaders,
  handleCorsPreflightIfNeeded,
} from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightIfNeeded(req);
  if (corsResponse) return corsResponse;
  const headers = getCorsHeaders(req);

  // Only service-role can invoke this
  const { ok, error: authError } = requireServiceRole(req);
  if (!ok) {
    return new Response(JSON.stringify({ error: authError }), {
      status: 403,
      headers,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Find events starting in 45–75 minutes with RSVP'd users who
    //    have event reminders enabled
    const { data: rsvps, error: queryError } = await supabase.rpc(
      "get_upcoming_event_reminders"
    );

    // If the RPC doesn't exist yet, fall back to a direct query
    let reminders: Array<{
      user_id: string;
      explore_item_id: string;
      title: string;
      starts_at: string;
    }>;

    if (queryError || !rsvps) {
      // Direct query fallback
      const { data, error } = await supabase
        .from("explore_item_rsvps")
        .select(
          `
          user_id,
          explore_item_id,
          explore_items!inner(title, starts_at),
          profiles!inner(notify_event_reminders)
        `
        )
        .gte(
          "explore_items.starts_at",
          new Date(Date.now() + 45 * 60 * 1000).toISOString()
        )
        .lte(
          "explore_items.starts_at",
          new Date(Date.now() + 75 * 60 * 1000).toISOString()
        )
        .eq("profiles.notify_event_reminders", true);

      if (error || !data) {
        return new Response(
          JSON.stringify({ error: "Query failed", details: error?.message }),
          { status: 500, headers }
        );
      }

      reminders = data.map((r: any) => ({
        user_id: r.user_id,
        explore_item_id: r.explore_item_id,
        title: r.explore_items.title,
        starts_at: r.explore_items.starts_at,
      }));
    } else {
      reminders = rsvps;
    }

    if (reminders.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No reminders" }), {
        status: 200,
        headers,
      });
    }

    // 2. Deduplicate — skip users who already got a reminder for this event
    const uniqueReminders: typeof reminders = [];
    for (const r of reminders) {
      const { data: existing } = await supabase
        .from("notifications_sent")
        .select("id")
        .eq("user_id", r.user_id)
        .eq("notification_type", "event_reminder")
        .eq("reference_id", r.explore_item_id)
        .maybeSingle();

      if (!existing) {
        uniqueReminders.push(r);
      }
    }

    if (uniqueReminders.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "All already notified" }),
        { status: 200, headers }
      );
    }

    // 3. Collect push tokens for all unique users
    const userIds = [...new Set(uniqueReminders.map((r) => r.user_id))];
    const { data: allTokens } = await supabase
      .from("push_tokens")
      .select("user_id, token")
      .in("user_id", userIds);

    if (!allTokens || allTokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No push tokens" }),
        { status: 200, headers }
      );
    }

    // Map user_id → tokens
    const tokenMap = new Map<string, string[]>();
    for (const t of allTokens) {
      const list = tokenMap.get(t.user_id) || [];
      list.push(t.token);
      tokenMap.set(t.user_id, list);
    }

    // 4. Build Expo push messages
    const messages: any[] = [];
    for (const r of uniqueReminders) {
      const userTokens = tokenMap.get(r.user_id);
      if (!userTokens) continue;

      for (const token of userTokens) {
        messages.push({
          to: token,
          sound: "default",
          title: "Event Reminder",
          body: `${r.title} starts in about 1 hour`,
          data: {
            type: "event_reminder",
            reference_id: r.explore_item_id,
          },
        });
      }
    }

    // 5. Send in batches of 100 (Expo Push API limit)
    let totalSent = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const pushResponse = await fetch(
        "https://exp.host/--/api/v2/push/send",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch),
        }
      );

      const pushResult = await pushResponse.json();

      // Clean up invalid tokens
      if (pushResult.data) {
        for (let j = 0; j < pushResult.data.length; j++) {
          const ticket = pushResult.data[j];
          if (
            ticket.status === "error" &&
            ticket.details?.error === "DeviceNotRegistered"
          ) {
            await supabase
              .from("push_tokens")
              .delete()
              .eq("token", batch[j].to);
          }
        }
      }

      totalSent += batch.length;
    }

    // 6. Record dedup entries
    const dedupRows = uniqueReminders.map((r) => ({
      user_id: r.user_id,
      notification_type: "event_reminder",
      reference_id: r.explore_item_id,
    }));

    await supabase.from("notifications_sent").upsert(dedupRows, {
      onConflict: "user_id,notification_type,reference_id",
      ignoreDuplicates: true,
    });

    return new Response(
      JSON.stringify({ sent: totalSent, reminders: uniqueReminders.length }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("send-event-reminders error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers }
    );
  }
});

/**
 * flush-friend-activity
 *
 * Cron-invoked (every 5 min). For each eligible recipient (get_friend_activity_candidates,
 * gated by the 30-min cooldown + 90-min stale-cap in app_config), sends ONE bundled push and
 * writes one CENTER row per friend post. Anti-spam is the whole point:
 *   - the push is BUNDLED; the count in the copy is DISTINCT friends, so a friend posting 5x is
 *     one mention, not five;
 *   - the center is ITEMIZED (a row per post) so tapping in shows who/where;
 *   - the cooldown caps friend-activity to ≤1 push / 30 min per recipient.
 *
 * Service function — invoked by pg_cron with the service-role key; no user JWT.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

type Candidate = {
  recipient_id: string;
  post_id: string;
  author_id: string;
  author_name: string | null;
  place: string | null;
  post_created_at: string;
};

function buildCopy(friendNames: string[], distinctCount: number, latestPlace: string | null) {
  const title = "Friend activity";
  if (distinctCount <= 1) {
    const n = friendNames[0] || "A friend";
    return { title, body: latestPlace ? `${n} posted at ${latestPlace}` : `${n} just posted` };
  }
  if (distinctCount === 2) {
    return { title, body: `${friendNames[0]} and ${friendNames[1]} posted near you` };
  }
  if (distinctCount === 3) {
    return { title, body: `${friendNames[0]}, ${friendNames[1]}, and ${friendNames[2]} posted near you` };
  }
  return { title, body: `${distinctCount} friends are posting now` };
}

async function sendExpoBundle(
  supabase: ReturnType<typeof createClient>,
  tokens: string[],
  title: string,
  body: string,
): Promise<number> {
  if (tokens.length === 0) return 0;
  const messages = tokens.map((t) => ({
    to: t,
    sound: "default" as const,
    title,
    body,
    data: { type: "friend_activity" },
  }));
  const resp = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
  const result = await resp.json().catch(() => ({}));
  if (result?.data) {
    for (let i = 0; i < result.data.length; i++) {
      if (result.data[i]?.status === "error" && result.data[i]?.details?.error === "DeviceNotRegistered") {
        await supabase.from("push_tokens").delete().eq("token", tokens[i]);
      }
    }
  }
  return messages.length;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Tunables (app_config), with safe defaults.
  const { data: cfg } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", ["friend_activity_cooldown_minutes", "friend_activity_stale_cap_minutes"]);
  const cfgMap = new Map((cfg || []).map((r: any) => [r.key, r.value]));
  const cooldown = parseInt(cfgMap.get("friend_activity_cooldown_minutes") ?? "30", 10);
  const staleCap = parseInt(cfgMap.get("friend_activity_stale_cap_minutes") ?? "90", 10);

  const { data: rows, error } = await supabase.rpc("get_friend_activity_candidates", {
    p_cooldown_minutes: cooldown,
    p_stale_cap_minutes: staleCap,
  });
  if (error) {
    console.error("get_friend_activity_candidates failed:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Group candidates by recipient (rows already ordered created_at DESC per recipient).
  const byRecipient = new Map<string, Candidate[]>();
  for (const r of (rows || []) as Candidate[]) {
    const list = byRecipient.get(r.recipient_id);
    if (list) list.push(r);
    else byRecipient.set(r.recipient_id, [r]);
  }

  let recipientsNotified = 0;
  let pushesSent = 0;
  let centerRows = 0;

  for (const [recipientId, posts] of byRecipient) {
    // Distinct friends, ordered by most-recent post (posts are DESC by created_at).
    const seen = new Set<string>();
    const friendNames: string[] = [];
    for (const p of posts) {
      if (!seen.has(p.author_id)) {
        seen.add(p.author_id);
        friendNames.push(p.author_name || "A friend");
      }
    }
    const distinctCount = seen.size;
    const latestPlace = posts[0]?.place ?? null;
    const { title, body } = buildCopy(friendNames, distinctCount, latestPlace);

    // One bundled push.
    const { data: toks } = await supabase.from("push_tokens").select("token").eq("user_id", recipientId);
    const tokens = (toks || []).map((t: any) => t.token);
    pushesSent += await sendExpoBundle(supabase, tokens, title, body);

    // Itemized center rows — one per friend post (tap → that post).
    for (const p of posts) {
      const { error: cErr } = await supabase.rpc("create_notification", {
        p_user_id: recipientId,
        p_type: "friend_activity",
        p_title: p.author_name || "A friend",
        p_body: p.place ? `posted at ${p.place}` : "just posted",
        p_target_route: `/post/${p.post_id}`,
        p_reference_id: p.post_id,
        p_actor_id: p.author_id,
      });
      if (!cErr) centerRows++;
    }

    // Advance the bundling cursor so the cooldown gates the next push.
    await supabase.from("profiles").update({ last_friend_activity_at: new Date().toISOString() }).eq("id", recipientId);
    recipientsNotified++;
  }

  return new Response(
    JSON.stringify({ recipientsNotified, pushesSent, centerRows }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

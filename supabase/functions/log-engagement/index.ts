/**
 * log-engagement — bulk-insert endpoint for client engagement events.
 *
 * Receives a batch of EngagementEvents from the client buffer
 * (src/lib/engagementBuffer.ts) and inserts into engagement_log under the
 * caller's RLS. Rate-limited to 100 batches/min/user.
 *
 * post_at_event events come from the database trigger
 * (log_post_at_event on posts INSERT), NOT through this endpoint. The
 * server rejects 'post_at_event' if a client tries to log it.
 *
 * Request:
 *   POST { events: EngagementEvent[] }
 *
 * Response:
 *   200 { inserted: number }
 *   401 if no/invalid JWT
 *   400 if validation fails (empty batch, mismatched user_id, bad event_type,
 *       occurred_at older than 24h, batch > 200)
 *   429 if rate-limited
 *
 * Auth: requireUser (per-row RLS handles authorization).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { requireUser } from "../_shared/auth-guard.ts";

const MAX_BATCH = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_PER_MIN = 100;

const ALLOWED_EVENT_TYPES = new Set([
  "impression",
  "impression_extended",
  "tap",
  "save",
  "unsave",
  "rsvp",
  "unrsvp",
  "share",
  "dismiss",
  "scroll_past",
]);

// In-memory rate-limiter — fine for a single edge function instance; if
// Supabase autoscales this to multiple instances, each user has up to
// RATE_LIMIT_PER_MIN * instance_count effective limit. Acceptable for v1.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRate(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_PER_MIN) return false;
  bucket.count++;
  return true;
}

interface IncomingEvent {
  user_id: string;
  explore_item_id?: string | null;
  event_type: string;
  occurred_at: string;
  session_id: string;
  feed_context: string;
  rank_position?: number | null;
  duration_ms?: number | null;
  ranking_signals?: unknown;
  user_location?: unknown;
  social_context?: unknown;
  item_snapshot?: unknown;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  const auth = await requireUser(req);
  if (auth.error || !auth.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = auth.user.id as string;

  if (!checkRate(userId)) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { events?: IncomingEvent[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const events = body.events;
  if (!Array.isArray(events) || events.length === 0) {
    return new Response(JSON.stringify({ error: "empty_batch" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (events.length > MAX_BATCH) {
    return new Response(JSON.stringify({ error: "batch_too_large", max: MAX_BATCH }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Per-row validation
  const now = Date.now();
  const validated: IncomingEvent[] = [];
  const rejected: { index: number; reason: string }[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.user_id !== userId) {
      rejected.push({ index: i, reason: "user_id_mismatch" });
      continue;
    }
    if (!ALLOWED_EVENT_TYPES.has(e.event_type)) {
      // post_at_event is intentionally excluded — trigger-only.
      rejected.push({ index: i, reason: "invalid_event_type" });
      continue;
    }
    const t = Date.parse(e.occurred_at);
    if (Number.isNaN(t) || now - t > MAX_AGE_MS || t - now > 60_000) {
      rejected.push({ index: i, reason: "stale_or_future_timestamp" });
      continue;
    }
    if (!e.session_id || typeof e.session_id !== "string") {
      rejected.push({ index: i, reason: "missing_session_id" });
      continue;
    }
    if (!e.feed_context || typeof e.feed_context !== "string") {
      rejected.push({ index: i, reason: "missing_feed_context" });
      continue;
    }
    validated.push(e);
  }

  if (validated.length === 0) {
    return new Response(
      JSON.stringify({ inserted: 0, rejected }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Insert under the caller's auth (RLS WITH CHECK user_id = auth.uid()
  // gates it; service role would bypass RLS but we prefer per-row RLS
  // enforcement here). Use the user's JWT for the client.
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const jwt = req.headers.get("Authorization")!.replace(/^Bearer\s+/i, "");
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const rows = validated.map((e) => ({
    user_id: e.user_id,
    explore_item_id: e.explore_item_id ?? null,
    event_type: e.event_type,
    occurred_at: e.occurred_at,
    session_id: e.session_id,
    feed_context: e.feed_context,
    rank_position: e.rank_position ?? null,
    duration_ms: e.duration_ms ?? null,
    ranking_signals: e.ranking_signals ?? null,
    user_location: e.user_location ?? null,
    social_context: e.social_context ?? null,
    item_snapshot: e.item_snapshot ?? null,
  }));

  const { error: insErr } = await supabase.from("engagement_log").insert(rows);
  if (insErr) {
    console.error("[log-engagement] insert failed:", insErr.message);
    await captureEdgeException(new Error(insErr.message), {
      function: "log-engagement",
      tags: { stage: "insert" },
    });
    // pipeline_health_log entry for observability — best-effort
    try {
      const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await svc.from("pipeline_health_log").insert({
        stage: "engagement_log",
        source_name: "log-engagement",
        status: "error",
        items_processed: 0,
        items_failed: rows.length,
        duration_ms: 0,
        details_json: { error: insErr.message, batch_size: rows.length },
      });
    } catch {}
    return new Response(
      JSON.stringify({ error: insErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Success — pipeline_health_log entry per flush
  try {
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await svc.from("pipeline_health_log").insert({
      stage: "engagement_log",
      source_name: "log-engagement",
      status: "ok",
      items_processed: rows.length,
      items_failed: rejected.length,
      duration_ms: 0,
    });
  } catch {}

  return new Response(
    JSON.stringify({ inserted: rows.length, rejected }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

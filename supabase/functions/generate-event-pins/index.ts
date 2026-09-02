// generate-event-pins — durable, server-side photo-bubble pins (Plan B).
//
// Renders a user-created event's photo ONCE into a fixed-size circular map pin (a 72px
// photo circle + white hairline + green "yours" ring on a 100px transparent PNG), uploads
// it via the service_role (which BYPASSES the posts-bucket RLS that blocks client uploads),
// and caches its URL on explore_items.pin_image_url. The map reads pin_image_url and shows
// the photo pin; while it's null it shows the emoji fallback.
//
// Cost shape — the SAME discipline as notability/Haiku: rendered ONCE per event and cached
// forever (skips any event that already has a pin unless force=true), and the map serves the
// cached PNG from the public CDN => $0 per map render. A cron drives it (env-aware via
// app_config), so new events get a pin hands-off and existing ones backfill for free.
//
// Invoke (service-role only): POST { limit?=30, force?=false, event_id? }
//
// Compositing is done with ImageScript (pure-Deno, no native deps) — same geometry proven
// with the jimp reference render.

import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const RUN_DEADLINE_MS = 110_000; // stay under Supabase's ~150s kill
const CAN = 100, PHOTO = 72, OFF = (CAN - PHOTO) / 2;
const R_PHOTO = 36, R_WHITE = 40, R_RING = 46, CENTER = 50.5;
const WHITE = Image.rgbaToColor(255, 255, 255, 255);
const GREEN = Image.rgbaToColor(34, 197, 94, 255); // "yours" ring (matches PIN_RING_COLORS)

/** Composite a photo into the fixed-size circular pin PNG. Returns PNG bytes. */
async function renderPin(photoBytes: Uint8Array): Promise<Uint8Array> {
  const photo = await Image.decode(photoBytes);
  photo.cover(PHOTO, PHOTO); // fill + center-crop to a 72x72 square, then we circle-mask it
  const canvas = new Image(CAN, CAN); // transparent
  for (let y = 1; y <= CAN; y++) {
    for (let x = 1; x <= CAN; x++) {
      const dx = x - CENTER, dy = y - CENTER;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= R_PHOTO) {
        const px = x - OFF, py = y - OFF;
        if (px >= 1 && px <= PHOTO && py >= 1 && py <= PHOTO) {
          canvas.setPixelAt(x, y, photo.getPixelAt(px, py));
        }
      } else if (d <= R_WHITE) {
        canvas.setPixelAt(x, y, WHITE);
      } else if (d <= R_RING) {
        canvas.setPixelAt(x, y, GREEN);
      }
    }
  }
  return await canvas.encode(); // PNG
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const auth = requireServiceRole(req);
  if (!auth.ok) return json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401);

  try {
    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(body.limit ?? 30, 100);
    const force: boolean = body.force ?? false;
    const eventId: string | null = body.event_id ?? null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // User-created events with a photo that still need a pin (or a single event / force).
    let q = supabase
      .from("explore_items")
      .select("id, image_url, created_by_user_id")
      .not("created_by_user_id", "is", null)
      .not("image_url", "is", null)
      .limit(limit);
    if (eventId) q = q.eq("id", eventId);
    else if (!force) q = q.is("pin_image_url", null);
    const { data: events, error: selErr } = await q;
    if (selErr) return json({ error: `selection failed: ${selErr.message}` }, 500);
    if (!events || events.length === 0) return json({ generated: 0, message: "nothing needs a pin" });

    const started = Date.now();
    let generated = 0, failed = 0;
    for (const ev of events as any[]) {
      if (Date.now() - started > RUN_DEADLINE_MS) break;
      try {
        const res = await fetch(ev.image_url);
        if (!res.ok) { failed++; continue; }
        const photoBytes = new Uint8Array(await res.arrayBuffer());
        const png = await renderPin(photoBytes);
        // service_role upload bypasses the posts-bucket RLS; path kept beside the cover photo.
        const path = `events/${ev.created_by_user_id}/${ev.id}-pin.png`;
        const { error: upErr } = await supabase.storage
          .from("posts")
          .upload(path, png, { contentType: "image/png", upsert: true });
        if (upErr) { failed++; continue; }
        const pub = supabase.storage.from("posts").getPublicUrl(path).data.publicUrl;
        const { error: updErr } = await supabase
          .from("explore_items")
          .update({ pin_image_url: pub })
          .eq("id", ev.id);
        if (updErr) { failed++; continue; }
        generated++;
      } catch (e) {
        captureEdgeException(e, { fn: "generate-event-pins", event: ev.id });
        failed++;
      }
    }

    return json({ generated, failed, remaining_estimate: events.length - generated - failed });
  } catch (e) {
    captureEdgeException(e, { fn: "generate-event-pins" });
    return json({ error: String(e) }, 500);
  }
});

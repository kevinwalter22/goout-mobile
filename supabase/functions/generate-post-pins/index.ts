// generate-post-pins — server-side photo-bubble pins for CHECK-IN POSTS (the social map).
//
// Same compositor as generate-event-pins (mig 184 events): renders a post's photo ONCE into
// a fixed-size circular pin (72px photo + white hairline + ring on a 100px transparent PNG),
// uploads it via service_role (bypasses the posts-bucket RLS), and caches the URL on
// posts.pin_image_url. The map reads it and shows the check-in as the poster's photo.
// A brand-purple ring distinguishes check-ins from user-EVENT pins (green). Render-once /
// cache-forever => $0 per map render; a cron drives it so posts get pinned hands-off.
//
// Invoke (service-role only): POST { limit?=30, force?=false, post_id? }

import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const RUN_DEADLINE_MS = 110_000;
const CAN = 100, PHOTO = 72, OFF = (CAN - PHOTO) / 2;
const R_PHOTO = 36, R_WHITE = 40, R_RING = 46, CENTER = 50.5;
const WHITE = Image.rgbaToColor(255, 255, 255, 255);
const PURPLE = Image.rgbaToColor(123, 63, 242, 255); // brand check-in ring (distinct from event green)

async function renderPin(photoBytes: Uint8Array): Promise<Uint8Array> {
  const photo = await Image.decode(photoBytes);
  photo.cover(PHOTO, PHOTO);
  const canvas = new Image(CAN, CAN);
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
        canvas.setPixelAt(x, y, PURPLE);
      }
    }
  }
  return await canvas.encode();
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
    const postId: string | null = body.post_id ?? null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Approved, plottable check-ins that still need a pin (or a single post / force).
    let q = supabase
      .from("posts")
      .select("id, photo_path, user_id")
      .not("photo_path", "is", null)
      .not("verified_lat", "is", null)
      .eq("moderation_status", "approved")
      .limit(limit);
    if (postId) q = q.eq("id", postId);
    else if (!force) q = q.is("pin_image_url", null);
    const { data: posts, error: selErr } = await q;
    if (selErr) return json({ error: `selection failed: ${selErr.message}` }, 500);
    if (!posts || posts.length === 0) return json({ generated: 0, message: "nothing needs a pin" });

    const started = Date.now();
    let generated = 0, failed = 0;
    for (const p of posts as any[]) {
      if (Date.now() - started > RUN_DEADLINE_MS) break;
      try {
        const srcUrl = supabase.storage.from("posts").getPublicUrl(p.photo_path).data.publicUrl;
        const res = await fetch(srcUrl);
        if (!res.ok) { failed++; continue; }
        const photoBytes = new Uint8Array(await res.arrayBuffer());
        const png = await renderPin(photoBytes);
        const path = `${p.user_id}/${p.id}-pin.png`;
        const { error: upErr } = await supabase.storage
          .from("posts")
          .upload(path, png, { contentType: "image/png", upsert: true });
        if (upErr) { failed++; continue; }
        const pub = supabase.storage.from("posts").getPublicUrl(path).data.publicUrl;
        const { error: updErr } = await supabase.from("posts").update({ pin_image_url: pub }).eq("id", p.id);
        if (updErr) { failed++; continue; }
        generated++;
      } catch (e) {
        captureEdgeException(e, { fn: "generate-post-pins", post: p.id });
        failed++;
      }
    }

    return json({ generated, failed, remaining_estimate: posts.length - generated - failed });
  } catch (e) {
    captureEdgeException(e, { fn: "generate-post-pins" });
    return json({ error: String(e) }, 500);
  }
});

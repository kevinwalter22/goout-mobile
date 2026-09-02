-- 184_user_event_pin_image.sql
--
-- Plan B (photo-bubble pins), V1 = user-created events. Stores the URL of the pre-rendered
-- circular PIN image for a user-created event: the event's photo composited ONCE into a
-- fixed-size circular disc (photo masked in a 72px circle + ring), so the map hands Mapbox
-- a uniform-dimension image that renders at the same on-screen size as every emoji pin.
-- Render-once / cache-forever: composited on-device (react-native-view-shot) at create time,
-- uploaded to the public `posts` bucket, and its URL cached here. Null => the map shows the
-- emoji fallback pin (and, later, the renderer fills it in and swaps to the photo).
--
-- This is a plain nullable column — no backfill, no logic change. The map reads it; the
-- client writes it after compositing. Ingested places never set it (they keep emoji pins).
--
-- ROLLBACK: alter table public.explore_items drop column if exists pin_image_url;

alter table public.explore_items add column if not exists pin_image_url text;

comment on column public.explore_items.pin_image_url is
  'Plan B: URL of the pre-rendered circular photo-pin for a user-created event (photo '
  'composited into a fixed-size disc + ring, rendered once on-device, cached in the posts '
  'bucket). Null => emoji fallback pin. Set only for user-created events (created_by_user_id).';

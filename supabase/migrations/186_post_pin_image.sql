-- 186_post_pin_image.sql
--
-- Social map (check-in post pins). Caches the URL of each post's pre-rendered circular
-- photo pin — the post's photo composited once into a fixed-size disc (same compositor as
-- the event pins, mig 184), so a check-in shows on the map as the poster's photo. Generated
-- server-side (generate-post-pins edge fn + cron), render-once / cache-forever => $0 per map
-- render. Null => the map shows the emoji/place fallback until it's rendered.
--
-- Viewer-independent (the photo bubble is the same regardless of who's looking), so one pin
-- per post is reused across all viewers. A place bubble shows the MOST RECENT post's pin +
-- a check-in count (aggregation is done client-side in the map layer).
--
-- ROLLBACK: alter table public.posts drop column if exists pin_image_url;

alter table public.posts add column if not exists pin_image_url text;

comment on column public.posts.pin_image_url is
  'Pre-rendered circular photo-pin URL for this check-in post (photo composited into a disc '
  '+ ring, rendered once by generate-post-pins, cached in the posts bucket). Null => not yet '
  'rendered. Drives the social-map check-in pins.';

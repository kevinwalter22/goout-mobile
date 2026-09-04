-- 192_friend_activity_bundling.sql
--
-- Phase A: friend-activity notifications with per-recipient BUNDLING (anti-spam is first-class).
-- The flush-friend-activity edge fn runs on a cron; per eligible recipient it sends ONE bundled
-- push (copy by distinct-friend count) and writes one CENTER row per friend post (itemized).
--
-- Tunables live in app_config so Kevin can adjust from real behavior:
--   friend_activity_cooldown_minutes  (default 30) — min gap between friend-activity pushes to a
--       recipient. Euda's real-time-presence thesis: 30 = timely-enough-to-join, not spammy.
--   friend_activity_stale_cap_minutes (default 90) — never surface friend posts older than this
--       ("the moment's gone").

INSERT INTO app_config (key, value) VALUES
  ('friend_activity_cooldown_minutes', '30'),
  ('friend_activity_stale_cap_minutes', '90')
ON CONFLICT (key) DO NOTHING;

-- ── Candidate rows for the flush fn ──────────────────────────────────────────────────────────
-- Returns one row per (eligible recipient, fresh friend post). The edge fn groups by recipient,
-- counts DISTINCT authors for the copy (so a friend posting 5x = one mention), sends one push,
-- writes a center row per post, and stamps last_friend_activity_at.
CREATE OR REPLACE FUNCTION get_friend_activity_candidates(
  p_cooldown_minutes  INTEGER DEFAULT 30,
  p_stale_cap_minutes INTEGER DEFAULT 90
)
RETURNS TABLE (
  recipient_id     UUID,
  post_id          UUID,
  author_id        UUID,
  author_name      TEXT,
  place            TEXT,
  post_created_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH fr AS (
    -- accepted friendships, both directions → (recipient, friend)
    SELECT user_id   AS recipient, friend_id AS friend FROM friendships WHERE status = 'accepted'
    UNION
    SELECT friend_id AS recipient, user_id   AS friend FROM friendships WHERE status = 'accepted'
  )
  SELECT
    fr.recipient                       AS recipient_id,
    p.id                               AS post_id,
    p.user_id                          AS author_id,
    pp.username                        AS author_name,
    COALESCE(ei.title, ev.title)       AS place,
    p.created_at                       AS post_created_at
  FROM fr
  JOIN profiles rprof         ON rprof.id = fr.recipient
  JOIN posts p                ON p.user_id = fr.friend
  LEFT JOIN public_profiles pp ON pp.id = p.user_id
  LEFT JOIN explore_items ei   ON ei.id = p.explore_item_id
  LEFT JOIN events ev          ON ev.id = p.event_id
  WHERE fr.recipient <> p.user_id
    AND COALESCE(rprof.notify_friend_activity, TRUE) = TRUE
    AND p.moderation_status = 'approved'
    -- only posts NEWER than the recipient's last bundle …
    AND p.created_at > COALESCE(rprof.last_friend_activity_at, '-infinity'::timestamptz)
    -- … and not stale (presence: "the moment's gone")
    AND p.created_at >= now() - (p_stale_cap_minutes || ' minutes')::interval
    -- recipient is eligible for a send now (cooldown elapsed)
    AND (rprof.last_friend_activity_at IS NULL
         OR now() - rprof.last_friend_activity_at >= (p_cooldown_minutes || ' minutes')::interval)
    -- respect blocks (either direction)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks b
      WHERE (b.blocker_id = fr.recipient AND b.blocked_id = p.user_id)
         OR (b.blocker_id = p.user_id AND b.blocked_id = fr.recipient)
    )
  ORDER BY fr.recipient, p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_friend_activity_candidates(INTEGER, INTEGER) TO service_role;

-- ── Cron: flush friend activity every 5 min (cooldown gates to ≤1 push / 30 min per recipient) ─
-- Tight cron cadence = low latency for presence; the cooldown is the real rate limit.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flush-friend-activity-run') THEN
    PERFORM cron.schedule('flush-friend-activity-run', '*/5 * * * *', $job$
      SELECT net.http_post(
        url := (SELECT value FROM public.app_config WHERE key = 'supabase_url') || '/functions/v1/flush-friend-activity',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'service_role_key')
        ),
        body := '{}'::jsonb
      );
    $job$);
  END IF;
END $$;

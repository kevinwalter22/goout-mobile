-- 188_map_posts_in_view.sql
--
-- Friends-scoped check-in posts for the social map. Post SELECT RLS is effectively
-- public-read (mig 078), so the friends+you scope MUST be enforced here, not by RLS. This
-- SECURITY DEFINER RPC returns the viewer's own + accepted-friends' approved, plottable
-- check-ins within a map bbox + a recency window, excluding blocked users — the exact scope
-- the friends feed uses (usePosts.ts), plus bbox + window for the map.
--
-- Product calls (Kevin, 2026-09-02): whose = friends + you; window = last 30 days (default,
-- caller-overridable); aggregation into place bubbles (latest photo + count) happens
-- client-side in the map layer.
--
-- ROLLBACK: drop function public.map_posts_in_view(numeric,numeric,numeric,numeric,integer);

create or replace function public.map_posts_in_view(
  p_min_lat numeric, p_max_lat numeric,
  p_min_lng numeric, p_max_lng numeric,
  p_since_days integer default 30
)
returns table(
  id uuid, user_id uuid, username text, avatar_url text,
  caption text, pin_image_url text, photo_path text,
  lat numeric, lng numeric, created_at timestamptz, explore_item_id uuid
)
language sql security definer set search_path to 'public' as $$
  with me as (select auth.uid() as uid),
  friends as (
    select friend_id as uid from public.friendships
      where user_id = (select uid from me) and status = 'accepted'
    union
    select user_id as uid from public.friendships
      where friend_id = (select uid from me) and status = 'accepted'
    union
    select (select uid from me)
  )
  select p.id, p.user_id, pr.username, pr.avatar_url, p.caption,
    p.pin_image_url, p.photo_path,
    p.verified_lat, p.verified_lng, p.created_at, p.explore_item_id
  from public.posts p
  join friends f on f.uid = p.user_id
  left join public.public_profiles pr on pr.id = p.user_id
  where p.moderation_status = 'approved'
    and p.verified_lat is not null and p.verified_lng is not null
    and p.created_at > now() - make_interval(days => greatest(1, coalesce(p_since_days, 30)))
    and p.user_id not in (
      select blocked_id from public.user_blocks where blocker_id = (select uid from me)
    )
    and p.verified_lat between p_min_lat and p_max_lat
    and p.verified_lng between p_min_lng and p_max_lng
  order by p.created_at desc
  limit 500;
$$;

grant execute on function public.map_posts_in_view(numeric,numeric,numeric,numeric,integer) to authenticated;

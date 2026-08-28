-- 175 · Posting-loop analytics (Phase 3 · Act 1 instrumentation)
--
-- Adds the ONE dimension the posts table can't otherwise recover — the ROUTE a
-- post came from — plus a single read-only scorecard RPC that both consumers
-- share (the weekly cost-watch digest AND the auditor's audit-posting-loop edge
-- function). Route matters because both routes now write identical rows:
--   • post_first — the purple-plus FAB flow
--   • item_gated — event / postable pin → check-in → the same camera/compose
-- Link-type (linked vs My-Location), verified-attendance, and counts are already
-- derivable from posts; route was the gap. posts.post_source closes it.
--
-- Nullable by design: pre-instrumentation rows stay NULL ("unknown route"). The
-- CHECK allows NULL, so ADD COLUMN validates cleanly against existing rows and
-- there is zero risk to the geo+time invariant (137/173) — this column is
-- orthogonal to the verification triggers.

alter table public.posts
  add column if not exists post_source text
    constraint posts_post_source_check
      check (post_source in ('post_first', 'item_gated'));

comment on column public.posts.post_source is
  'Route the post was created from: post_first (FAB) | item_gated (event/pin check-in). '
  'NULL for rows created before Phase-3 analytics instrumentation. Analytics only — '
  'never gates behaviour.';

-- ── posting_loop_health(since, until) ────────────────────────────────────────
-- Single source of truth for the "posting loop health" scorecard over a window.
-- Read-only. Combines posts-table facts (route, link-type, verified attendance,
-- camera mode) with the analytics_events funnel (post_started vs post_completed,
-- by route) so a caller can compute abandonment = started − completed per route.
-- SECURITY DEFINER + service_role-only: this is admin analytics, not user-facing.
create or replace function public.posting_loop_health(
  p_since timestamptz,
  p_until timestamptz
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'window_start', p_since,
    'window_end', p_until,
    'posts', (
      select jsonb_build_object(
        'total', count(*),
        'distinct_posters', count(distinct user_id),
        'by_route', jsonb_build_object(
          'post_first', count(*) filter (where post_source = 'post_first'),
          'item_gated', count(*) filter (where post_source = 'item_gated'),
          'unknown',    count(*) filter (where post_source is null)
        ),
        'by_link', jsonb_build_object(
          'linked',      count(*) filter (where explore_item_id is not null),
          'my_location', count(*) filter (where explore_item_id is null)
        ),
        'verified_at_event', count(*) filter (where verified_at_event is true),
        'by_camera_mode', jsonb_build_object(
          'dual',  count(*) filter (where camera_mode = 'dual'),
          'back',  count(*) filter (where camera_mode = 'back'),
          'front', count(*) filter (where camera_mode = 'front')
        )
      )
      from public.posts
      where created_at >= p_since and created_at < p_until
    ),
    'funnel', (
      select jsonb_build_object(
        'started',   count(*) filter (where event_name = 'post_started'),
        'completed', count(*) filter (where event_name = 'post_completed'),
        'started_by_route', jsonb_build_object(
          'post_first', count(*) filter (where event_name = 'post_started'   and metadata->>'source' = 'post_first'),
          'item_gated', count(*) filter (where event_name = 'post_started'   and metadata->>'source' = 'item_gated')
        ),
        'completed_by_route', jsonb_build_object(
          'post_first', count(*) filter (where event_name = 'post_completed' and metadata->>'source' = 'post_first'),
          'item_gated', count(*) filter (where event_name = 'post_completed' and metadata->>'source' = 'item_gated')
        )
      )
      from public.analytics_events
      where created_at >= p_since and created_at < p_until
        and event_name in ('post_started', 'post_completed')
    )
  );
$$;

comment on function public.posting_loop_health(timestamptz, timestamptz) is
  'Read-only posting-loop-health scorecard for [since, until). Shared by the weekly '
  'cost-watch digest and the auditor audit-posting-loop edge function. Abandonment = '
  'funnel.started − funnel.completed (per route).';

revoke all on function public.posting_loop_health(timestamptz, timestamptz) from public;
grant execute on function public.posting_loop_health(timestamptz, timestamptz) to service_role;

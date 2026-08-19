-- 160_resolve_market_occurrences.sql
--
-- What's Happening — recurring markets/flea as real events.
--
-- Problem: farmers'/flea markets were ingested as kind='activity' with store-hours
-- schedule_text but no starts_at/ends_at. In the app that meant (1) no purple "when"
-- label on the card (formatTileWhen gates on kind='event') and (2) they vanished under
-- the Events-only toggle (exploreQuery filters kind='event'). A store's weekly "market
-- day" is genuinely an event, so this function graduates them:
--   * kind            -> 'event'
--   * starts_at/ends_at -> the soonest upcoming occurrence, parsed TZ-correct from
--                          schedule_text (both open AND close time), across all open days
--                          (handles multi-day markets like Portland's Wed+Sat).
--   * recurrence      -> 'weekly' so demote_stale_items() skips them (it only demotes
--                          non-recurring events) and advance_recurring_events() backstops
--                          the roll-forward.
--
-- Only real "market days" graduate: items open 1-3 days/week. Daily 7-day farm stands
-- fail the 1-3-day filter and correctly stay activities (they're stores, not events).
--
-- Reproducible + self-healing: this is deterministic SQL (no data artifact). A nightly
-- cron (below) re-runs it so passed occurrences roll to next week automatically, and
-- newly-ingested markets graduate without manual work.

CREATE OR REPLACE FUNCTION public.resolve_market_next_occurrence(p_only_null boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_n integer; v_f integer; v_r integer;
begin
  with mkt as (
    select ei.id, ei.schedule_text,
      coalesce((select r.timezone from region r where r.id = ei.region_id), 'America/New_York') tz
    from explore_items ei
    where coalesce(ei.is_admin_suppressed, false) = false
      and ei.relevance_tier >= 1
      and nullif(ei.schedule_text, '') is not null
      and (lower(coalesce(ei.sub_category, '')) in ('farmers market','flea market','public market','market day')
           or ei.title ~* '(farmers.?market|flea.?market|flea.?for.?all|makers?.?market|public market)')
      and (not p_only_null or ei.starts_at is null)
  ),
  daymap(dow, nm) as (
    values (0,'Sunday'),(1,'Monday'),(2,'Tuesday'),(3,'Wednesday'),(4,'Thursday'),(5,'Friday'),(6,'Saturday')
  ),
  opendays as (
    -- Parse open + close clock times per open-day. Open meridiem is optional
    -- ("3:00 – 6:00 PM"): inherit the close meridiem, but only when doing so keeps
    -- open < close (else the open time is AM crossing into a PM close).
    select h.id, h.tz, dm.dow,
      make_time(
        (g[1]::int % 12) +
        case when g[3] is not null then (case when upper(g[3])='PM' then 12 else 0 end)
             else (case when upper(g[6])='PM' and (g[1]::int % 12) < (g[4]::int % 12) then 12 else 0 end) end,
        g[2]::int, 0) as st,
      make_time((g[4]::int % 12) + case when upper(g[6])='PM' then 12 else 0 end, g[5]::int, 0) as et
    from mkt h
    join daymap dm on true
    cross join lateral (
      select regexp_match(
        h.schedule_text,
        dm.nm || ':\s*(\d{1,2}):(\d{2})\s*([AP]M)?\s*[–—-]\s*(\d{1,2}):(\d{2})\s*([AP]M)'
      ) as g
    ) x
    where x.g is not null
  ),
  few as ( select id from opendays group by id having count(*) between 1 and 3 ),
  nextocc as (
    select od.id,
      (array_agg(cand order by cand))[1] as starts_at,
      (array_agg(cend order by cand))[1] as ends_at
    from opendays od
    join few using (id)
    cross join generate_series(0,13) g(n)
    cross join lateral (
      select ((current_date + g.n) + od.st) at time zone od.tz as cand,
             ((current_date + g.n) + od.et) at time zone od.tz as cend
    ) c
    where extract(dow from (current_date + g.n)) = od.dow and c.cand >= now()
    group by od.id
  )
  update explore_items ei
    set starts_at = no.starts_at, ends_at = no.ends_at,
        kind = 'event', recurrence = 'weekly', updated_at = now()
  from nextocc no
  where ei.id = no.id
    and (ei.starts_at is distinct from no.starts_at
         or ei.ends_at   is distinct from no.ends_at
         or ei.kind::text <> 'event'
         or coalesce(ei.recurrence,'') <> 'weekly');
  get diagnostics v_n = row_count;

  -- Safety net: unparseable close time → sane 4h market window.
  update explore_items ei
    set ends_at = ei.starts_at + interval '4 hours', updated_at = now()
  where ei.kind::text='event' and ei.starts_at is not null and ei.ends_at is null
    and (lower(coalesce(ei.sub_category,'')) in ('farmers market','flea market','public market','market day')
         or ei.title ~* '(farmers.?market|flea.?market|flea.?for.?all|makers?.?market|public market)');
  get diagnostics v_f = row_count;

  -- Mark market events weekly-recurring so demote_stale_items() skips them.
  update explore_items ei
    set recurrence = 'weekly', updated_at = now()
  where ei.kind::text='event' and (ei.recurrence is null or ei.recurrence in ('none',''))
    and (lower(coalesce(ei.sub_category,'')) in ('farmers market','flea market','public market','market day')
         or ei.title ~* '(farmers.?market|flea.?market|flea.?for.?all|makers?.?market|public market)');
  get diagnostics v_r = row_count;

  return v_n + v_f + v_r;
end $function$;

-- Backfill existing rows on deploy.
select public.resolve_market_next_occurrence(false);

-- Nightly roll-forward at 03:55 UTC — AFTER advance_recurring_events (03:50, the backstop)
-- and BEFORE demote_stale_items (04:00), so markets are always future-dated when demote runs.
select cron.unschedule('resolve-market-occurrences')
  where exists (select 1 from cron.job where jobname = 'resolve-market-occurrences');
select cron.schedule('resolve-market-occurrences', '55 3 * * *',
  $$select public.resolve_market_next_occurrence(false)$$);

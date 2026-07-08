# Tier 2 design — Structured recurrence + Region model

**Status:** DRAFT for Kevin's review. Do NOT build until approved.
**Why now:** the feel-test proved the event layer's foundation is missing. Stale
dates, "what's on Saturday," cross-metro bleed, and the empty map all trace to
two absent abstractions: a **recurrence model** and a **region model**. The
Tier 1 interim fixes (migration 149 roll-forward, last-known geo scope) buy time;
these are the durable replacements.

This touches how events rank (Tier 3 autonomy), so it stops here for review
before any code.

---

## Part A — Structured recurrence (RFC 5545)

### The problem (what the interim doesn't solve)
The collector parses an RRULE, then **discards it** (`web_collector.ts:221`
stores `recurrence:"custom"`). Every recurring event keeps one frozen
`starts_at`. The interim rolls that single date forward for `daily/weekly/monthly`
labels — but it cannot:
- handle `custom`/`unknown` rules (BYDAY lists, "2nd Tuesday", bi-weekly),
- honor a series **end** (the May–Nov farmers-market case — see §A5),
- answer "what's on **this** Saturday" from a rule (only from a single stored date),
- show a series' next *few* dates.

### A1. Schema — series + materialized occurrences

```sql
-- The canonical recurring series (one row per real-world series).
CREATE TABLE event_series (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid NOT NULL REFERENCES event_sources(id),
  external_id     text NOT NULL,
  title           text NOT NULL,
  description     text,
  location_name   text,
  address         text,
  town            text,
  region_id       uuid REFERENCES region(id),          -- see Part B
  lat             double precision,
  lng             double precision,
  category        text,
  tags            text[],
  timezone        text NOT NULL DEFAULT 'America/New_York',
  -- RFC 5545 recurrence, stored verbatim (no longer discarded):
  rrule           text,            -- e.g. 'FREQ=WEEKLY;BYDAY=TU'
  dtstart         timestamptz NOT NULL,
  until           timestamptz,     -- series end (RRULE UNTIL) — season bound
  count_limit     integer,         -- RRULE COUNT, if used instead of UNTIL
  rdate           timestamptz[],   -- extra one-off dates
  exdate          timestamptz[],   -- exceptions (cancellations)
  duration        interval,        -- occurrence length (ends_at - starts_at)
  season_json     jsonb,           -- optional explicit window {start_md, end_md}
  is_enabled      boolean NOT NULL DEFAULT true,
  last_materialized_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);
```

**Occurrences: reuse `explore_items`, don't add a parallel table.** Materialize
each upcoming occurrence as an `explore_items` row (kind='event') linked back to
the series. This keeps the entire read path (feed RPC, map queries, ranker,
scoring signals) working **unchanged** — they already operate on `explore_items`.

```sql
ALTER TABLE explore_items
  ADD COLUMN series_id    uuid REFERENCES event_series(id) ON DELETE CASCADE,
  ADD COLUMN is_occurrence boolean NOT NULL DEFAULT false;
CREATE INDEX ON explore_items (series_id, starts_at) WHERE series_id IS NOT NULL;
```

One-off events stay exactly as they are (no `series_id`). Activities unchanged.

### A2. Materializer (rolling window)
A cron (`materialize-event-occurrences`, e.g. hourly) expands each enabled series
into `explore_items` occurrence rows for a **rolling horizon** (proposed: next
**60 days**), and prunes occurrences that have passed or fall outside
`[dtstart, until]` / `season_json` / `exdate`. Uses an RRULE expander (there is a
well-tested `rrule` JS lib usable from the edge runtime; or a compact PL/pgSQL
expander for the common FREQ/BYDAY cases).

- Idempotent upsert on `(series_id, starts_at)`.
- The interim `advance_recurring_events()` is **retired** once this ships (the
  materializer supersedes it). No fighting: a series' occurrences are derived
  purely from the rule, so re-crawls and re-materializations converge.

### A3. Ingestion change
`web_collector.ts` stops collapsing recurrence to `"custom"`. When the extractor
finds an RRULE (ICS `RRULE`, JSON-LD `eventSchedule`), it writes an `event_series`
row (rule + dtstart + until + exdate) instead of a single dated `explore_items`
row. Non-recurring events keep the current path.

### A4. Read-path / browse behavior (the one real UX decision)
Materializing many occurrences is right for **date-filtered** views ("this
Saturday" = query occurrences in range). But the default **browse** feed must not
show a daily event 60 times.

**Proposed rule:** the browse feed **collapses a series to its single next
upcoming occurrence** (one card, badged "Every Tue · next Jul 14" + next 2–3
dates), while **date-windowed** views (today / this weekend / this week) show the
actual occurrence(s) that fall in range. Implementation: a `DISTINCT ON
(series_id)` collapse in the feed RPC when no tight date window is active; full
occurrences when a window is set.

→ **Decision for you:** confirm "collapse to next occurrence in browse, expand in
date views." (Alternative: always expand — simpler, but noisier browse.)

### A5. Season bounds — the farmers-market answer
Your question: can a weekly series roll past its real end?
- **Interim:** partially guarded (35-day "still-listed" window); a source that
  keeps a stale listing up could still mis-roll. Documented risk.
- **Durable:** **impossible by construction.** The materializer only generates
  occurrences within `[dtstart, until]` (RRULE `UNTIL`/`COUNT`) and within
  `season_json` if present. A May–Nov market has `UNTIL=2026-11-30` (or
  `season_json {start:"05-01", end:"11-30"}`), so **zero occurrences exist
  Dec–Apr** — it simply has no upcoming card and disappears until spring. No
  roll-forward hack, no off-season ghosts. Where a feed omits UNTIL, we fall back
  to the season window; where neither exists, a 90-day "unconfirmed horizon" cap
  prevents indefinite projection.

---

## Part B — Region / metro model

### The problem
There is **no server-side geo scope** at all. `filter_explore_items` has zero geo
predicates; the only scoping is a client 50 mi gate that's skipped when
`userLocation` is null. Result: cross-metro bleed. Free-text `town` is unusable as
a key (`"Portland"`, `"181 State Street"`, `"6 Raymond St"` all appear).

### B1. Schema — first-class regions

```sql
CREATE TABLE region (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,        -- 'portland-me'
  name          text NOT NULL,               -- 'Portland, Maine'
  center_lat    double precision NOT NULL,
  center_lng    double precision NOT NULL,
  radius_miles  numeric NOT NULL DEFAULT 40, -- or an explicit bbox
  min_lat double precision, max_lat double precision,
  min_lng double precision, max_lng double precision,
  timezone      text NOT NULL DEFAULT 'America/New_York',
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Seed: portland-me, warwick-ny, potsdam-ny.

ALTER TABLE explore_items ADD COLUMN region_id uuid REFERENCES region(id);
CREATE INDEX ON explore_items (region_id) WHERE region_id IS NOT NULL;
ALTER TABLE event_series ADD COLUMN region_id uuid REFERENCES region(id);
```

`region_id` is assigned **at ingestion** by point-in-region (bbox contains, else
nearest active center within radius; else NULL = "unassigned/national", never
shown in a metro feed). Backfill existing rows once (lat/lng → region; the
free-text `town` is a fallback hint only).

### B2. Hard metro boundary (server-enforced)
Add `p_region_id` to `filter_explore_items` / `count_filtered_explore_items` and
apply `AND e.region_id = p_region_id` as a **hard filter**. One region per query,
enforced server-side. Cross-metro bleed becomes impossible regardless of client
state. (The client distance gate stays as a *within-region* proximity sort/filter,
not the scoping mechanism.)

### B3. Region resolution — your layered fallback ladder
Resolve the active `region_id` in this priority order (your call, baked in):
1. **Live GPS** (permitted + available) → nearest active region (within radius).
2. **Last-known GPS** (persisted; the Tier 1 interim already stores it) → nearest
   active region.
3. **User's saved region** (profile / local) from a prior manual pick.
4. **Nothing resolvable → first-run "Pick your city" screen.** Never an unscoped
   feed. The picked region persists (layer 3 thereafter).

If live GPS lands **outside every active region** (e.g. traveling), we still pick
the nearest active region and show a subtle "Showing: Portland" switcher — not an
empty or cross-mixed feed.

### B4. Region switcher + persistence
A header chip ("Portland ▾") lets the user switch region explicitly (travel, or
"what's happening in Warwick this weekend"). Selection persists to their profile
so it's stable across sessions and devices. This is also the multi-city UX: the
switcher lists all active regions.

### B5. Multi-city future
Adding **Boston** = one `region` row + pointing collectors at Boston sources +
(re)assigning `region_id` on ingest. No schema change, no query change, no client
change beyond the region appearing in the switcher. The region row **is** the unit
of expansion the whole data-quality architecture already assumes.

---

## Part C — Ranker impact (Tier 3 autonomy — explicit for your sign-off)

1. **Region scope is a hard PRE-filter, not a score signal.** It runs before
   ranking, so it does not change *relative* order within a region → ~zero ranker
   risk. It only removes out-of-region items (which should never have been there).
2. **Occurrences make TIME_MATCH meaningful.** Today, recurring events carry a
   stale date, so the TIME_MATCH signal is noise. With real next-occurrence
   datetimes, TIME_MATCH (0.12 weight) starts doing its job — a genuine ranking
   *improvement*, but a behavior change worth watching in the feel-test.
3. **Series collapse prevents double-ranking.** The browse feed ranks **one**
   representative occurrence per series (`DISTINCT ON (series_id)`), so a daily
   event can't flood or out-weight one-offs. Notability/quality/distance are
   per-item and unaffected.
4. **Season bounds need no ranker logic** — out-of-season = no occurrence = absent.
5. **Notability floor (2.5) and weights (notability 0.10) are unchanged.** This
   design does not touch `recommenderConfig.ts` weights.

Net: the ranker's *inputs* get cleaner (real dates, no cross-metro noise); its
*weights and math* stay put. I'd wire it behind the existing flag discipline and
watch your feel-test before/after.

---

## Part D — Proposed rollout (after you approve the design)
1. Region model first (smaller, unblocks the hard boundary): `region` table +
   `region_id` + backfill + RPC predicate + client resolution ladder + picker.
   Ship to staging, feel-test, prod-gate.
2. Recurrence model second: `event_series` + occurrence materializer + ingestion
   change + browse collapse. Retire the interim roll-forward. Staging, feel-test,
   prod-gate.
3. Each is independently shippable and independently valuable.

## Open decisions for you
- **A4:** collapse series to next occurrence in browse (recommended) vs always expand?
- **A2:** 60-day materialization horizon OK? (cost vs freshness tradeoff)
- **B1:** radius-based regions (simpler) vs explicit bbox (tighter control)?
- **B3:** when GPS is outside all active regions, nearest-region + switcher
  (recommended) vs force the picker?
- Sequence: region first, then recurrence (recommended) — or together?

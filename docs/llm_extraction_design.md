# LLM-Based Extraction & Venue-Discovery Bridge — Design

**Status:** Draft for review. No implementation yet.
**Author:** Auto-generated as part of Warwick ingestion rollout (May 2026).
**Related:** [web_collectors.md](web_collectors.md), [LLM_ENRICHMENT.md](LLM_ENRICHMENT.md),
[google_places_setup.md](google_places_setup.md),
[EVENT_INGESTION_ARCHITECTURE.md](EVENT_INGESTION_ARCHITECTURE.md).

---

## Context

Phase 2 of the Warwick rollout surfaced that the existing web collector's
DOM extractor only matches a narrow set of markup conventions
(`.event`, `.event-item`, `article.event`, `[itemtype*='Event']`). Of three
sampled high-value Warwick venues — Albert Wisner Library, Storm King,
Bethel Woods — **none** has usable structured data on its index page,
and **none** uses the generic class names the extractor recognizes.

This is not a Warwick-specific issue. It explains why every existing
`collector_targets` row across the catalog has `total_items_collected = 0`
despite the pipeline running for months — the plumbing works, but
extraction yields nothing on most real sites.

Meanwhile, Google Places ingests hundreds of venues (bars, breweries,
restaurants, parks, museums) into `explore_items` with website URLs we
never crawl. A brewery hosting trivia night appears as an *activity*
but never as an *event*, even though its `/events` page would tell us.

The two problems share a solution: **LLM-based extraction over fetched
HTML**, applied to both curated collector_targets AND auto-discovered
Google Places venues.

---

## Goals

1. Extract events from arbitrary HTML regardless of markup convention.
2. Bridge Google Places venue rows to their event content.
3. Preserve curation: hand-picked targets stay first-class with their
   metadata (town, default_category, ignore_patterns, etc.).
4. Bounded LLM cost — target < $25/month at Warwick scale (~500
   crawlable venues).
5. Don't regress: existing structured-data extractors (JSON-LD, ICS,
   RSS) still run first — they're cheaper and more reliable when
   present.

## Non-goals

- Real-time crawling. Everything batches.
- Crawling JS-rendered content. Server-side HTML only, same as today.
- Replacing the enrichment pipeline. We feed the same
  `event_ingest_raw → enrichment_queue → explore_items` path.

---

## A. Schema changes

### New table: `venue_crawl_state`

```sql
CREATE TABLE venue_crawl_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explore_item_id UUID REFERENCES explore_items(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  last_crawled_at TIMESTAMPTZ,
  next_eligible_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  events_found_count INTEGER NOT NULL DEFAULT 0,         -- cumulative
  last_run_events_found INTEGER NOT NULL DEFAULT 0,
  consecutive_empty_runs INTEGER NOT NULL DEFAULT 0,     -- drives backoff
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending',                -- pending | active | backing_off | disabled
  llm_cost_cents_total INTEGER NOT NULL DEFAULT 0,       -- spending cap
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (explore_item_id, website_url)
);

CREATE INDEX idx_venue_crawl_state_eligible
  ON venue_crawl_state (next_eligible_at)
  WHERE status IN ('pending','active','backing_off');
```

One row per (venue, distinct URL). Most venues have one URL; a few have
both a marketing site and a separate ticketing site, both worth tracking.

### Augment `collector_targets`

Add one column:

```sql
ALTER TABLE collector_targets
  ADD COLUMN use_llm_fallback BOOLEAN NOT NULL DEFAULT FALSE;
```

When `TRUE`: after JSON-LD / ICS / RSS / DOM strategies run, if total
candidates `< llm_fallback_threshold` (default 2), call the LLM on the
cached HTML.

We default to `FALSE` so the rollout is opt-in. Migration 12X will
flip it to `TRUE` for the 30 Warwick targets after we validate the
extractor on fixtures.

### Add `parsing_strategy` enum value

```sql
ALTER TYPE parsing_strategy ADD VALUE 'llm';
```

Allows targets to skip DOM entirely and go straight to LLM. Useful for
sites we know are too custom to ever match generic selectors.

### Synthetic `event_sources` row

Auto-discovered Google Places venues need a `source_id` for
`event_ingest_raw`. Reuse one synthetic row:

```sql
INSERT INTO event_sources (name, type, is_enabled)
VALUES ('Auto-Discovered Venue', 'web_collector', TRUE);
```

(Or, equivalently, attach to the existing 'Web Collector' source row and
tag rows in `event_ingest_raw.raw_json._target_kind = 'auto_discovered'`.)

---

## B. Data flow

### Path 1 — collector_targets (existing curated pipeline, augmented)

```
cron → fetch-coordinator → ingest-web-collector
  ↓ for each target ready to run
  fetch discovery URLs (existing logic)
  cache HTML (existing logic)
  for each cached page:
    extract via jsonld → ics → rss → html_dom (existing logic)
    IF candidates < threshold AND target.use_llm_fallback:
      llm_extract(html, target.site_config) → candidates
    insert into event_ingest_raw (existing logic)
```

Single new edge in the diagram: the LLM call. Everything else is
already-written code.

### Path 2 — Google Places venues (new)

```
cron (hourly) → discover-venues-to-crawl
  ↓ enqueues N new explore_items into venue_crawl_state
cron (hourly) → ingest-venue-website
  ↓ for each venue_crawl_state row where next_eligible_at < NOW(),
    up to max_per_run:
  fetch website root, find /events|/calendar links, fetch top 1-3
  cache HTML (reuse collector_page_cache, target_id = synthetic)
  llm_extract(html, hints={venue_name, town})
  for each event:
    insert event_ingest_raw with synthetic source_id
  update venue_crawl_state.{last_crawled_at, events_found_count,
    consecutive_empty_runs, next_eligible_at}
```

`discover-venues-to-crawl` picks from a filtered view of explore_items
(see Section C). It enqueues; `ingest-venue-website` consumes. Decoupling
lets us throttle enrollment separately from crawl pace.

### Shared extractor: `_shared/llm-extractor.ts`

One function called from both paths. Prompt requires structured output
matching this Zod schema:

```typescript
const EventSchema = z.object({
  title: z.string().min(3).max(200),
  starts_at: z.string().datetime().nullable(),
  ends_at: z.string().datetime().nullable(),
  recurrence_text: z.string().nullable(),
  description: z.string().max(500).nullable(),
  price_text: z.string().nullable(),
  source_url_path: z.string().nullable(),  // relative or absolute
  title_evidence: z.string().min(3),       // verbatim snippet for hallucination check
  date_evidence: z.string().nullable(),    // verbatim snippet
});
```

The `*_evidence` fields force the LLM to quote source text — if it
can't, it must omit the event. This is our primary anti-hallucination
control (see Section E).

---

## C. Which Google Places venues to crawl

### Filter rules

**Exclude** (no events ever):
- `sub_category` matches: `gas_station`, `pharmacy`, `atm`, `bank`,
  `post_office`, `hospital`, `dentist`, `lawyer`, `accounting`,
  `insurance_agency`, `real_estate_agency`, `car_repair`, `car_dealer`,
  `lodging` (covered by auto-suppress in migration 095)
- **`is_chain` = TRUE** (per migration 130). Chain venues stay in the
  catalog so users can search/locate them, but the Phase 5.3 bridge
  never crawls their websites — extremely low event probability per
  location and high LLM-budget cost relative to yield. Use
  `is_chain_override = FALSE` to opt a specific chain location back in
  (e.g., a Whole Foods location with regular cooking-class programming).

**Include if `website_url IS NOT NULL` AND `relevance_tier >= 2`**:
- `bar`, `night_club`, `brewery`, `winery` — frequent events
- `restaurant`, `cafe` — occasional (live music, trivia)
- `gym`, `yoga_studio`, `dance_studio` — recurring classes
- `museum`, `library`, `art_gallery` — high-yield programming
- `park`, `campground` — seasonal (concerts, family days)
- `movie_theater`, `bowling_alley` — special events
- `book_store`, `tourist_attraction` — occasional readings/festivals

Estimated count in Warwick 50km radius: **~500 venues** post-filter
(the chain filter typically drops another 5-12% on top of the
sub_category exclusions).

### Why `relevance_tier >= 2`

`explore_items.relevance_tier` (migration 094) classifies items as
3=premium / 2=standard / 1=marginal / 0=suppressed based on source
type, confidence, and content completeness. Tier 0–1 rows are too
sparse or low-quality to justify LLM-budget spend; tier 2+ rows have
passed the basic quality gate and are worth crawling.

(The original design proposed a `venue_score >= 3` filter referencing
"migration 118". That column was never built — migration 118 added the
venue-discovery scaffolding, not a per-row score column. `relevance_tier`
is the correct existing anchor.)

### Enqueue query

```sql
SELECT ei.id, ei.website_url, ei.title, ei.town
FROM explore_items ei
LEFT JOIN venue_crawl_state vcs ON vcs.explore_item_id = ei.id
WHERE ei.website_url IS NOT NULL
  AND ei.deleted_at IS NULL
  AND ei.relevance_tier >= 2
  AND COALESCE(ei.is_chain_override, ei.is_chain) = FALSE
  AND ei.sub_category NOT IN (
    'gas_station','pharmacy','atm','bank','post_office',
    'hospital','dentist','lawyer','accounting','insurance_agency',
    'real_estate_agency','car_repair','car_dealer','lodging'
  )
  AND vcs.id IS NULL
ORDER BY ei.normalized_confidence DESC NULLS LAST
LIMIT $1;
```

---

## D. Cost projection

**Claude Haiku 4.5 pricing** (current as of writing):
- Input: $0.80 / MTok
- Output: $4.00 / MTok

**Per-crawl token usage** (estimate, will validate in 5.1):
- Input: 10KB HTML truncated → ~3,000 tokens
- Output: structured JSON for ~5 events avg → ~500 tokens
- Per crawl cost: `(3000 × $0.80/1M) + (500 × $4.00/1M)` = **~$0.005**

### Cadence options

| Cadence    | 500 venues × runs/mo × cost | Monthly total |
|------------|------------------------------|---------------|
| Weekly     | 500 × 4 × $0.005             | **$10**       |
| Bi-weekly  | 500 × 2 × $0.005             | **$5**        |
| Monthly    | 500 × 1 × $0.005             | **$2.50**     |

Plus curated `collector_targets` LLM fallbacks: 30 × 4 × $0.005 = **$0.60/mo**.

### Recommendation: weekly cadence with backoff

- Initial cadence: weekly (7-day interval).
- After 2 consecutive empty runs: drop to bi-weekly.
- After 6 consecutive empties: monthly.
- After 12 consecutive empties: disable.
- Re-enable any disabled venue if a content-hash diff is detected on
  a lightweight HEAD/GET probe.

### Per-venue spending cap

`llm_cost_cents_total > 100` (= $1/year) triggers a pause for review.
Catches accidental hot loops, paginated event pages that 10x token use,
etc.

### Global cap

`api_usage_counters` row for `anthropic` service with monthly limit
(start at $25/mo to bound risk). `ingest-venue-website` checks before
each call.

---

## E. Failure modes

### 1. ToS / legal

We crawl public HTML, respect robots.txt, rate-limit politely (~6s
between requests, 10 req/min default), and store derived event data
attributed back to the source venue. The risk profile is similar to a
focused search-engine crawl. Mitigations:

- Per-venue opt-out table (`venue_crawl_blocklist` — domain or URL).
- LLM prompt explicitly says "extract only events with publicly-listed
  dates and titles — do not extract paywalled or members-only content."
- No commercial republishing; events surface in the user's regional
  explore feed with a link back to the source page.
- Disable any venue on first cease-and-desist email.

### 2. Anti-scraping (Cloudflare challenge, JS-only, 403)

Today's collector already fails silently on these (404 or fetch error).
Same path here: bump `consecutive_errors`, exponential backoff, disable
after 5 consecutive errors. We don't attempt to evade — that's an arms
race we lose.

### 3. LLM hallucination

**Primary control:** the schema requires `title_evidence` and
`date_evidence` — verbatim snippets from the page. Post-extraction we
verify these substrings exist in the source HTML. If they don't, the
extraction is rejected.

**Secondary controls:**
- Date must parse to a real future timestamp (or recurring pattern with
  a future occurrence). Past-only events get filtered.
- Sample 10% of extractions per week for human review (Phase 6
  monitoring dashboard surfaces these).
- Track extraction → enrichment → publication funnel per venue; if a
  venue's extractions never become published events, pause it.

### 4. Stale "Events" pages

The backoff schedule (Section D) handles this. A page that hasn't
changed in months will get crawled progressively less often. We detect
"hasn't changed" via the existing `collector_page_cache.content_hash`
infrastructure — no new code needed.

---

## F. Relationship to collector_targets

**Run alongside, share extractor.** Reasoning:

- `collector_targets` carries hand-curated metadata we don't want to
  lose: `town`, `venue_name`, `default_category`, `content_types`,
  civic `ignore_patterns`. Google Places venues lack these.
- Some curated targets aren't Google Places (Sugar Loaf Guild,
  Warwick Historical Society, Black Bear Film Festival). We'd lose
  them if we deprecated the curated path.
- The two paths feed the same extractor and the same
  `event_ingest_raw` queue, so downstream stages don't care which
  source provided the candidates.

In practice: `collector_targets` becomes "high-priority, curated,
hand-tuned targets that always get crawled at the configured cadence."
Google Places bridge becomes "the long tail of venues we discover via
geographic ingestion."

If LLM extraction consistently outperforms the DOM extractor (likely),
we could deprecate the DOM path eventually — but no urgency. Run them
together for at least one quarter to compare quality.

---

## G. Rollout plan

### 5.1 — Build the extractor (1–2 days)
- New file: `supabase/functions/_shared/llm-extractor.ts`.
- Claude Haiku call with structured-output schema (Zod).
- Hallucination check: verify `*_evidence` substrings present in source HTML.
- Test fixtures: 10 hand-saved HTML snapshots from real venues
  (Bethel Woods, Storm King, Albert Wisner, Drowned Lands, Pennings,
  + 5 others), each with expected event JSON. Stored in
  `supabase/functions/_shared/__fixtures__/`.
- Unit test in `scripts/` that runs extractor over fixtures and asserts
  recall ≥ 80% / precision ≥ 90%.

**Stop gate:** if recall < 60% on fixtures, abandon LLM approach and
re-spec.

### 5.2 — Integrate into existing collector pipeline (0.5 day)
- Modify `ingest-web-collector` to call LLM fallback when
  `target.use_llm_fallback = true` AND DOM yields `< 2` candidates.
- Migration: set `use_llm_fallback = true` for 5 hand-picked Warwick
  targets known to have rich event content (Bethel Woods, Storm King,
  Albert Wisner, Drowned Lands, Sugar Loaf PAC).
- Smoke test: invoke each, verify events surface in `event_ingest_raw`.

**Stop gate:** if any of the 5 produces 0 events after LLM call, debug
before broadening.

### 5.3 — Build Google Places bridge (1 day)
- Migration: create `venue_crawl_state` + indexes + the synthetic
  event_sources row.
- Edge function: `discover-venues-to-crawl` (enqueues from filtered
  explore_items into venue_crawl_state).
- Edge function: `ingest-venue-website` (claims from
  venue_crawl_state, fetches, extracts, queues).
- Cron: both run hourly, separately.

### 5.4 — Concentric-circle rollout
- **Week 1:** Enable for 10 hand-picked Warwick venues with known good
  websites. Manually inspect every extraction. Verify cost projections.
- **Week 2:** Scale to 100 Warwick venues. Watch
  `llm_cost_cents_total`, error rates, extraction → published-event
  conversion.
- **Week 3:** Scale to full 500 Warwick venues if Week 2 metrics are
  healthy.
- **Week 4+:** Expand to Potsdam catalog (similar ~500 venues).

**Kill switches:**
- `api_usage_counters.requests_used > requests_limit` → halts new LLM
  calls for the month.
- Any week with > $50 spend → pause new enrollments, investigate.
- < 10% of LLM extractions becoming published events after a 2-week
  observation window → pause, re-tune prompt or rethink approach.

### 5.5 — Civic-meeting classifier (Phase 4 follow-up, deferred)
Once we have LLM extraction in place, the civic-meeting classifier
(originally Phase 4) becomes a second prompt over the candidate text
rather than a regex filter. Re-spec at that point — likely smaller
than its original Phase 4 scope because the LLM extractor already
captures structured fields we can classify on directly.

---

## Honest unknowns

Things this design assumes that we should validate in 5.1:

1. **Token estimate per crawl.** 3K input / 500 output is a guess.
   The 10 fixtures will give us a real number. If actual is 3x higher,
   monthly cost is $30 not $10 — still affordable but worth knowing.
2. **Recall on real-world HTML.** Fixtures are the test. If Claude
   Haiku struggles below 60% recall, we either upgrade to Sonnet
   (~5x cost, $50/mo target) or accept the lower yield.
3. **Multi-page event sites.** Sites where /events lists titles but
   detail pages have dates are the hardest case. Section B says
   "fetch top 1-3 candidate pages" — but selecting *which* sub-pages
   to fetch is itself a sub-problem (LLM-driven? regex on link text?).
   Validate during 5.1 with fixtures that include multi-page sites.
4. **The synthetic source row pattern.** Google Places venues
   contributing events back to the same `explore_items` row they
   live on creates an interesting cycle. The normalization pipeline
   should handle this, but worth a careful read of
   `normalize-raw-events` before 5.3.

---

## What this design does NOT solve

- JavaScript-rendered event calendars (LibCal widgets, React SPAs).
  Out of scope — would require headless browser, separate project.
- Social-only venues (Tuscan Cafe, Ochs Orchard from migration 128).
  Still need scrapable web surface.
- Real-time event updates. Cron-driven, batched.
- Sites that explicitly block bot traffic. We respect that and move on.

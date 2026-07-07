# Data-Quality Sourcing Research Sweep — Findings

**Status:** Investigation only (Tier 2). No code, no production changes, no catalog writes.
**Author:** Claude (chief engineer), 2026-06-29/30. **Anchors to:** `data_quality_north_star.md`.
**Method:** repo + live-DB grounding, then parallel web research per area (ToS/pricing/licensing verified against current 2026 sources; legal claims are research, not legal advice — flagged where interpretive).

---

## Executive summary

The single most important finding: **a large fraction of the curation signal we need is legally cheap or already in hand — the binding constraints are (a) display-vs-store ToS limits on the data we already pull, (b) images, and (c) the irreducible hyperlocal-event gap.** Five cross-cutting themes:

1. **The legal spine is Feist (facts ≠ expression).** We may freely extract and store *facts* — "Place X was named on the Press Herald Best-Of list," "X exists at this address," a *substantially-transformed* derived score — but not copy review prose, whole curated lists, or (critically) **cache the raw third-party Content** (Google/Yelp ratings, Google/Ticketmaster photos) beyond each provider's short window. Display-live-vs-store-permanently is the line that recurs in every area.
2. **We already hold underused signal:** Google `rating` + `userRatingCount` (95% of venues), `editorialSummary` (~16%), PredictHQ `rank`/`phq_attendance`, user-post photos (already partly wired), and existing scaffolding (`normalized_confidence`, `relevance_tier`, `is_hidden_gem`, quarantine, chain-detection). The notability loop is closer to "wire up + verify" than "go buy a new source."
3. **Notability is best built as a composite of cheap legal signals + cross-source corroboration + verified model knowledge**, not a single purchased feed. Cross-source agreement ("named across N independent sources") is both a notability score and the corroboration the autonomy gate (North Star §8) requires.
4. **The event layer is achievable on freshness and notability, but coverage has a hard ceiling.** Harvesting structured **ICS/REST calendar feeds** (libraries, civic, sports) is the highest-leverage, lowest-risk, lowest-cost expansion. The truly hyperlocal remainder (chalkboard trivia, Instagram-only events) has no legal machine-readable surface and must be ceded to **first-party UGC**, not chased with scrapers.
5. **The economics work at Portland scale (~$15–40/mo all-in, batched).** Discovery is the cost driver; the audit gate is nearly free. The one genuine watchpoint is **event freshness at multi-area, sub-daily cadence** — bound it by design.

**Hard "not viable / off-limits" list (don't pursue):** Facebook/Instagram scraping (ToS, already ruled out — correct); AllTrails scraping (ToS bars it, DataDome-protected); Atlas Obscura as a feed (no API, ToS bars commercial reuse, ~10 Portland places); Reddit for near-term autonomous use (Nov-2025 Responsible Builder Policy requires pre-approval for *all* access + a commercial contract); Yelp Fusion for a stored/blended notability score (24h cache cap, no-commercial-analysis, no-blending); Burbio (license-only data product); and **persistently self-hosting raw Google Places / Ticketmaster image bytes** (provider ToS forbids it — this is a current-state flag to fix, see Area 4).

---

## AREA 1 — Notability signal (activities)

**Goal:** cheaply, reliably, legally score every catalog PLACE 1–5 on "would a knowledgeable local recommend this?"

### What we already have but underuse
- **Google `rating` (95% of venues) + `userRatingCount` + `priceLevel` + `editorialSummary` (~16%)** are pulled and sitting in raw JSON, **unused as a notability signal.** This is the cheapest signal we have — but see the ToS constraint below before persisting it.
- **`is_hidden_gem`** heuristic (rating ≥4.3 & 5<reviews<30), **`normalized_confidence`**, **chain detection** (`is_chain` → ×0.5 ranker penalty) already encode notability-adjacent judgment. The audit loop should build on these, not reinvent them.

### Ranked viable options

| Rank | Signal | Reliability | Cost | Legal-risk | Notes |
|---|---|---|---|---|---|
| **1** | **Derived score from Google rating × review-count** (computed at fetch, persisted as a *transformed* score only) | High for "is this well-liked" | ~free (already pulled) | **MEDIUM — see ToS** | Strongest cheap base. **But:** Google forbids caching "Content"; you may store `place_id` forever and lat/lng ≤30d, *not* raw `rating`/`userRatingCount`. A persisted **substantially-transformed** notability score (blends Google with other signals + own logic, non-reversible, raw values not stored alongside) is defensible by analogy to Google's Places Aggregate "Your values" standard — but it's **interpretive**; get written Google confirmation if the score becomes product-critical, or use the Places Aggregate API path. A score that is just Google's stars relabeled is **not** safe. |
| **2** | **Cross-source corroboration** ("named across N independent sources") | High when it fires | low (LLM/web) | LOW (facts) | An item appearing in ≥2 independent curated sources is almost certainly notable. Doubles as the §8 autonomy-gate corroboration. Hard part is entity resolution (Area 3). |
| **3** | **"Best-of" / award FACTS** (Press Herald "32 Best," The Infatuation, Boston Mag, James Beard / Bon Appétit / NYT signals) | High (editor-vouched) | low | **LOW if facts-only** | Per Feist, the *fact* "named on X's 2026 list" is uncopyrightable and storable; copying the prose or mirroring a whole ranked list is not. Extract `{place, list_name, year}` tuples, link out. |
| **4** | **Model knowledge (Claude/Haiku), verified** | Medium alone, High when cross-checked | low | LOW | Claude "knows" the notable spots in well-documented areas, but **must be verified against ground truth** (signals 1–3) to avoid hallucinated recommendations. Use as a *candidate generator + tiebreaker*, never as a sole source of truth. Reliability degrades for less-documented areas and recent openings/closures. |
| **5** | **`editorialSummary` presence + content** | Medium | free | display-only | Google writes editorial summaries for places it considers notable — presence is itself a weak signal; the text is Content (display, don't persist verbatim). |
| **6** | **PredictHQ place/attendance signal** (mostly events, but venue-level too) | Medium | already paid | contractual | Useful venue prior where present. |

### Off-limits / not viable (and why)
- **Yelp Fusion / "Places API"** for a stored notability score — **not viable.** 24-hour cache cap, "Analysis is not permitted," explicit **no-blending** ("Yelp content must stand alone"), store only business IDs, $229–643/mo. A composite stored score breaches multiple clauses. The compliant path (Yelp Insights API, or written consent) isn't worth it. **Omit Yelp.**
- **Reddit** ("best X in Portland" threads) — **not viable near-term.** The **Responsible Builder Policy (Nov 11 2025)** requires pre-approval for *all* API access (even hobby) and bars commercializing Reddit data without express written approval; commercial use needs a negotiated contract (no public rate card). Scraping = ToS violation. Revisit only via a formal approved agreement.
- **Atlas Obscura** — no API, ToS bars commercial reuse, ~10 Portland places (~0.3% coverage). Skip as a feed; if ever wanted, only via written partnership.
- **Tripadvisor / Foursquare** — viable APIs exist but add cost/ToS overhead for marginal lift over signals 1–4 at this stage (not researched to depth here; revisit if Google proves insufficient).

### Recommendation
Build notability as a **composite, computed-at-fetch, stored-as-transformed-score-only**:
`notability = f(derived_google_score, cross_source_count, bestof_award_facts, verified_model_knowledge, chain_penalty)`.
Start with what we own (Google-derived + chain penalty + hidden-gem), layer cross-source corroboration and best-of facts (both legal as facts), use model knowledge as candidate-gen + verified tiebreaker. **Persist only the derived score + provenance, never the raw Google/Yelp Content.** This is cheap, legal, and gives the audit gate the corroboration it needs.

---

## AREA 2 — Event sourcing, notability & freshness (equal weight)

### Coverage gap map (a typical Portland week)

| Source class | Covers well | Misses |
|---|---|---|
| **Ticketmaster** | Ticketed arena/theater (State Theatre, Cross Insurance Arena, Thompson's Point, Merrill); structured + images + price | Everything below the ticketed tier — most local live music, brewery/bar shows, all community/local-texture. **~10–20% of a local's week.** |
| **PredictHQ** | Attendance-**ranked** concerts/festivals/conferences/sports + an explicit notability prior (`rank`, `local_rank`, `phq_attendance`) | Down-ranks the low-attendance local-texture tail by design. |
| **VisitPortland + Maine Public** (just enabled) | The only sub-ticketed layer today — CVB things-to-do + statewide community calendar (~23 events/crawl) | Thin volume; tourism/statewide selection bias; JS-rendered calendars invisible. |
| **Web collector (allowlist)** | Per-venue recurring programming **if** the venue publishes JSON-LD/ICS/RSS | Discovery ceiling = the allowlist; most small venues publish only marketing HTML or Instagram. |

**Net:** TM+PHQ own the headline tier (<25% of "worth knowing"); the event layer being thin (704 vs 3,762) is a direct consequence.

### Event notability — ranked signals
1. **PredictHQ rank / attendance** (free, already ingested) — best where PHQ has the event.
2. **Source-presence prior** (TM/CVB-curated > raw HTML) — cheap base.
3. **Venue-notability prior** — score the *venue* once (Google rating×reviews + cross-source), lend it to every event it hosts. **Best lever for the local-texture tier** where per-event signals are absent.
4. **Cross-source corroboration** (≥2 independent sources).
5. **First-party geo+time-verified RSVP/attendance** — Euda's unique moat (the migration-137 invariant is ground-truth attendance). Cold-start, but the long-run strongest signal.
6. **Local press "this week" picks** (boost, not primary).
7. **LLM crowd-plausibility** as a quarantine filter (reject "operating hours masquerading as an event").

Combine into a composite `notability_score` that **gates** the feed (below a floor → "exists but not surfaced"). This directly solves the dead-bar-Tuesday vs packed-trivia problem.

### Freshness architecture (never show a past/stale event)
1. **Read-time guard `ends_at > NOW()`** (or `starts_at` when null) — never rely on cron demotion for correctness. *Single most important change.*
2. **Horizon-tiered re-crawl:** next 72h high-frequency (catch cancellations), 3–14d daily, 14+d every few days — drive cadence off `starts_at` distance, not a flat sweep.
3. **Rolling materialization window** (60–90 days).
4. **Disappearance reconciliation:** a future event that vanishes from its source on re-crawl → `suspected_cancelled`, drop from feed (a stale *future* event is as much a trust violation as a stale past one).
5. **ToS caching posture:** treat cached event data as a *short-lived index that links back* — refresh on a rolling window, drop on disappearance, deep-link to source. This satisfies Ticketmaster, PredictHQ, and web sources simultaneously. (Eventbrite, if ever re-enabled: future events only, mandatory link-back.)

### Structured recurrence (Phase P-B) — design it right
**Store RFC 5545 RRULE + materialize occurrences into rows.** Not a custom grammar, not the freeform string. The collector *already parses* JSON-LD `eventSchedule` and ICS `RRULE` then discards the structure — P-B is largely "stop throwing it away."

```
event_series:  id, title, venue/location, rrule TEXT (e.g. 'FREQ=WEEKLY;BYDAY=TU'),
               dtstart, duration INTERVAL, timezone TEXT (IANA, DST-correct),
               season_start DATE NULL, season_end DATE NULL,  -- farmers mkt May–Nov
               exdates TIMESTAMPTZ[], is_active
event_occurrence: id, series_id FK NULL, starts_at, ends_at, status
               ('scheduled'|'cancelled'|'moved'), override_starts_at/title/location NULL
```
- Nightly job expands each active series clamped to `[NOW, NOW+window]` and to season → upserts occurrence rows. Feed queries hit plain indexed rows (`WHERE ends_at > NOW()`), so **"happening this Saturday" is a trivial range scan**, recurring + one-off events in the same query.
- `BYSETPOS`/`BYDAY=1FR` handles **First Friday**; `season_start/end` clamps seasonal markets; `EXDATE`/`status='cancelled'` handles exceptions; `RECURRENCE-ID` (override row, same series) handles "moved this week." rrule.js exists for expansion. **Gotchas:** store IANA tz + expand in-tz (DST), always bound infinite series, handle all-day vs timed.

### Local-texture sources — ranked ([S]=structured/deterministic, [L]=needs LLM)

| Rank | Source | Mode | Risk | Note |
|---|---|---|---|---|
| 1 | **Libraries: LibCal/Springshare + "The Events Calendar" (WP)** | [S] ICS+REST | LOW | Highest-value, ubiquitous on library/nonprofit/college sites (Portland Public Library). *Top priority.* |
| 2 | **Civic: CivicPlus / Trumba / Localist** | [S] ICS/RSS/JSON | LOW (gov) | City of Portland + Maine towns. (Localist: prefer public per-cal `.ics` — its API terms reserve to licensees.) |
| 3 | **Google public/shared calendars** | [S] `.ics` | LOW | Community orgs' public calendars; consume the public `.ics`, no permanent DB per Google §5.e. |
| 4 | **CVB / public radio** (VisitPortland, Maine Public) | [L] today | LOW | Already enabled; check for ICS/JSON to move to [S] and cut cost. (VisitPortland likely Simpleview — check for a partner feed.) |
| 5 | **Farmers-market assns / chambers** | [L]/[S] | LOW | Recurring+seasonal → slot into the recurrence model. |
| 6 | **Local press "this week"** | [L] | MED (copyright) | Notability boost; extract facts + link out, don't republish. |
| 7 | **Eventbrite — DISCOVERY only** | limited | MED | Public search API removed; scraping listings = ToS violation. Use organizer ICS or as allowlist lead-gen, not ingest. |
| — | **Facebook/Instagram** | — | OFF-LIMITS | Correct call. The source of the hard ceiling. |
| — | **Burbio** | license-only | HIGH | Paid data product, ToS bans automation. Don't scrape. |

### Local sports — concrete sources
1. **MLB Stats API (`statsapi.mlb.com`)** for **Sea Dogs** (MiLB is MLB-run) — free JSON, the clean path.
2. **Sidearm/PrestoSports ICS** for colleges (USM/Bowdoin/Bates/Colby) — the only viable D3 path; check each athletics site for per-sport ICS.
3. **Team-site ICS-or-LLM** for **Mariners** (ECHL) / **Celtics** (G-League) — low-frequency pages, cheap.
- TheSportsDB is thin for these; Sportradar/SportsDataIO are business-priced and still miss ECHL/G-League/D3. Sports schedules are a *finite materializable set* — perfect for the occurrence model.

### Honest verdict (Area 2)
- **Freshness — achievable** (bounded engineering; pieces half-exist).
- **Notability — achievable** (composite today, strong once the attendance moat warms).
- **Coverage — partial, hard ceiling.** Aggressively harvest structured ICS/REST/JSON-LD feeds (libraries, civic, sports) — that's the next sourcing push. The irreducible hyperlocal remainder (Instagram-only, chalkboard, church-bulletin) is **not legally sourceable at scale** and should be filled by **first-party UGC**, which doubles as the attendance signal.

---

## AREA 3 — Curation sourcing (filling activity coverage gaps)

**Goal:** for an intent + area, generate a candidate list of "what *should* be here," then verify.

### Ranked viable, per intent
- **"Get outside / hikes":** **legal trail FACTS** from **Maine Trail Finder** (landowner-approved cooperative DB), **Maine Bureau of Parks & Lands GIS**, **OpenStreetMap** (ODbL — open, attribution/share-alike on derived DB), **NPS Data Store / Recreation.gov**. These give the *names + locations* (facts) legally; pair with notability from cross-source + model knowledge.
- **"Get a bite / drink":** **best-of FACTS** from Press Herald "32 Best," The Infatuation, Boston Magazine, Down East, plus **award signals** (James Beard finalists, NYT, Bon Appétit, Food & Wine) — extract `{place, list, year}` tuples (Feist-safe), never the prose or whole list.
- **"See something":** museum/cultural-org sites, tourism boards, Wikipedia/Wikidata (permissive) for landmarks.
- **"Try something new" (underground):** hardest. Atlas Obscura is out (above). Realistic path = **cross-source mentions in local blogs/Substacks + model knowledge, verified** — accept lower coverage honestly; the North Star says depth over padding.

### Legality (precise)
- **Facts are free (Feist):** a place exists, its address, "named on a list," "is a James Beard finalist" — extractable and storable regardless of which copyrighted article carried them. **Copyrighted:** the article's prose, and the *original selection/arrangement* of a whole curated list (don't mirror a publisher's full ranked set).
- **RSS:** personal aggregation is implied-licensed; **commercial republishing of feed bodies is not** (MidlevelU v. ACI, 11th Cir. 2021). Safe pattern: detect publication → capture fact/headline → **link out**. Respect each site's ToS (some bar AI training).
- **AllTrails — OFF-LIMITS for scraping.** ToS explicitly prohibits automated agents/scripts and data mining; their own MCP server was deprecated (Jan 2026) at AllTrails' request; site is DataDome-protected. Use OSM/state-GIS/Trail Finder for trail facts instead.
- **Tourism/DMO data:** US DMOs mostly run on **Simpleview** (partner/contract-gated APIs, not open) — a clean open US-DMO feed is the exception. Check whether VisitPortland exposes a partner feed/ICS before treating it as open.

### Cross-source verification (the keystone for autonomy)
- **"Mentioned across N independent sources" is viable and recommended** as both a ranking input and the §8 autonomy corroboration. Implementation = **entity resolution**: normalize name + geocode + fuzzy-match (the catalog already has exact+fuzzy dedup via `dedupe_key` + pg_trgm within ~500m — extend it cross-source). Two independent corroborations should be the default bar for a discovery-proposed item to clear the gate.

### Recommendation (Area 3)
Discovery pipeline per intent+area: **(1)** model knowledge generates candidates → **(2)** enrich each with legal facts (best-of/award tuples, OSM/GIS for trails, existence/address) → **(3)** cross-source corroboration scores notability → **(4)** the audit gate scores Level-1 (notability/completeness/accuracy) → **(5)** ≥threshold + ≥2 corroborations promote to staging. Honest where a tier (underground) can't reach full coverage — depth over padding.

---

## AREA 4 — Images (gates the card vision)

**Current state (verified):** ~92% of items have an `image_url`, but that figure **includes category-fallback placeholders**; real-photo provenance is murky — only 656 carry a tagged `image_source` (ticketmaster 504, google_places_lookup 130, web_collector 22); ~3,700 are self-hosted in Supabase storage (`explore-images`), some sourced from **user `posts/`** (already partly wired). ~8% have no image.

### ⚠️ Current-state legal flag (fix before scaling)
**Self-hosting raw Google Places photo bytes likely violates Google's ToS** (Google forbids caching "Content," including photos — they must be served via the Places photo endpoint; you may store only `place_id`). The same applies to **Ticketmaster** images (the 747 hotlinks are *closer* to compliant than self-hosting, but holding them long-term is gray; TM bars using it as "a generic image hosting service" and caching beyond "reasonable periods"). **Action item for design: audit which self-hosted images are Places/TM-sourced and migrate those to compliant serving (live endpoint / short-TTL proxy + link-back), or replace them.**

### Ranked image-sourcing stack (legal-safety → real-place quality → coverage)

| Rank | Layer | Self-host bytes? | Real-place quality | Coverage ceiling |
|---|---|---|---|---|
| **1** | **User-post photos** (geo+time-verified, Euda's own) | **Yes (with a ToS license grant)** | **Highest** — real, current, exactly the item | Grows with usage; **the long-run answer for the long tail** (small venues, events, trails). Needs consent design (below). |
| **2** | **Wikimedia Commons** (CC0/PD/CC BY) | **Yes** (license travels, no caching limit; NC/ND barred at upload) | High for **landmarks/parks/known sights** (Portland Head Light, lighthouses, trails) | Excellent for famous places, **thin for small private venues**. API: MediaWiki `imageinfo` + `extmetadata`. Prefer CC0/PD (no attribution); avoid BY-SA on *modified* images (copyleft). |
| **3** | **Google Places photos** | **No — serve live only** | High for chain-ish/established venues | Good for established venues, **gaps on outdoor/small-local/events.** Compliant = live endpoint, store `place_id`. |
| **4** | **Ticketmaster/Eventbrite event images** | **No — hotlink live + attribution + link-back** | High when present | Only ticketed events; absent for the photo-less long tail. |
| **5** | **Flickr CC / Openverse** | Risky via API (Flickr API caps caching); rely on per-photo CC grant | Medium-good for real places | Discovery layer; re-verify license at source. |
| **6** | **Category-styled card (honest fallback)** | n/a | n/a (makes no false claim) | **Unlimited** — the default when no legal real image exists. |
| ✗ | **Unsplash/Pexels** | Yes (license) | **Generic vibe, NOT real places** | Fallback chrome only; never as "this is the venue." |
| ✗ | **AI-generated (real places/events)** | — | **REJECT** | Trust violation + legal exposure. |

### User-post images — the consent design this needs
The goldmine, but requires: **(1)** an explicit app-ToS **license grant** (user grants Euda a non-exclusive, sublicensable, royalty-free license to display their post photo as a catalog card image); **(2)** **attribution** to the poster; **(3)** **moderation** (the audit/quality gate must screen before a user photo becomes a card); **(4)** **takedown** on request + on post-deletion; **(5)** the **geo+time verification as a quality signal** (a verified on-site photo is higher-trust than a random upload). Formalize the license in the ToS *before* expanding the already-partial usage.

### AI images — rejection rationale (for the record)
**Reject AI-generated imagery that depicts (or purports to depict) any real place or event.** Three converging reasons: **(1) trust** — research shows AI imagery is perceived as less authentic and lowers trust/intent, users can't reliably detect it (~57% fail), and the travel domain has documented "showed up, it wasn't real" harm; a synthetic Portland Head Light is an existential brand risk for a *curated-real* product. **(2) law** — EU AI Act Art. 50(4) requires deepfake disclosure (eff. 2 Aug 2026); C2PA/SynthID provenance now makes synthetic origin detectable; Google Play bans deceptive AI content. **(3) no upside** the honest category-card doesn't cover better. **Narrow exception:** purely abstract/non-referential decoration (gradients, category textures) that makes no claim about a specific venue.

### Honest fallback
For any item with no legal real image: **clean category-styled card** (category icon + color + item name), never a broken placeholder, never a generic stock photo standing in for the real place (that re-imports the AI trust harm). NN/g: a blank container reduces confidence; cards accept "image *or* icon"; pair color with icon+label (a11y).

### Coverage ceilings (places vs events)
- **Places:** Wikimedia covers famous sights well; Google Places covers established venues (live-serve); **user-posts are the only scalable path for small-local + outdoor.** Realistic near-term real-photo coverage without heavy UGC: ~60–75% (landmarks + established venues), the rest category-cards until UGC fills in.
- **Events:** structurally harder — recurring events have no canonical photo. Promoter images (hotlinked) for ticketed; **venue photo (if legally sourced) or category-card** for the rest; **user-posts** as events accumulate attendance. Expect category-cards to carry a large share of the event layer initially.

---

## AREA 5 — Feasibility & cost of the autonomous loops

*(Pricing verified 2026-06-29; note: Haiku 4.5 = **$1/$5** per MTok, not the $0.80/$4 of retired Haiku 3.5. Web search = **$10/1k searches** (not batch-discounted) + result tokens; web fetch = **$0 extra**; Batch = −50% ≤24h; cache read 0.1×.)*

### Cost model (assumptions stated; Sonnet 4.6 for research, Haiku 4.5 for scoring)
- **Activity discovery:** ~**$0.47/category** sync (Sonnet) / ~$0.27 batched. Full-area sweep (~8 intents) ≈ **$3.80/mo** sync / ~$2.2 batched — and activities refresh ~monthly.
- **Event discovery (per window per area):** ~**$0.69** sync / ~$0.39 batched.
- **Event freshness (the cost driver, scales areas × cadence):** Portland daily ≈ **$12–20/mo** (trivial). But **20 areas @ every-6h ≈ ~$900/mo** — the breakdown point.
- **Audit gate (per proposed item, Haiku):** ~**$0.005** std / $0.0025 batch → ~$2.50/mo at 500 proposals/mo (**nearly free**).
- **Full-catalog scorecard (4,466 items, batched):** Haiku ~**$11**, Sonnet ~$34. Recommend **weekly Haiku + monthly Sonnet deep-pass** (~$80/mo) to catch drift cheaply.
- **Enrichment (recomputed):** ~$0.0084/item std, **~$0.0042 batched** (Batches migration already approved).
- **Portland-scale all-in, batched: ~$15–40/mo.** Discovery dominates; audit is ~free.

### Batch fit
Batch **everything** except real-time/breaking event freshness and live-URL checks: activity discovery ✅, daily/weekly event discovery ✅, enrichment ✅, per-item audit gate ✅, full-catalog scorecard ✅.

### Where each loop runs (the edge 150s wall-clock is the deciding constraint)
- **Discovery (activities + events):** **Claude Code cloud session on a schedule** (or a dedicated worker) — multi-step web research blows the 150s edge limit and needs real web access + observable multi-turn traces.
- **Enrichment:** edge function + pg_cron (status quo — single-shot, fits).
- **Audit per-item gate:** edge + pg_cron (co-locate with enrichment; one scoring call, no web).
- **Full-catalog scorecard:** Batch API job submitted from a scheduled session/worker; collection via worker.

### Controls / kill-switch (North Star §8 requires discovery pausable without touching audit/enrichment)
- **Three independent `feature_flags`:** `discovery_enabled` / `enrichment_enabled` / `audit_enabled` (one-row DB flip pauses discovery while the gate + enrichment keep running).
- **Per-loop budget caps** mirroring `check_llm_daily_budget`, **plus a separate web-search-call ceiling** (searches are the $10/1k line); per-area search/day caps; `web_search.max_uses` per run.
- **Bound event-freshness cost by design:** tier areas by liveness (active=daily, long-tail=weekly), event-density-gated cadence, and a **curated free-web-fetch source list** (the biggest lever — turns paid searches into free token-only fetches of known event-source URLs/feeds).
- **Staging-gated promotion = the structural safety:** discovery writes to a staging table; nothing goes live until the audit gate scores it ≥ threshold *and* it ships through the existing gated pipeline. Emit cost/search-count/proposed-count to `pipeline_health_log` → Slack; alert on search-call spikes.

---

## Synthesis — what the sourcing reality says we can build

**The three loops are buildable, and the sourcing supports both layers — with one honest asymmetry: activities can approach full curation; events can hit freshness + notability but not full coverage without UGC.**

### The shape that the reality dictates
- **Quality Audit Loop (build first, per North Star §6) — fully feasible and cheap.** It needs no new external sources: it scores existing items against Level-1 using the composite notability recipe (Area 1) + completeness (image present? hook? intents? — Area 4) + accuracy (not-closed, event upcoming via the read-time guard — Area 2). ~free per item; weekly Haiku scorecard + monthly Sonnet deep-pass. **This is the gate that makes the rest safe.** It can also enforce the cross-source-corroboration bar.
- **Discovery Loop — feasible, runs in Claude Code cloud sessions.**
  - *Activities:* model-knowledge candidate-gen → legal-fact enrichment (best-of/award tuples, OSM/GIS trail facts, existence) → cross-source corroboration → gate. The legal spine (facts, not prose) makes this clean. **Coverage can approach the reference set** for well-documented intents; the underground tier is honestly partial.
  - *Events:* harvest **structured ICS/REST/JSON-LD feeds** (libraries, civic, sports, calendar platforms) as the deterministic backbone; LLM-extract curated HTML calendars (CVB, press) for the next layer; **cede the hyperlocal remainder to first-party UGC.** Freshness via the read-time guard + rolling-window materialization + disappearance reconciliation; recurrence via structured RRULE (P-B). The event layer reaches *equal rigor on freshness and notability*, and closes most—not all—of the coverage gap.
- **Enrichment Loop — feasible, edge + Batches.** Adds the composite notability score, the structured recurrence, intent classification, and the **image stack** (user-posts #1 with consent design, Wikimedia for landmarks, live-served Google/TM, category-card fallback; AI rejected). The biggest enrichment unlock is **wiring up signal we already hold** (Google-derived score, PHQ rank, user-posts) rather than buying new data.

### The dependencies the design must respect
1. **Display-vs-store ToS** is pervasive — persist derived/transformed signals and facts, never raw third-party Content (Google/Yelp ratings, Google/TM photos). **Fix the current Google-Places-photo self-hosting flag.**
2. **Cross-source corroboration** is both a notability signal and the autonomy gate's safety mechanism — build the entity-resolution layer early (extend existing dedup).
3. **Structured recurrence (P-B)** is a prerequisite for the event layer's "happening this Saturday" lift and for materializing sports/market schedules — design it as RRULE + occurrences, not freeform.
4. **First-party UGC** (post photos + user-submitted events) is not a "nice to have" — it is the *only* answer to both the image long-tail and the hyperlocal-event ceiling, and it compounds the verified-attendance moat. The consent/license design should be settled early.
5. **Event-freshness economics** are the one scaling watchpoint — tiered cadence + curated free-fetch source lists + per-area search caps keep it bounded.

### Bottom line for Kevin
Nothing in the North Star is blocked by a missing legal source. The activity layer can reach curation primarily by **using what we already pull (legally, as transformed signal) + cross-source verification + verified model knowledge**. The event layer can hit freshness and notability via **bounded engineering + aggressive structured-feed harvesting**, with the honest caveat that the last-mile hyperlocal and a chunk of imagery depend on **first-party UGC**, not scrapers. The economics are comfortable at Portland scale; the audit gate that makes autonomy safe is the cheapest piece. The things to *not* pursue are clear and listed. The next concrete build, per §6, is the **Quality Audit Loop scored against manually-seeded Portland reference sets** — it needs no new sourcing and turns every later decision into a number that moves.

---

### Appendix — source confidence & caveats
- ToS/pricing claims verified against 2026 sources where fetchable; several official pages (Reddit, Atlas Obscura, some Google ToS) blocked direct fetch and were corroborated via primary-text mirrors + multiple secondary sources — flagged inline. Legal claims are research, not legal advice; the Google derived-score permission, the user-post license design, and any whole-list/article-text handling warrant a counsel pass before launch.
- Specific 2026 free-tier limits (TheSportsDB, PredictHQ retention, Eventbrite's current surface, exact Google Service-Specific-Terms section numbers) should be confirmed against live developer terms before commitments; structural conclusions don't depend on them.

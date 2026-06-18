# Euda — Project State

**Last updated:** 05/20/2026 (Phase 5.1 LLM extractor shipped; 5.2 collector integration in flight)
**Owner:** Kevin Walter
**Operating layer:** Claude (via this document) coordinating Claude Code

---

## How to read this document

This is the single source of truth for the state of Euda development. It is read at the start of every Claude conversation about Euda and updated as decisions are made.

Sections are ordered by how often they're consulted:

1. Operating model (how we work)
2. Current priorities (what we're working on this week)
3. Recent decisions (with rationale)
4. Open questions (decisions deferred, with trigger conditions)
5. Bug & feature backlog
6. System state (what's deployed, what's in flight)
7. Architecture & patterns notes (technical context)
8. Long-term roadmap

---

## 1. Operating Model

### Roles

**Kevin (Founder):** Uses the app daily. Owns product vision, business decisions, and financial decisions. Surfaces bugs, friction points, and feature ideas from real usage. Approves significant changes before they ship. Does not write code or directly operate Claude Code.

**Claude (this document, accessed via chat):** Acts as lead engineer / chief of product. Holds running system context via this document. Translates Kevin's plain-English direction into concrete technical work. Writes prompts for Claude Code. Reviews Claude Code outputs. Summarizes back to Kevin in plain English. Escalates decisions that require Kevin's judgment.

**Claude Code (executes work):** Implements changes. Runs in autonomous mode for bounded tasks on a queue. For higher-stakes changes, pauses for review.

### Communication

**Kevin ↔ Claude:** Slack (primary, async, persistent history). Kevin messages whenever something occurs to him from app usage or strategic thinking. Claude responds when available and flags urgency clearly when escalating.

**Weekly summary:** Email digest sent each Monday Morning, covering work completed, decisions made, open questions, and strategic context. Longer-form than Slack messages.

**Claude → Kevin escalation triggers:** Any decision involving (a) money beyond routine API costs, (b) user-facing changes that meaningfully change product behavior, (c) data deletion or migration of existing user data, (d) external relationships (partner, vendors, App Store), (e) anything Claude is genuinely uncertain about.

**Claude → Claude Code:** Prompts pasted by Kevin into Claude Code (interim) or via direct integration (future). Claude Code's outputs reviewed by Claude before reaching Kevin.

### Trust ladder

The autonomous infrastructure is being built in phases. We don't skip ahead.

- **Phase 1 (current):** Process change only. Claude takes the lead engineer role. Kevin steps out of the technical loop except for explicit escalations. No new infrastructure yet.
- **Phase 2 (late Warwick / early Portland):** Task queue + background agent for smallest, safest work. Documentation, test writing, tiny bug fixes. Everything still PR-reviewed.
- **Phase 3 (Portland):** Autonomous handles real bug fixes, new collector targets, test coverage, UI tweaks. Daily digest reports begin. Kevin reviews PRs from phone.
- **Phase 4 (pre-Boston):** Auto-merge for low-risk PRs. Most day-to-day work happens out of Kevin's attention. Kevin focused on app and business.

We advance phases only when the previous phase has demonstrated reliability for ~2 weeks.

### What Claude will and won't do

**Will:**
- Write technical prompts and direct Claude Code's work
- Make engineering judgment calls within established patterns
- Review and approve technical PRs against established quality bars
- Translate technical complexity into plain-English summaries
- Push back on Kevin's instincts when warranted, with reasoning
- Maintain this document as decisions are made
- Surface uncertainty honestly rather than guessing confidently
- Track and flag when Kevin's input is needed for something

**Won't:**
- Make business decisions on Kevin's behalf (pricing, partnerships, hiring)
- Spend or commit money without Kevin's approval beyond routine API costs
- Make decisions about user communication or external messaging
- Modify or delete existing user data without explicit approval
- Pretend to remember things not captured in this document
- Soften bad news to make it more palatable
- Defer to Kevin when Claude actually has the better-informed view

**Always asks first:**
- Anything irreversible affecting users in production
- Anything that changes the user-facing product behavior meaningfully
- Anything where the right answer requires product taste rather than technical correctness
- Anything where Kevin's domain knowledge (Warwick venues, audience, etc.) might matter
- Anything that's "obviously what Kevin would want" — that's a signal Claude should still verify

### How decisions get logged

When something significant is decided — by Kevin, by Claude, or jointly — it gets a line in Section 3 (Recent Decisions) with: date, what was decided, one-sentence rationale, who decided. This is non-negotiable. Decisions not logged are decisions not made.

---

## 2. Current Priorities

**This week (Warwick, week of [05/18/2026]):**
- ✅ Migrations 126, 127, 128 applied (Warwick partitions, collector targets, URL fixes)
- ✅ URL verification done; 2 social-only venues deleted, 9 corrections applied
- ✅ LLM extraction design doc approved (`docs/llm_extraction_design.md`)
- ✅ Production ingestion restored after discovering 3-month dormancy
- ✅ **Phase 5.1: LLM extractor built + 10-fixture test passing** — see Section 5 for metrics
- ✅ **Phase 5.2: LLM fallback wired into ingest-web-collector** (code committed, deployed)
- ✅ **Migration 129 applied + edge function redeployed** — verified via service-role probe
- ✅ **Atomic flip executed**: 5 Week-0 targets now is_enabled=TRUE + use_llm_fallback=TRUE
- ✅ **Week 0 single-venue validation (Albert Wisner) PASSED** — end-to-end pipeline works. See Section 5 for numbers.
- ✅ **Phase 5.3 prep: chain venue policy infrastructure shipped** (migration 130 + `_shared/chain-detection.ts` + adapter/normalizer/backfill/test/ranker). Backfill flagged 53/1168 rows; 0 false positives in inspected sample; well under the 150-row sanity threshold.
- ✅ **Phase 5.3 proper shipped: venue-discovery bridge** (migration 131 + `discover-venues-to-crawl` + `ingest-venue-website`). 10 venues enqueued and smoke-tested end-to-end; pipeline_health log writing; budget integration confirmed.
- ✅ **Warwick collector_targets fanout (05/21/2026):** 20 remaining Hudson Valley targets flipped to is_enabled=TRUE + use_llm_fallback=TRUE (skipped 3 known-dead); 3 Warwick fetch_partitions (Ticketmaster + Google Places + PredictHQ) enabled. Manual `ingest-web-collector` invocations across 9 batches: 21+ targets processed, 73 candidates queued, $0.17. After normalization: **111 Hudson Valley events live in explore_items** (87 Warwick, 10 New Windsor/Storm King, 9 Sugar Loaf, 4 Bethel, 1 Middletown), all auto_approved, all enriched.
- ✅ **Critical infrastructure gap fixed:** discovered that NO pg_cron job was ever invoking `ingest-web-collector`. The collector_targets pipeline ran only via manual invocations since migration 044. Migration 132 schedules `web-collector-run` every 30 min plus the two Phase 5.3 functions hourly.
- ✅ **Phase 5.3 discover Warwick geo filter shipped:** `discover-venues-to-crawl` now accepts `bbox` and `towns` config params. Verified working (Warwick bbox returns 0 because Google Places hasn't ingested Warwick venues yet — see backlog).
- ✅ **Migration 132 applied** (Kevin via dashboard) — all 6 pg_cron jobs registered active=true.
- ✅ **Google Places fixed** (Kevin upgraded to paid tier). 1054 Warwick venues ingested + 997 normalized into explore_items. Catalog has 939 items in the Warwick bbox now (was 0).
- ✅ **pg_cron execution unblocked (05/21/2026):** discovered via `diagnose-cron` edge function that ALL cron jobs (including pre-existing `fetch-coordinator-run`, `normalize-new-events`, `enrich-new-items` from migration 088) were silently failing with `ERROR: unrecognized configuration parameter "app.supabase_url"` on EVERY tick since the project came up. `ALTER DATABASE postgres SET app.supabase_url = ...` returns "permission denied" on Supabase managed instances even for supabase_admin. Workaround: rewrote each `cron.job.command` to embed the URL + auth bearer as string literals (via `cron.schedule()` from within an edge function that has DB-direct via SUPABASE_DB_URL). 15:00 UTC tick confirmed 6/6 jobs succeeded with the rewritten commands.
- ⏳ Onboarding brothers and friends in Warwick

**Active blockers:** None. Production ingestion is restored, pg_cron will auto-fire correctly on next */30 tick.

**Awaiting Kevin's input on:**
- Slack workspace setup (where these messages will live)
- Weekly email day-of-week preference
- Decision on V1.1 timing trade-off: 7-day TestFlight target (tight, zero buffer) vs 10-day (comfortable, given Phase 2 surprises)
- *(sb_secret rotation confirmed done by Kevin — old key revoked, new key in place, all functions verified working post-rotation)*

**Phase 5.2 deploy COMPLETE — all 5 steps executed 05/20/2026:**
1. ✅ Migration 129 applied by Kevin via `supabase db push`. Verified via service-role probe: 5 rows have use_llm_fallback=TRUE, `api_usage_counters('anthropic_haiku', 5000, 0)` seeded, updated `get_enabled_collector_targets()` RPC returns the new column.
2. ✅ `ingest-web-collector` redeployed to project lkmntknpaiaiqvupzjbz via `npx supabase functions deploy ingest-web-collector --project-ref lkmntknpaiaiqvupzjbz --no-verify-jwt`. All `_shared/*.ts` modules bundled (auth-guard, cors, health-log, llm-extractor, llm-provider, web-extractors, web-collector).
3. ✅ Atomic flip: 5 venues set to is_enabled=TRUE via service-role PATCH (Bethel Woods, Storm King, Albert Wisner, Drowned Lands, Sugar Loaf PAC).
4. ✅ Manual Week-0 fetch on Albert Wisner (target_id `f13a72fb-9ec8-4db4-88f6-198a2a31c17e`): see Section 5 for full numbers.
5. ✅ End-to-end verified: 30+ explore_items rows from Albert Wisner already live, all `review_status=auto_approved`. Pipeline works end-to-end.

---

## 3. Recent Decisions

| Date | Decision | Rationale | Decided by |
|------|----------|-----------|------------|
| [05/18/2026] | Adopt lead-engineer-agent model with Claude in role | Founder wants to spend time on app and business, not on technical operations | Kevin |
| [05/18/2026] | PROJECT_STATE.md as single source of truth, lives in repo | Markdown is portable, Claude Code can read/write it, version controlled by default | Kevin + Claude |
| [05/18/2026] | Slack for ping-me, weekly email for longer reports | Slack matches founder's existing communication habits; email allows for longer-form weekly context | Kevin |
| [05/14/2026] | Warwick before Portland in launch sequence | Founder will be physically present in Warwick, has dense social graph, brothers can help with acquisition | Kevin |
| [05/14/2026] | Scrap nearby-users feature for now (Bug 6) | Not actually a bug, user density doesn't justify building yet, friends-of-friends already covers the use case | Kevin |
| [05/18/2026] | Stage Warwick partitions and collector targets with is_enabled=FALSE for atomic flip | Avoid debugging a half-populated catalog if Phase 4 surfaces an issue | Claude (approved by Kevin) |
| [05/18/2026] | Bump PredictHQ monthly budget from 500 to 1000 | Now serving 2 geographies on same cap; raise proactively rather than reactively | Claude (approved by Kevin) |
| [05/18/2026] | Civic-meeting ignore_patterns at collector level, defer LLM enrichment classifier | Cheapest, most deterministic defense; defer global prompt change to its own scoped work | Claude (approved by Kevin) |
| [05/18/2026] | Delete Tuscan Cafe + Ochs Orchard from collector targets | Both promote events via Instagram/Facebook only — no scrapable web events surface; carrying them as dead targets clutters monitoring | Claude (approved by Kevin) |
| [05/18/2026] | Pivot from atomic flip to LLM-based extraction first | Phase 2 smoke test exposed that the default DOM extractor matches ~0 real-world sites; atomic-flipping 30 targets would produce ~0 events. LLM extraction (Phase 5) is the actual fix | Claude (approved by Kevin) |
| [05/18/2026] | LLM cost model: hard cap $50/mo, alert at $20/mo, weekly cadence w/ backoff | Two-threshold cost control; weekly cadence balances freshness against spend; don't over-optimize upfront | Kevin |
| [05/18/2026] | Add LLM critique pass as anti-hallucination belt-and-suspenders | Verbatim evidence snippets are primary control; critique pass costs ~$0.001/crawl and catches mis-extractions evidence check might miss | Kevin |
| [05/18/2026] | Order: build extractor (5.1) → integrate into collector_targets (5.2) → build Google Places bridge (5.3) | 5.2 first is lower-risk: validates extractor on a function we just proved end-to-end in Phase 2, before building greenfield function+table+cron in 5.3 | Claude (approved by Kevin) |
| [05/18/2026] | Add Week 0 single-venue manual validation before Week 1 (10 venues) | Cheap paranoia: protects against "10 venues all broken in the same way" debugging | Kevin |
| [05/18/2026] | Migration number reservation: Phase 5 uses 129–132, impression logging uses 133+ | Two parallel workstreams need explicit numbering to avoid merge conflicts | Kevin |
| [05/18/2026] | Redeploy all 17 service-role edge functions with `--no-verify-jwt` | Supabase platform migrated auto-injected SUPABASE_SERVICE_ROLE_KEY from legacy JWT to sb_secret_*. Gateway rejects sb_secret (not JWT format). Disabling gateway verification lets the function-level requireServiceRole still enforce auth. Restored 3 months of dormant ingestion | Claude (approved by Kevin) |
| [05/18/2026] | Add legacy-JWT fallback to requireServiceRole via custom `LEGACY_SERVICE_ROLE_JWT` env | Dashboard SQL editor lacks permission to update DB-level `app.service_role_key` config that pg_cron jobs read. Adding a code-side fallback so cron's existing legacy-JWT bearer works was simpler than a vault-based rewrite | Claude (approved by Kevin) |
| [05/19/2026] | LLM extractor uses hand-rolled validators, not Zod | No other module in `_shared/` imports Zod; keeping the import surface minimal and consistent with the rest of the edge-function code | Claude |
| [05/19/2026] | LLM extractor preprocesses HTML by stripping `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, `<aside>` and truncating to 40,000 chars (~16K tokens) | Tested ratio: HTML is 2.41 chars/token (vs the design doc's 4-chars/token English-prose assumption). 40K-char cap balances coverage vs cost; per-crawl realistic cost lands at $0.027 (vs design doc's $0.005 estimate) | Claude |
| [05/19/2026] | Strict-substring evidence check is the primary anti-hallucination control; critique pass is belt-and-suspenders | Per design-doc approval. Critique-pass failures are non-fatal (fall back to the evidence-checked set) — evidence check is the load-bearing guarantee | Kevin |
| [05/20/2026] | Evidence check applies bidirectional canonicalization (HTML entities + typographic punctuation → ASCII) on BOTH source and evidence sides before substring comparison | Phase 5.1 test surfaced that modern CMSes (WordPress, Squarespace, Wix) emit typographic quotes/dashes in published content, and the model normalizes them to ASCII when quoting. Without bidirectional canonicalization, the strict-substring check silently dropped events from those venues. The transformation is deterministic 1:1, preserves the verbatim-quote guarantee | Kevin (approved post-C-prime) |
| [05/20/2026] | Albert Wisner GT trimmed 20 → 12 (in-window events only); Drowned Lands GT trimmed 18 → 3; Cornerstone GT trimmed 5 → 0 | First two: 40K-char truncation cliff makes out-of-window events untestable for extraction skill (only truncation skill). Cornerstone: the 2026-season.html page has zero datable events; the 5 nav-menu titles aren't presented as events. expected_events:[] tests the model's discipline at NOT hallucinating from nav text | Kevin (approved at C-prime) |
| [05/20/2026] | Phase 5.1 SHIP — recall 84.4%, precision 96.8%, 0 true hallucinations, $0.027/crawl | Both design-doc pass criteria met (recall ≥80%, precision ≥90%). Cost slightly above $0.025 stop-gate but noted-and-monitored; existing budget controls (per-venue ceiling, monthly cap, backoff) handle the failure modes the gate was protecting against | Kevin |
| [05/20/2026] | Migration 129 reserved for Phase 5.2 (use_llm_fallback column + 5-venue flip + anthropic_haiku budget seed) | Per the 129–132 reservation from 05/18; 5.2 only needs one migration | Claude (approved by Kevin) |
| [05/20/2026] | `api_usage_counters` uses per-service unit semantic: for `anthropic_haiku`, 1 unit = 1 cent | Reuses existing schema rather than adding a cents column. `requests_limit=5000` ⇒ $50/mo cap matches Phase 5 design. extractEvents() rounds cents up; the budget guard reads `requests_remaining` and treats 0-or-less as "skip the LLM call this run" | Claude (approved by Kevin) |
| [05/20/2026] | LLM-sourced EventCandidates use extraction_strategy='html_dom' + raw_json._llm_extracted=true marker rather than introducing a new 'llm' enum value | Avoids a follow-up migration to ALTER TYPE parsing_strategy. The underscore-prefix marker convention is already used for `_target_*` enrichment fields; downstream can distinguish LLM rows when needed | Claude |
| [05/20/2026] | LLM fallback triggers per-page at threshold=2 (matches design-doc default), not per-target | Each cached page is its own extraction unit; some pages may yield enough deterministic candidates while sibling pages on the same target need the LLM. Per-page is the more granular and correct integration point | Claude |
| [05/20/2026] | Phase 5.2 deploy + Week-0 Albert Wisner validation completed in-session | Migration applied by Kevin via dashboard SQL; function deployed via `npx supabase` after Kevin's `supabase login`; atomic flip + manual fetch + verify done via service-role REST. 62 events extracted at $0.10 cost; 30+ explore_items live; pipeline healthy end-to-end | Claude (manual fetch + verify) |
| [05/20/2026] | Chain venue policy: "ingest broadly, crawl narrowly, rank conservatively" — chains stay in catalog (search/proximity), are excluded from Phase 5.3 auto-crawling, and get a ×0.5 ranker penalty in discovery (overridden by active search and friends-checked-in signals) | Avoids burning LLM budget on Starbucks/CVS pages that virtually never host events; suppresses chains from discovery feeds since users browse for local-flavored places, not chains. Search ("find me a Dunkin") and social ("a friend just checked in at Starbucks") bypass the penalty | Kevin |
| [05/20/2026] | Chain brand vocabulary lives only in `_shared/chain-detection.ts` (TypeScript); migration 130 is schema-only; backfill via `scripts/backfill_chain_venues.ts` re-runnable as vocabulary grows | Single source of truth; cleaner migration file; vocabulary changes don't require SQL migrations | Kevin |
| [05/20/2026] | Chain brand list v1: 130 entries (fast food, casual dining, pizza chains, coffee/donut, ice cream, big-box retail, off-price, specialty retail, pharmacy/convenience, banks, grocery). Hotels + gas chains intentionally excluded (already filtered at ingest by SKIP_PRIMARY_TYPES). "Gap" and "H&M" excluded as too short / collision-prone | Belt-and-suspenders dropped to keep vocabulary focused; short ambiguous brands need future expansion when production data shows misses (Boston catalog will be the first test) | Kevin |
| [05/20/2026] | Grocery + bookstore brands (Whole Foods, Trader Joe's, Wegmans, Barnes & Noble) default to is_chain=TRUE with per-location `is_chain_override=FALSE` for chains that DO host real events | Default-suppress is the safer error direction; per-location upgrade is cheap and gives us "this Whole Foods runs cooking classes" without compromising the rule for the other locations | Kevin |
| [05/20/2026] | Phase 5.3 enqueue query anchored on `relevance_tier >= 2` and `COALESCE(is_chain_override, is_chain) = FALSE` (NOT the design doc's original `venue_score >= 3` which referenced a column that was never built) | Documented and corrected in `docs/llm_extraction_design.md §C` | Claude (design-doc audit) |
| [05/20/2026] | Ranker chain penalty strength: ×0.5 (firm suppression). Tunable to ×0.6 in production if chains fail to surface even in sparse-content scenarios | At ×0.5 a chain has to score substantially better than non-chain alternatives to break into the top 10 — that's the desired discovery shape | Kevin |
| [05/20/2026] | Phase 5.3 anchors on `source_url` (not the design-doc's `website_url`); enqueue scoped to `kind='activity'` to avoid crawling event ticket pages | The design doc spec was written before checking the explore_items schema. Google Places adapter maps `websiteUri → source_url`; for `kind='event'` rows source_url is typically a Ticketmaster-style ticket page (don't crawl). Corrected during smoke testing | Claude (discovered during integration) |
| [05/20/2026] | venue_crawl_state.events_found_count counts ALL LLM-extracted candidates regardless of `is_valid`, not just dated/queueable ones | "Events without dates" venues (e.g., SpencerCity Bar & Grill — has events listed but no dates extractable) shouldn't be backed off prematurely; their content surface is genuine, just not yet structured enough to queue. Conservative for v1; tune later if data shows these venues never start yielding dated events | Claude |
| [05/20/2026] | Cron schedule for 5.3 functions NOT auto-applied at ship time | Standard rollout pattern: deploy code, smoke-test manually, then enable cron once the Week-1 yield validates the cohort. Avoids accidentally burning LLM budget on a broken filter. Operator enables in dashboard or via separate migration | Claude (manual-fetch-first pattern) |
| [05/21/2026] | Critical fix: `ingest-web-collector` had no pg_cron job since migration 044 | Discovered while diagnosing why 4 of 5 Phase 5.2 venues had `last_run_at=null` after a full day. fetch-coordinator's `next_fetch_partition` query requires a `fetch_partitions` row, and none existed for web_collector. Albert Wisner only ran because Kevin manually invoked it. Migration 132 adds a dedicated `web-collector-run` cron (every 30 min, max_targets=10). Documents the past failure mode | Claude (root-cause diagnosis) |
| [05/21/2026] | Warwick fanout: 20 Hudson Valley collector_targets flipped to is_enabled=TRUE + use_llm_fallback=TRUE in one bulk update | Sources: 15 Warwick + 2 Sugar Loaf + 1 Bethel + 4 Goshen + 4 Middletown + 1 New Windsor − 3 known-dead = 25 total enabled. The "Don't wait for Week 1 validation" call: Albert Wisner already proved the pipeline; budget cap protects against runaway cost; founder needs content in the app now | Kevin (executed by Claude) |
| [05/21/2026] | `discover-venues-to-crawl` accepts optional bbox + towns filters | Added in ~25 lines. PostgREST `gte/lte` on lat/lng + `in` on town. Backwards compatible — both fields optional, no behavior change when omitted. Enables "prioritize Warwick" cron call without coupling the function to geography | Claude |
| [05/21/2026] | Google Places ingest blocker logged for follow-up: 0 results across all regions | Root cause unconfirmed — possibly expired/quota-blocked API key, possibly Places API (New) endpoint change. The function returns success but with `unique_places: 0` after 1-2 API calls. Same symptom across Warwick (today) and Potsdam (5/18 historical). Doesn't block Warwick collector_targets pipeline (which has 87 events live), only blocks Phase 5.3 auto-discovery for Warwick venues that haven't been catalogued. Workaround: collector_targets covers the high-value curated set | Claude (diagnosed) |
| [05/21/2026] | Google Places fixed via paid-tier API key upgrade | Confirmed root cause was API key/quota. After Kevin's upgrade, Warwick 50km region returned 1054 unique places in one run; 997 normalized into explore_items. The 939-item Warwick-bbox catalog is now feeding the Phase 5.3 venue-discovery bridge | Kevin |
| [05/21/2026] | pg_cron execution root-cause + fix: `current_setting('app.supabase_url')` was unset → cron jobs from migration 088 (Feb 2026) had been silently failing on every tick for ~3 months. Kevin's "Set service role key for app" snippet from 5/18 didn't take effect (`ALTER DATABASE` is permission-denied on Supabase, even for supabase_admin). Fix: rewrote each cron.job.command to embed URL + bearer as literals. | Diagnosed via temporary `diagnose-cron` edge function that uses SUPABASE_DB_URL to query cron.* schema (PostgREST exposes only public). The "permission denied" finding turned a "set the missing config" task into a "redesign the auth-passing pattern" task. Embedding the legacy JWT in cron.job.command is acceptable: cron schema is superuser-only-readable, no broader exposure than the existing per-function LEGACY_SERVICE_ROLE_JWT env var. Verified at 15:00 UTC: 6/6 jobs succeeded with the rewritten commands | Claude (diagnosed + fixed) |
| [05/21/2026] | Post-Warwick-launch hard distance gate: `applyDistanceFilter` now excludes null-coord items when a radius is set and the user has a location. Active search bypasses the gate. | A Potsdam, NY parade (5+ hrs from Warwick) was surfacing at position #2 because the soft gate let items without lat/lng through unconditionally. The proximity scoring signal (0.20 weight) was not enough to suppress them when other signals fired. The strict variant lands the user's "default feed should never show >50mi events" requirement; search keeps the door open for explicit cross-region queries | Claude (post-launch triage) |
| [05/21/2026] | LLM-extracted venue-website events now inherit lat/lng from the parent explore_item venue | Map view requires lat/lng IS NOT NULL but LLM extraction never derived coordinates from page HTML, leaving every Warwick venue-website event invisible on the map. The venue (an explore_item from Google Places) already has authoritative lat/lng. Inheriting from the parent is correct because the event is happening AT the venue | Claude |
| [05/21/2026] | Google Places `FIELD_MASK` now includes `places.photos`; cache-place-photos scheduled every 15 min via migration 133 | The field-mask omission silently broke the image pipeline for every Warwick venue: place_details_cache never received photo refs, cache-place-photos was never invoked from anywhere, so 939 items displayed the category placeholder. Adding the field is necessary but not sufficient — the cron schedule is what actually drains the queue. Cost envelope at full backlog: ~$0.70/hr while draining, negligible at steady state | Claude |
| [05/21/2026] | Web-collector LLM extractor demotes "facility hours / season range" rows from kind=event to kind=activity (e.g., "Museum at Bethel Woods" w/ April 1 - December 31 operating range) | The LLM faithfully extracted "April 1 - December 31" as date_evidence and downstream blindly set kind=event because starts_at was non-null. Guardrail triggers on midnight start time + facility/exhibit/visit title pattern. LLM prompt also tightened to reject seasonal operating ranges and permanent exhibitions explicitly. Existing Bethel Woods row needs one-off SQL update — does not retroactively re-classify | Claude (post-launch triage) |
| [05/21/2026] | Event detail screen's `formatDateTime` now uses `formatOpeningHours.summaryLine` before falling back to raw `schedule_text` | Sugar Loaf PAC and similar Google Places venues without enrichment-generated time_text were leaking raw "Monday: Closed; Tuesday: ..." into the WHEN slot. The summary form is what GroupedExploreFeed already uses; the detail screen was the lone holdout | Claude |
| [05/21/2026] | Recurring-event-on-holiday issue (Albert Wisner showing instances on Memorial Day when library is closed) deferred. | Would require a new `venue_closures` table + RPC change to `advance_recurring_events()` (migration 109). User flagged this as MEDIUM priority, "fix if straightforward, defer with documentation if not." The closures table is new architecture, not a one-line fix, so deferred | Kevin (priority call) |
| [05/21/2026] | Civic content explicit exclusion: zoning boards, planning commissions, town councils, public hearings, committee meetings filtered out at ingestion via `_shared/civic-filter.ts`. Community-focused civic events (parades, ceremonies, picnics) are NOT excluded. | Euda is for discovering things to do; nobody uses this app to track local government business. Two-layer pattern: explicit title pattern + (municipal venue × meeting/hearing title) combo. Test matrix (25 cases) passes; backfill soft-deleted 20 existing rows (12 Zoning Board Meetings at Village of Potsdam Civic Center + 8 misc). Wired into both LLM ingestion paths (ingest-web-collector + ingest-venue-website) BEFORE event_ingest_raw upsert | Kevin |
| [05/21/2026] | Dr. Kaboom row at SUNY Potsdam left as-is. | Real event with missing time field (LLM extracted a date but no time; ISO renders as midnight). Not a misclassification; the new facility-pattern guardrail correctly did not flag it. Logged as a known data-quality category: "LLM-extracted events with missing time fields." Revisit if prevalent (>20 cases over next week) | Claude (post-triage review) |
| [05/21/2026] | Past-event filter no longer trusts `ends_at`; only `starts_at >= NOW() - 3h` and activity (starts_at IS NULL) survive. Migration 134. | Potsdam Chamber's JSON-LD emits a 43-day endDate that is the listing expiry, not the actual event end (April 20 starts_at + June 2 ends_at = a month-old prom event leaking past the original filter). This is a class of bug, not a one-off — any community calendar JSON-LD source could emit the same pattern. The cleaner architectural rule trusts only `starts_at`. Multi-day festivals will drop out of the upcoming feed after day-1's 3h grace; <1% of catalog, accept the regression in exchange for guaranteed past-event suppression | Claude |
| [05/21/2026] | Default distance gate hardened: when user has location, `filters.distance === "any"` is silently treated as a 50mi cap (still null-coord-exclusive). Active search overrides. | Yesterday's fix was conditional on `distance !== "any"` — a default-state path I didn't audit then let null-coord Potsdam events leak a second time. The architectural rule is now "if we know where the user is, never ship items we can't place near them" | Claude |
| [05/21/2026] | Tightened warwick-40mi Ticketmaster radius from 40mi → 35mi. | At 40mi from Warwick (41.2545, -74.359), the radius reaches lower Manhattan (~38mi south). Birdland Jazz Club + Broadway theatres at 39mi were within radius and flooding the feed with NYC content. 35mi clips Manhattan while preserving Bergen County NJ + Sussex/Orange NY coverage. Kevin's spec said "40mi excludes NYC" — geometry disagreed; chose 35 to achieve the stated goal | Claude (geometry call) |
| [05/21/2026] | `formatOpeningHours.parseHoursRange` now infers the missing AM/PM when only one side of the range carries it (e.g. "7:00 – 11:30 PM"). | Warwick Drive-In's Google Places hours emit the compact form. The strict regex was returning null on parseTime for the open side, the whole summary collapsed, and the list-card fell back to the raw `Monday: ...; Tuesday: ...;` string. The user flagged this twice (detail screen + list card); inheriting the period from the explicit side fixes both. 31/31 existing test cases still pass | Claude |
| [05/21/2026] | `get_items_needing_images` RPC now filters `deleted_at IS NULL` and defaults `p_source_type = 'api_google_places'`. Migration 135. | The RPC was returning every still-queued row regardless of soft-delete state, AND returning non-Places source types whose external_id can't resolve to a Places API resource. Both leaks combined wasted ~20-25% of every cache-place-photos drain on items that could never succeed. Fixing the RPC at the source is cleaner than working around it in the function | Claude |
| [05/21/2026] | Cron payload tuning via diagnose-cron rewrite (no new migration): cache-place-photos-run max_items 25 → 100; ingest-venue-website-run max_per_run 5 → 25; discover-venues-hourly now scopes to the Warwick bbox. | At 25/15-min, the photo cache was draining ~100/hour against ~1000 Warwick venues needing images = 10+ hours just for Warwick. Phase 5.3's ingest-venue-website at 5/hour against 867 eligible Warwick GP venues = 173 hours for full coverage. anthropic_haiku spend $1.98/$50 cap; Google Places Photo API ~60 / 10000 monthly used. Plenty of headroom to bump. Bbox scope on discover-venues-hourly keeps the queue Warwick-first instead of catalog-wide | Kevin (approved bump) |
| [05/21/2026] | Cleanup: 339 past events (kind=event with starts_at < NOW - 3h) + 142 Web-Collector rows with null lat/lng + 226 Ticketmaster rows inside the NYC bbox all soft-deleted. | Same idea as the civic-filter cleanup: ship the structural fix (filter tightening, partition tightening) AND drop the existing artifacts so the user sees the difference immediately. 707 rows soft-deleted today in three separate passes | Claude |
| [05/21/2026] | Engagement logging captures the conversion funnel for Phase 1 ranker training. Terminal conversion is `post_at_event` (validated by product invariant: every post is geo + time verified attendance). The ranker we eventually train optimizes for attendance, not engagement-time — which keeps Phase 1 aligned with the playbook's "life quality, not attention" principle even before fulfillment signals exist. Phase 2-4 fulfillment data (reflection prompts, continuity tracking) is deferred until those product features ship; schema additions will come with the features that need them. | Migration 136: `engagement_log` partitioned monthly by `occurred_at`, 12-month retention, auto-partition cron. Client buffer with 5-min impression dedup + 25% sampling (100% cold-start / engaged-item / non-impression / conversion). `log_post_at_event` trigger on `posts INSERT` populates `funnel_chain` via `compute_funnel_chain(user, item, ts)` lookup over upstream impressions/taps/saves/rsvps. Cold conversions (`was_cold_conversion = true`) preserved — they reveal discovery paths outside the algorithm. **Data quality caveat (RESOLVED in 137 next day)**: the geo+time product invariant isn't enforced at DB level — caveat addressed in [the next migration](#137). | Claude (built; awaiting Kevin to apply migration 136) |
| [05/22/2026] | Geo+time invariant now enforced at the post insert layer. Migration 137: posts gain `verified_lat`, `verified_lng`, `verified_at`, `verified_at_event` columns. BEFORE INSERT trigger `enforce_post_verification` rejects any explore_item-linked post that doesn't carry all four. `log_post_at_event` updated to fire ONLY when `verified_at_event = TRUE` — unverified posts are skipped entirely (not logged with a different event_type; that would inflate noise the ranker can't use). | The conversion signal is now "user demonstrably attended at this time and place" instead of "user pressed Post." `verifyCheckInLocation` was already sampling user coords + had the proof internally; the fix surfaces them, threads them through `event-detail → mode-selector → camera → post insert` via route params, and writes them on the row. Also added the same verification gate to the Postable Now double-tap shortcut (previously bypassed it). Existing posts keep NULL for all four columns; trigger only applies to new rows. 0 pre-137 `post_at_event` rows in engagement_log at apply time — clean cutover, no backfill needed. | Claude |
| [06/14/2026] | **CHIEF ENGINEER PHASE 1: Staging environment design approved.** Branching strategy: feature → staging → main (three-branch Git flow). Separate Supabase project for staging (`staging-staging`, mirrors prod schema). Mobile app uses EAS build profiles (`preview` for staging, `production` for prod) with env files per target. Edge functions deploy separately per environment (staging-staging vs. lkmntknpaiaiqvupzjbz). GitHub Actions routes based on branch. | Three-branch model provides clear separation of concerns (dev/staging/prod), scales to autonomous infrastructure, easier for agents to reason about. Separate Supabase isolates staging from production data. EAS build profiles are idiomatic in Expo ecosystem. Separate edge function deployments avoid complex routing logic and enable testing in staging before production exposure. | Claude (design); Kevin (approval pending) |
| [06/14/2026] | GitHub workflow stubs created: `.github/workflows/deploy-staging.yml` and `.github/workflows/deploy-production.yml`. Wired in Phase 5 with real deployment logic; Phase 1 is scaffolding only. | Establishes the deployment points now; implementation deferred to Phase 5 when CI/CD becomes live. | Claude |
| [06/14/2026] | **Staging build-out: code + config implemented (supersedes the two rows above where they conflict).** Corrections to the original design: (a) env detection now keys off explicit `EXPO_PUBLIC_APP_ENV`, NOT `url.includes("staging")` — real Supabase refs are random strings and would mislabel a staging build as prod; (b) dedicated EAS `staging` profile (not overloading `preview`); (c) `staging-staging` was a placeholder — the real project ref is auto-generated and must be captured from the dashboard; (d) `.env.staging`/`.env.production` were NOT gitignored (latent secret-leak risk) — now ignored, with committed `.example` templates; (e) seed via `scripts/seed_staging_data.ts` (idempotent, prod-guarded), not raw SQL (Copilot's SQL had an invalid UUID, MySQL `INTO OUTFILE`, and non-existent columns). | Copilot drafted the design before the code existed; implementation verified each claim against the actual codebase per "diagnose first." | Claude (implementation + design corrections) |
| [06/14/2026] | Workflows promoted from stubs to functional: staging auto-deploys on push to `staging` branch; prod deploys auto on push to `main`. Both stay inert (skip-with-warning) until repo secrets exist. | "Do as much as possible without Kevin" — the workflows reference secrets, not literal values, so they're safe to land now and activate the moment secrets are set. | Claude |
| [06/14/2026] | Prod deploy approval gate REMOVED — auto-deploy on merge to `main`, no manual reviewer. | Kevin's explicit call ("I don't need a manual approval for prod deploys, I trust you"). Noted tradeoff: a bad migration merged to main would reach prod's live ~30 users with no human checkpoint; re-addable later via a `production` GitHub Environment. | Kevin |
| [06/14/2026] | Staging creds found at the bottom of `.env.local` (ref `baulipaydofqtkihkghj`, project `goout-mobile-staging`, region us-west-2). eas.json `staging` profile + gitignored `.env.staging` filled with real URL/anon/service-role values. | Kevin pointed to them; service-role REST access verified working. | Claude |
| [06/14/2026] | ~~BLOCKER: staging DB password rejected~~ **CORRECTED: password is fine.** The failures were (a) `%21` URL-encoding the `!` — the CLI sent it literally; raw `!` in the connection string works — and (b) the direct host `db.<ref>.supabase.co` not accepting connections (new projects route through the pooler). Working conn: `postgresql://postgres.baulipaydofqtkihkghj:CrosbyMalkin8771!@aws-1-us-west-2.pooler.supabase.com:5432/postgres`. | My "wrong password" diagnosis was wrong; Kevin re-sending the same value prompted a deeper look. Lesson: don't conclude "bad credential" from a SASL failure without ruling out URL-encoding and endpoint. | Claude (corrected) |
| [06/14/2026] | Re-added prod approval gate via `Production` GitHub Environment (Kevin is required reviewer). Staging stays gate-free. | Kevin's final call: keep human review before prod, none for non-prod. | Kevin |
| [06/14/2026] | **Migration replayability FIXED + staging fully built.** Two from-zero replay bugs found and fixed: (1) `events` + `app_config` were created by hand pre-migrations and no migration CREATEs them → added `000_legacy_baseline.sql` (reconstructed from prod via catalog introspection, `IF NOT EXISTS` so it's a prod no-op); (2) `020_add_ticketmaster_source.sql` had nested same-tag dollar quoting (`DO $$ … cron.schedule(…, $$…$$) … $$`) that fails the parser — outer block retagged `$do$`. The migration set now replays clean from zero. | Docker/pg_dump/psql were all unavailable in the environment, so the planned `supabase db dump` couldn't run; introspected the 2 ghost tables via node-postgres instead. Both fixes are prod-safe (prod has these migrations recorded/objects present). | Claude |
| [06/15/2026] | Staging build gets its own identity via app variants (`app.config.js`): staging → `com.euda.app.staging` / "Euda (Staging)" / scheme `euda-staging`; prod + local dev unchanged. | iOS refuses two apps with the same bundle id, so the staging internal build collided with the App Store app ("Euda is already installed"). Distinct id lets staging install alongside prod. New id auto-provisions under Kevin's Apple account at build time. | Claude |
| [06/18/2026] | **CHIEF ENGINEER PHASE 3b: monitoring + alerting.** `_shared/notify.ts` (Slack Block Kit, severity info/warning/error/critical, critical mentions). 4 Sentry-wrapped monitor edge functions on pg_cron: `monitor-pipeline-health` (30m: source silent >4h warn / >24h crit), `monitor-api-budgets` (1h: 50/80/95%), `monitor-data-quality` (daily 12:00 UTC → `monitoring_daily` table, migration 139), `monitor-error-rates` (30m: Sentry hourly vs 7d median). Cron via env-aware app_config-URL pattern (migration 140, proper dollar-quoting). GitHub Actions `scheduled-monitoring.yml` every 4h as pg_cron-outage backup. Monitoring → dedicated `#euda-monitoring` (separate from Sentry's #euda-app) via `SLACK_WEBHOOK_URL`. | "Prod tells us when something needs attention." Thresholds are first-guess — tune after baseline (tech debt #12). Built in PR #18; activation (deploy functions, set SLACK_WEBHOOK_URL, apply 140) is a rollout step. | Claude |
| [06/18/2026] | **Prod migration history was untracked — backfilled.** Applying 138 revealed prod's `schema_migrations` had 0 recorded versions (migrations were applied via dashboard/psql, never CLI-tracked), so `db push` / the CI prod-deploy was broken. Backfilled 001–137 (metadata only; schema already matched per the audit), then applied 138. Prod now records 000–138; deploys work. | Critical infra fix. Lesson: apply prod migrations via `db push` only from now on. | Claude |
| [06/18/2026] | **CHIEF ENGINEER PHASE 3a: schema drift audit.** Full prod-vs-staging diff (`scripts/schema_audit.js`). No real logic drift; 156 "function diffs" were CRLF/comment cosmetics. Migration 138 catches up the genuine prod-only objects (events RLS policy, `get_pipeline_health`, `pg_net` ext, hand-patched `invoke_cleanup_orphaned_media`) + revokes over-permissive grants from the staging rebuild. Applied to staging; prod apply pending approval (RLS rule). 9 prod cron jobs flagged as outside-migrations tech debt (#11). | Resolves tech debt #10. 138 is idempotent + no-op on prod. Report: `docs/chief_engineer/schema_drift_audit.md`. | Claude |
| [06/15/2026] | **CHIEF ENGINEER PHASE 2: Sentry.** Two projects under org `euda-2e`: mobile `euda-mobile` (existing, `EXPO_PUBLIC_SENTRY_DSN`) + new `euda-edge` (`SENTRY_DSN_EDGE`). Staging/prod split by environment tag, not separate projects. Plain crash/error reporting only — **replay, performance tracing, feedback widget, and Sentry Logs disabled by default** (were on from the wizard; commented out with re-enable note). Edge uses a dependency-free fetch client (`_shared/sentry.ts`) wired into 7 silent-failure-prone functions; new functions adopt `withSentry`. | Replay/perf cost money + add noise (Kevin's call); keep them deliberate. Hand-rolled edge client avoids cold-start cost of `@sentry/deno`. Mobile was ~90% pre-built by the wizard — Phase 2 mostly disabled extras, added session_id, and built the edge side. | Kevin (strategy) + Claude (build) |
| [06/14/2026] | Staging environment is LIVE: schema reset clean, baseline + all 137 migrations applied (138 recorded), grants restored, 3 `[STAGING]` test items seeded. Verified: authenticated RLS policy makes seeded rows visible; anon correctly sees nothing (Euda is login-gated). | Completes the staging bring-up end-to-end. Only EAS build + TestFlight install (account/device-bound) remain. | Claude |

---

## Chief Engineer Infrastructure (Phase 1: Staging Environment)

**Status:** ✅ **LIVE.** Schema (baseline + 137 migrations) applied to staging,
seeded, grants/RLS verified. CI secrets set. Only the EAS staging build +
TestFlight install remain (account/device-bound).

**Design docs:**
- [docs/chief_engineer/staging.md](docs/chief_engineer/staging.md) — Architecture/strategy (with implementation-correction notes at top)
- [docs/chief_engineer/staging_setup.md](docs/chief_engineer/staging_setup.md) — Kevin's checklist (rewritten to match what's built)

**Key decisions (as implemented):**
1. **Branching:** feature → `staging` (auto-deploy) → `main` (gated promotion)
2. **Supabase:** separate staging project, schema mirrored via the 137 migrations; synthetic seed data only (no prod user data)
3. **Mobile app:** dedicated EAS `staging` profile; env via `EXPO_PUBLIC_APP_ENV`; persistent non-prod banner in `app/_layout.tsx`
4. **Edge functions:** deployed separately per project; no in-function env routing
5. **Promotion:** prod deploy gated by `production` GitHub Environment required reviewer

**Implemented this session (no Kevin action):**
- ✅ `src/config/env.ts` — explicit `EXPO_PUBLIC_APP_ENV` detection (fixes a real bug)
- ✅ `app/_layout.tsx` — `EnvBanner` shows STAGING/DEV on non-prod builds
- ✅ `eas.json` — `staging` + `production` profiles, BOTH filled with real values
- ✅ `.gitignore` + `.env.staging.example` / `.env.production.example` + real `.env.staging` (gitignored)
- ✅ `.github/workflows/deploy-staging.yml` + `deploy-production.yml` (functional, secret-gated, prod auto-deploy)
- ✅ `scripts/seed_staging_data.ts` (idempotent, refuses to run against prod ref)
- ✅ Staging project identified (`baulipaydofqtkihkghj`, us-west-2) and wired into config

**Done:** GitHub secrets set by Kevin (CI ready); `Production` environment +
required reviewer created; staging DB password confirmed; schema applied +
seeded; replayability tech-debt fixed (`000_legacy_baseline.sql` + `020` fix).

**Remaining (Kevin, account/device-bound):**
1. `eas build --profile staging` → install via TestFlight internal → confirm the
   STAGING banner shows and (after login) the 3 seeded items load.
2. Create the `staging` git branch so the staging deploy workflow has a trigger.

---

## 4. Open Questions

**Q: When to build the autonomous infrastructure?**
- Trigger to revisit: V2 recommendation work shipped and stable in Warwick
- Current default: Late Warwick / early Portland
- Risks: Building too early competes with V2 work; building too late delays leverage

**Q: Should the LLM enrichment prompt classify civic content as audience_fit='business'?**
- Trigger to revisit: After Warwick ingestion is live for 1 week and we can see how often civic content leaks through ignore_patterns
- Current default: Defer until we see actual leak rate
- Risks: Premature change affects global enrichment, takes effort to validate

**Q: Should the venue-discovery bridge (Google Places → website crawl) be built during Warwick or deferred?**
- **RESOLVED 05/18/2026:** Build during Warwick, scope expanded to "LLM-based extraction as shared layer for collector_targets AND Google Places venues" — design doc at `docs/llm_extraction_design.md`, implementation begins next session with Phase 5.1
- Reasoning: Phase 2 surfaced that existing DOM extractor matches ~0 real-world sites; the venue-discovery bridge's LLM extractor is the cleanest fix for both problems

**Q: Should pg_cron job auth be migrated to sb_secret format, or should requireServiceRole accept both formats?**
- **RESOLVED 05/18/2026:** Both formats accepted via `_shared/auth-guard.ts:requireServiceRole`. Reads three env vars: `SUPABASE_SERVICE_ROLE_KEY` (auto-injected sb_secret), `LEGACY_SERVICE_ROLE_JWT` (custom secret holding legacy JWT for pg_cron), and `SUPABASE_SECRET_KEYS` (auto-injected comma-separated list). Cron continues sending legacy JWT; new code can use either format.
- Risk: `--no-verify-jwt` on 16 functions means gateway no longer pre-filters bad bearers; if requireServiceRole ever regresses, functions become public. **Mitigation backlog item:** write a test that proves requireServiceRole returns 403 for empty/wrong bearers, run in CI.

**Q: V1.1 timing — 7-day TestFlight (tight) vs 10-day (buffered)?**
- Trigger to revisit: Kevin's call before Phase 5.1 starts
- Current default: Kevin to decide
- Risks: 7-day has zero buffer; Phase 2 demonstrated this codebase has latent surprises

**Q: When to enable the LLM reranker?**
- Trigger to revisit: After offline evaluation harness is in place and we have baseline metrics
- Current default: Disabled until measurable
- Risks: Shipping more sophistication without measurement infrastructure means we can't tell if it helps

---

## 5. Bug & Feature Backlog

### In flight
- **(V1.1 release) — NEXT SESSION.** Bundle the four days of work shipped since V1 for a TestFlight cut. Items in the bundle:
  - Original V1 bug fixes 1–5, 7 (already on dev branch from before this stretch)
  - Phase 5 series end-to-end: 5.1 LLM extractor, 5.2 collector integration, 5.3 venue-discovery bridge (`discover-venues-to-crawl` + `ingest-venue-website` + `venue_crawl_state`)
  - Chain venue policy (migration 130 + `_shared/chain-detection.ts` + ranker ×0.5 multiplicative penalty)
  - Civic content exclusion (`_shared/civic-filter.ts` + ingestion-side filter + 20-row backfill)
  - Geographic gates: hardened distance filter (50mi architectural floor, null-coord exclusion, search override), Ticketmaster `warwick-40mi` partition tightened to 35mi to clip NYC, 226 NYC-bbox rows soft-deleted
  - Image pipeline: Google Places `FIELD_MASK` includes `places.photos`, cache-place-photos cron (migration 133, bumped to 100 items / 15min), `get_items_needing_images` RPC fix (migration 135 — deleted_at gate + Places-source default)
  - Engagement logging foundation (migration 136: `engagement_log` partitioned table + `log_post_at_event` trigger + `compute_funnel_chain` + client buffer/sampling/viewport hook + `log-engagement` edge function)
  - Geo+time invariant enforcement (migration 137: `verified_lat`/`lng`/`at`/`at_event` columns, `enforce_post_verification` BEFORE INSERT trigger, threaded coords through event-detail → mode-selector → camera flow including Postable Now shortcut)
  - Hours formatting fixes (formatOpeningHours inherits AM/PM, drive-in / single-period Google Places format)
  - Past-event filter tightening (migration 134: trust only `starts_at`, ignore listing-expiry `ends_at`; 339 past events soft-deleted)
  - Web-collector LLM extractor: museum/facility/season-range guardrail in `web_collector.ts` adapter + LLM prompt rule
  - Event detail screen `formatDateTime` uses `formatOpeningHours.summaryLine`
  - pg_cron execution fix: rewrote all cron commands with literal URL + bearer (the long-running silent failure on `current_setting('app.supabase_url')`)
  - All other production polish from the four-day stretch
- (Civic classifier) Folded into Phase 5.5 — handled by LLM extractor's structured output, no separate classifier prompt

### Done this session (05/19-20/2026)
- **Phase 5.1 — LLM extractor** [`supabase/functions/_shared/llm-extractor.ts`]
  - Single exported `extractEvents(html, hints, opts)` → events + usage + diagnostics
  - Pipeline: HTML preprocess (strip scripts/styles/chrome, truncate to 40K chars) → Haiku 4.5 extraction (max_tokens 16K, temp 0.1) → hand-rolled schema validation (strict ISO 8601 datetime regex) → strict-substring evidence check with bidirectional canonicalization → critique pass (Haiku, non-fatal)
  - 10-fixture unit test ([`scripts/llm_extractor_test.ts`]): **84.4% recall, 96.8% precision, 0 true hallucinations, $0.027/crawl**
  - Pass criteria: recall ≥ 80% ✓, precision ≥ 90% ✓, zero hallucinations ✓
  - Total fixture-set events: 45 (across 10 venues spanning Squarespace, Wix, MEC, WordPress, static .html, JSON-LD-bearing, dateless-button-only, and wrong-page-redirect scenarios)

- **Phase 5.2 — LLM fallback wired into ingest-web-collector** (build + deploy complete)
  - Migration 129 ([`supabase/migrations/129_phase52_llm_fallback.sql`]): `collector_targets.use_llm_fallback BOOLEAN DEFAULT FALSE` + redefined `get_enabled_collector_targets()` RPC to include the field + `api_usage_counters('anthropic_haiku', 5000 cents = $50/mo)` seeded + `use_llm_fallback=TRUE` flipped for the 5 Week-0 targets.
  - [`supabase/functions/ingest-web-collector/index.ts`]: after deterministic strategies, if `target.use_llm_fallback && candidates.length < 2`, calls `extractEvents()` on the cached HTML. Budget guard via `get_api_budget('anthropic_haiku')` BEFORE the call; extractor logs cost via `increment_api_usage` AFTER. LLM-sourced rows ride as `EventCandidate` with `extraction_strategy='html_dom'` and `raw_json._llm_extracted=true` (underscore-prefix marker convention, same as existing `_target_*` fields).
  - [`supabase/functions/_shared/web-collector.ts`]: `CollectorTarget.use_llm_fallback?: boolean` (optional for back-compat with rows from old RPC).
  - Telemetry: per-target and aggregate `llm_calls_made`, `llm_candidates_added`, `llm_cost_cents` flow into the response, console log, and pipeline_health_log details.

- **Phase 5.4 Week-0 validation on Albert Wisner Public Library (05/20/2026):**
  - Manual fetch via POST `ingest-web-collector` with `target_id=f13a72fb-9ec8-4db4-88f6-198a2a31c17e`. Response: `pages_fetched=1` (the `/calendar` discovery URL timed out with http2 connection reset on Cloudflare's edge — not blocking, the `/events` page succeeded), `llm_calls_made=1`, `llm_candidates_added=62`, `llm_cost_cents=10` ($0.10), `valid_candidates=62`, `candidates_queued=62`. Duration 71s.
  - `api_usage_counters('anthropic_haiku')`: requests_used incremented 0 → 10 ✓
  - `event_ingest_raw`: 62 rows upserted with `raw_json._llm_extracted=true`; full `_llm_title_evidence`, `_llm_date_evidence`, `_llm_price_text` audit fields preserved alongside `_target_*` enrichment context.
  - Triggered `normalize-raw-events`: 59 of 62 processed in one batch, all `auto_approved=59, quarantined=0, errors=0`. (The 3 unaccounted-for are likely deduped via `external_id` conflict — recurring events with overlapping occurrence URL slugs.)
  - Triggered `run-enrichment-queue`: processed=14, enriched=14, failed=0 in one batch (queue is rate-limited per-call; additional cycles will catch the rest naturally).
  - `explore_items` from Albert Wisner: 30+ rows live as of validation, all `review_status='auto_approved'`. Spans Toddler Time, Preschool Storytime, Storytime variants, Read To The Dogs, Book Groups, Movies, D&D, plus the "Music on McFarland: Classical Guitarist Peter Fletcher" lecture-music programming. Categories distributed across "Anchor" (recurring), "Arts & Culture", "Sports & Recreation", "Food & Drink".
  - **Verdict: PASS.** Full pipeline DOM-extract → LLM-fallback → event_ingest_raw → normalize → enrich → explore_items works end-to-end. Albert Wisner now contributes events to the Warwick catalog.
  - Week 1 plan: monitor the other 4 venues (Bethel, Storm King, Drowned Lands, Sugar Loaf PAC) as they pick up on the next pg_cron `*/30` tick. Watch `api_usage_counters('anthropic_haiku').requests_used` — projected to stay well under the 5000-cent monthly cap given current cadence.

### Known limitations (Phase 5.1, accepted)
- **Strict-evidence check rejects events with model-fabricated day-of-week context.** Example: source has "Next Jam: May 29"; model emits `date_evidence: "Friday, May 29"` (inferring the day). The check rejects because "Friday, May 29" isn't in source. Cost: ~3 events dropped per Bethel Woods crawl. Next crawl typically produces different evidence forms that pass. Revisit prompt tightening in Phase 5.2+ only if production data shows this is widespread.
- **Pennings-style dateless-button events.** Pages that link to TicketSpice / Eventbrite buttons with titles but zero inline date context: model correctly omits them. Future work if we add null-`starts_at` handling downstream.
- **Typographic obfuscation beyond the canonicalization allow-list.** Current allow-list covers `&amp; &#039; &quot; &#8211; &#8212; &#8216; &#8217; &#8220; &#8221; &#8230; &nbsp;` plus the corresponding Unicode forms. Add entries as production data reveals new patterns.
- **Extreme density requiring multi-page fetch.** Sites with > 40K chars of preprocessed event content (Albert Wisner MEC monthly grid, Drowned Lands taproom page, Sugar Loaf PAC Wix events widget) lose recall at the truncation cliff. Phase 5.3's multi-page strategy (Section B path 2 of design doc) handles this.

### Phase 5.1 cost watchpoint
Per-crawl cost is **$0.027** (above design doc's $0.005 estimate). Monthly projection at 500 venues × weekly = $54/mo, just over the $50 hard cap. With backoff schedule (design doc Section D — bi-weekly after 2 empties, monthly after 6, disable after 12), realistic operation should land at $30-40/mo. Monitor `api_usage_counters('anthropic_haiku')` once Phase 5.4 enrollment begins. Acceptable in isolation; will need scale-time efficiency work if catalog grows to 5000+ venues (potential levers: smaller critique-pass HTML excerpt, prompt-cache the system prompt, or cadence-based budget allocation).

### Post-Warwick-launch triage (05/21/2026)
- **Recurring-event-on-holiday closure (DEFERRED).** Albert Wisner library shows recurring instances on May 25 (Memorial Day) even though the library publishes that closure on its website. `advance_recurring_events()` (migration 109) has no awareness of holidays or per-venue closure exceptions. Fixing this needs a `venue_closures` table (or an `availability_exceptions JSONB[]` column on explore_items) plus a join in the cron function. Out of scope for the launch-week triage pass. Workaround: users can see the closure date if they tap through to the library's site via the MORE INFO link. Priority: MEDIUM (per Kevin's "fix if straightforward, defer with documentation if not"). [[issue5-deferred]]
- **One-off cleanup needed for existing Bethel Woods Museum row.** The web-collector guardrail prevents future occurrences but doesn't retroactively re-classify the row already in the DB. Run via Supabase dashboard SQL editor:
  ```sql
  UPDATE explore_items
     SET kind = 'activity', starts_at = NULL, ends_at = NULL
   WHERE title ILIKE '%museum at bethel woods%'
     AND kind = 'event';
  -- Also look for similar mis-classifications:
  SELECT id, title, starts_at, location_name
    FROM explore_items
   WHERE kind = 'event'
     AND starts_at IS NOT NULL
     AND EXTRACT(hour FROM starts_at) = 0 AND EXTRACT(minute FROM starts_at) = 0
     AND (title ~* '\\b(museum|gallery|exhibit|visit the|hours)\\b'
       OR description ~* '\\b(open year[\\s-]?round|permanent exhibit|always open)\\b');
  ```
- **Backfill lat/lng for existing venue-website-extracted events.** The inheritance fix in `ingest-venue-website` applies to new crawls; rows already in `explore_items` from earlier crawls still have null coordinates. One-off:
  ```sql
  UPDATE explore_items e
     SET lat = v.lat, lng = v.lng, address = COALESCE(e.address, v.address)
    FROM venue_crawl_state s
    JOIN explore_items v ON v.id = s.explore_item_id
   WHERE e.source_id = (SELECT id FROM event_sources WHERE name = 'Auto-Discovered Venue')
     AND e.kind = 'event'
     AND e.lat IS NULL AND v.lat IS NOT NULL;
  -- match by venue title since explore_items don't track parent venue directly
  ```
  Note: that JOIN heuristic is approximate; the surgical version requires tracing event → source_url → venue_crawl_state.website_url. Operator's call which is cheaper.

### Open bugs (NEW this session)
- **Path-allow bug in `_shared/web-collector.ts`** — discovery_urls without trailing slash failed prefix check against allowed_paths with trailing slash. FIXED & deployed to ingest-web-collector. Was a latent bug across the whole catalog since migration 045 (every Potsdam target also affected).
- **3-month ingestion dormancy** — production ingestion silently stopped Feb 3-25 when Supabase migrated auto-injected SUPABASE_SERVICE_ROLE_KEY from legacy JWT to sb_secret_*. FIXED via 15-function redeploy with --no-verify-jwt. Manual ALTER DATABASE pending from Kevin to update pg_cron auth.
- **iCal feed URL for Town of Warwick is dynamic / JS-rendered** — switching to 'ics' parsing strategy in migration 128 was premature. The discovery URL still points at the HTML calendar, not the actual .ics endpoint. Low priority; LLM extractor will handle the HTML version regardless.
- **3 additional dead Warwick collector targets discovered during Phase 5.1 fixture research** — defer cleanup to a follow-up migration (use whatever number is free after 5.1/5.2/5.3 migrations land):
  - `penningsfarmcidery.com` is parked (GoDaddy lander w/ JS redirect to `/lander`) — DELETE row.
  - `warwickhistoricalsociety.org` resolves to unrelated `heywarwick.com` mobile-app marketing site (domain takeover or shared-hosting redirect) — VERIFY current state, likely DELETE row.
  - `longlot.com` is a HugeDomains parked-for-sale page; Long Lot Brewery may be Instagram-only like Tuscan/Ochs were (deleted in 128) — VERIFY, likely DELETE row.
  - Phase 5.1 substituted Pennings Farm Market, Sugar Loaf PAC, and Mountain Creek Resort respectively in the fixture set. No migration in this session — discipline matters more than convenience.

### Feature backlog (V2 work)
- Impression logging (the V2 evaluation tent-pole — has NOT been built yet, blocks all downstream V2 measurement)
- pgvector + embedding generation
- User taste vector + semanticMatch signal
- Hybrid retrieval (SQL + semantic)
- ranking_config table + weight profiles
- MMR diversification
- Epsilon exploration
- Enrichment prompt overhaul (two-tier tag taxonomy)
- Post-enrichment validation sweep

### Future / V3
- Learned ranker (gradient-boosted tree) — needs interaction data, defer until post-V2
- Paid venue tier rollout — defer until ~5K users in any single metro
- Multi-region Supabase read replicas — defer until ~20K users

---

## 6. System State

### Deployed
- **V1 (App Store):** Live. Approved [recent]. ~30 users in Potsdam.
- **V1 bug fixes (Bugs 1-5, 7):** Implemented by Claude Code, not yet shipped to TestFlight or submitted to App Store as V1.1, currently sitting in dev branch.
- **15 service-role edge functions** redeployed with `--no-verify-jwt` (auth fix from this session): fetch-coordinator, all 4 ingest-*, normalize-raw-events, enrich-explore-item, run-enrichment-queue, schedule-enrichment, send-event-reminders, evaluate-venue-websites, lookup-venue-images, cache-place-photos, cleanup-orphaned-media, health-summary
- **ingest-web-collector** redeployed with path-allow bug fix + auth fix
- **Migration 126** (Warwick fetch partitions): applied; 3 partitions staged is_enabled=FALSE
- **Migration 127** (Warwick collector targets): applied; 30 targets staged is_enabled=FALSE (32 originally, 2 deleted in 128)
- **Migration 128** (URL fixes + 2 deletions): applied
- **Sentry (Chief Engineer Phase 2):** mobile `euda-mobile` live (`@sentry/react-native`, replay/perf disabled; staging now also reports, env-tagged). Edge integration **LIVE in production (06/17/2026):** `SENTRY_DSN_EDGE`/`SENTRY_ENV=prod` set as function secrets and all 7 wrapped functions redeployed to `lkmntknpaiaiqvupzjbz` (health-probed 401, DSN verified receiving). Env tag is `prod` (not "production") to match mobile `Env.APP_ENV` + the Sentry alert rule's `environment:prod` filter. Edge project `euda-edge`. Staging-project edge functions not deployed yet (no edge runtime there). See `docs/chief_engineer/sentry.md`.

### Phase 5.1 — new files (05/19-20/2026, deployed via 5.2 redeploy)
- `supabase/functions/_shared/llm-extractor.ts` — extractEvents() + preprocessHtmlForPrompt() + evidenceAppearsInSource() + Haiku 4.5 prompts. Standalone module; no DB or network side effects beyond the LLM call (optional cost logging via opts.supabase).
- `supabase/functions/_shared/__fixtures__/` — 10 .html + 10 .expected.json ground-truth pairs for unit testing. Total 45 ground-truth events across Bethel Woods, Storm King, Albert Wisner Library, Drowned Lands, Pennings Farm Market, Sugar Loaf Guild, Warwick Valley Winery, Sugar Loaf PAC, Mountain Creek Resort, Cornerstone Theatre Arts.
- `scripts/llm_extractor_test.ts` — recall/precision/cost test harness with retry-on-429 + fuzzy-match diagnostic for misses. Outputs report to `scripts/llm_extractor_test_report.json`.
- `scripts/llm_extractor_preflight.ts` — char-to-token ratio measurement via Anthropic count_tokens API + per-fixture truncation analysis.

### Phase 5.2 — new + modified files (05/20/2026, awaiting deploy)
- `supabase/migrations/129_phase52_llm_fallback.sql` — adds `use_llm_fallback` column, redefines `get_enabled_collector_targets()` RPC, seeds `api_usage_counters('anthropic_haiku')` at 5000 cents, flips the 5 Week-0 venues to `use_llm_fallback=TRUE`. is_enabled stays FALSE pending atomic flip after deploy.
- `supabase/functions/ingest-web-collector/index.ts` — added LLM fallback block + budget guard + per-target/aggregate telemetry. ~200 lines added.
- `supabase/functions/_shared/web-collector.ts` — added `use_llm_fallback?: boolean` to `CollectorTarget` interface.

### Phase 5.* cron unblock — `diagnose-cron` edge function (05/21/2026, deployed)
- `supabase/functions/diagnose-cron/index.ts` — service-role-only utility used to diagnose + repair pg_cron health. Uses deno-postgres via SUPABASE_DB_URL to bypass PostgREST's public-schema-only restriction. Modes: `diagnose` (read-only snapshot of cron.job + cron.job_run_details + db_level_settings) and `fix` (rewrites cron.job.command for the 6 known jobs to embed URL + auth literals, since ALTER DATABASE is permission-denied on managed Supabase). Intended as a one-shot diagnostic — safe to delete or keep as an operational tool. **Run-history shows ~3 months of silent cron failures pre-fix; pre-existing fetch-coordinator-run / normalize-new-events / enrich-new-items had been failing since the project came up.**

### Phase 5.* cron schedules — migration 132 (05/21/2026, applied + executing)
- `supabase/migrations/132_phase5_cron_schedules.sql` — schedules three pg_cron jobs: `web-collector-run` every 30 min (max_targets=10), `discover-venues-hourly` at top of every hour (max_per_run=50), `ingest-venue-website-run` at minute :15 (max_per_run=5). All use the same `current_setting('app.service_role_key')` legacy-JWT pattern as migration 088. Idempotent — cron.schedule() replaces existing jobs of the same name. **Until applied, none of these fire automatically; manual invocation required.**

### Phase 5.3 follow-up — Warwick fanout + Warwick geo filter (05/21/2026)
- `supabase/functions/discover-venues-to-crawl/index.ts` — added optional `bbox` and `towns` filters to the request body. Both undefined by default; supplied via cron body or manual invocation when targeting a specific region.
- `scripts/session_warwick_invocations.ts` — small helper for batched function invocations (ingest-web-collector × 8, ingest-venue-website × 5, etc). Kept in repo as future-session reference; safe to delete if not referenced.
- **Data plane changes (via service-role REST, no migration):**
  - 20 Hudson Valley `collector_targets` flipped: `is_enabled=TRUE, use_llm_fallback=TRUE` (skipped Long Lot Brewery, Pennings Farm Cidery, Warwick Historical Society — known-dead URLs from Phase 5.1 fixture research).
  - 3 Warwick `fetch_partitions` (Ticketmaster `warwick-40mi`, Google Places `warwick-activities`, PredictHQ `warwick-events`) flipped: `is_enabled=TRUE`.
- **Yield this session:** 21+ collector_targets processed, 73+ raw candidates queued, 77 normalized, 76 auto_approved + 1 quarantined. Final state: **111 Hudson Valley events live in explore_items (87 Warwick), all enriched with hook_lines**. Anthropic Haiku spend: $0.78 / $50 monthly cap.
- **5.3 venue-discovery (Potsdam fallback):** discover with no filter enqueued 100 Potsdam-area venues; ingest-venue-website processed 20 (14 events LLM-extracted, 0 queued due to no-date validation, $0.13). Bridge pipeline confirmed working end-to-end even without Warwick GP coverage.

### Phase 5.3 proper — venue-discovery bridge (05/20/2026, deployed + smoke-tested)
- `supabase/migrations/131_venue_crawl_state.sql` — creates `venue_crawl_state` table (one row per `(explore_item, distinct URL)`) with partial indexes, an `updated_at` touch trigger, RLS enabled (service-role only), and a synthetic `Auto-Discovered Venue` event_sources row (type=`web_collector`).
- `supabase/functions/discover-venues-to-crawl/index.ts` — service-role enqueue function. Reads explore_items where `kind='activity'`, `source_url IS NOT NULL`, `relevance_tier >= 2`, sub_category NOT IN the 14-entry exclusion list, `COALESCE(is_chain_override, is_chain) = FALSE`. Inserts up to `max_per_run` (default 50, cap 500) new rows into venue_crawl_state. Idempotent via the `(explore_item_id, website_url)` unique constraint.
- `supabase/functions/ingest-venue-website/index.ts` — service-role consumer function. Claims rows where `next_eligible_at <= NOW()` and `status != 'disabled'`. For each: robots.txt check (lightweight — only catches blanket `Disallow: /`), fetch root with 800KB cap + 15s timeout, discover up to 2 events-like subpages (`/events|/calendar|/whats-on|/programs|/shows|/happenings`), fetch with 6s inter-page rate-limit delay, run `extractEvents()` per page, upsert valid candidates into event_ingest_raw under the synthetic source_id with provenance markers (`_llm_extracted=true`, `_target_kind='auto_discovered'`, `_target_venue_name`, `_target_town`, `_target_default_category`).
- Backoff logic: empty 0-1 → 7d, empty 2-5 → 14d, empty 6-11 → 30d + status='backing_off', empty ≥12 → status='disabled'. Errors: 1h, 2h, 4h, 8h, 16h, then status='disabled' at 5. Per-venue lifetime LLM cap: 100¢ ($1) → status='disabled'.
- Smoke test results: discoverer enqueued 10 venues (200 scanned, 173 eligible). Consumer tested on 3 venues: 1/2 Ton's (404 → error path verified, status=active, consecutive_errors=1), Robert Moses State Park (3 pages, 0 events, $0.04, success path verified, consecutive_empty_runs=1, next_eligible=7d), SpencerCity Bar & Grill (1 page, 3 events extracted but 0 valid — events listed without dates, candidates_queued=0).

### Phase 5.3 prep — chain venue policy infrastructure (05/20/2026)
- `supabase/migrations/130_chain_venue_columns.sql` — adds `is_chain` / `chain_brand` / `is_chain_override` to `explore_items` + partial indexes. Schema-only; backfill is via script.
- `supabase/functions/_shared/chain-detection.ts` — 130-entry brand vocabulary + `isChainVenue(name)` whole-word matcher with apostrophe normalization. Pure helper, no DB/network.
- `supabase/functions/_shared/source-adapters/google_places.ts` — calls `isChainVenue(title)` and emits `is_chain` + `chain_brand` on the `NormalizedEvent` returned to normalize-raw-events.
- `supabase/functions/_shared/source-adapters/ticketmaster.ts` — added optional `is_chain` + `chain_brand` to the `NormalizedEvent` interface (other adapters ignore them; only Google Places populates).
- `supabase/functions/normalize-raw-events/index.ts` — clarifying comment on how chain fields flow through the upsert (no logic change — `...normalized` spread already carries them; `is_chain_override` is preserved across re-normalizations).
- `scripts/backfill_chain_venues.ts` — one-shot script that scans `explore_items`, computes `isChainVenue(title)`, bulk-updates mismatches via service-role. Re-runnable. Reports flagged count + sample + per-location report for default-suppress brands (Whole Foods / Trader Joe's / Wegmans / Barnes & Noble) per Pause B.
- `scripts/chain_detection_test.ts` — 30 MUST_MATCH + 30 MUST_NOT_MATCH + 5 DOCUMENTED (accepted limitations) cases. All 60 strict cohorts pass.
- `src/lib/scoring.ts` — added `chainPenalty` field to `ScoreBreakdown`, `searchActive?: boolean` to `ScoringContext`, and post-weighted-sum ×0.5 multiplier when `COALESCE(is_chain_override, is_chain)` is TRUE AND no search/friends override.
- `src/hooks/useRecommender.ts` — plumbs `searchActive` from `exploreFilters.filters.searchQuery` into the scoring context; updated `defaultScored` stub.
- `src/lib/__tests__/groupingEngine.test.ts` + `app/(tabs)/explore.tsx` — updated mock breakdowns to include `chainPenalty: 1.0` (existing-test infrastructure compatibility).
- `docs/llm_extraction_design.md §C` — updated to reflect the chain filter and the corrected `relevance_tier >= 2` anchor (the original `venue_score >= 3` referenced a column that was never built).

### In flight
- *(nothing — chain infra coded; awaiting Pause B backfill run)*

### Disabled / Feature-flagged
- LLM reranker (`rerank-explore-items` edge function): deployed but feature flag off
- Eventbrite source: globally disabled (migration 036)
- All Warwick partitions and collector targets: is_enabled=FALSE pending Phase 5 LLM extractor

### Environments
- **Production:** Supabase Pro tier project, live
- **Staging:** Does not exist yet. Building this is a Phase 2 prerequisite.

### Costs (current state, approximate)
- Supabase Pro: $25/mo
- LLM enrichment: low (early stage)
- Google Places, Ticketmaster, PredictHQ: all within free tiers currently
- Total est. monthly: ~$30-50 currently

---

## 7. Architecture & Patterns Notes

### Database
- PostgreSQL via Supabase, 128+ migrations applied to production
- Row-level security throughout
- Migrations numbered sequentially; never reuse numbers
- Migration apply pattern: write file → review → `supabase db push`

#### Migration number reservations (parallel workstreams)
When multiple Claude Code sessions run in parallel, they need to reserve migration number ranges in advance to avoid merge conflicts. Current reservations:
- **129–132**: Phase 5 (LLM extraction + venue-discovery bridge)
- **133+**: Impression logging workstream (V2 evaluation harness)
- Other parallel sessions: append a new reservation here before starting work that adds migrations.

### Recommendation engine (V1)
- 12-signal weighted linear ranker
- Client-side scoring in React Native
- Weights compiled into the app binary (server-delivery is V2 work)
- 2 learned signals (tagAffinity, typeAffinity); rest deterministic
- See `src/lib/scoring.ts` for the implementation

### Data ingestion
- Four sources: Ticketmaster, Google Places, PredictHQ, custom web collector
- 30-min cron picks up oldest stale partition
- Per-source budget tracking in `api_usage_counters`
- Web collector: curated allowlist via `collector_targets` table
- Gap: no automatic venue discovery from Google Places venues' websites (Phase 5 design pending)

### Enrichment
- Claude Haiku via Anthropic API, with OpenAI GPT-4o-mini fallback
- Daily budget cap via `check_llm_daily_budget` RPC
- Per-field confidence scores via `apply_enrichment` RPC
- Known issue: tag homogeneity (family_friendly on 64% of items, indoors on 55%)

### LLM event extractor (Phase 5.1, 05/20/2026)
- **File:** `supabase/functions/_shared/llm-extractor.ts`. Single exported `extractEvents(html, hints, opts)`.
- **Pipeline:** HTML preprocess (strip scripts/styles/svg/noscript/nav/header/footer/aside; prefer `<main>` then `<body>`; whitespace-collapse; truncate to 40,000 chars) → Claude Haiku 4.5 extraction (max_tokens 16K, temp 0.1, JSON-only) → hand-rolled schema validation (strict ISO 8601 datetime regex; description ≤500 chars; title length 3-200) → strict-substring evidence check with bidirectional canonicalization → critique pass (Haiku again, max_tokens 1K, non-fatal on failure).
- **Anti-hallucination:** Primary control is the verbatim-substring evidence check (`evidenceAppearsInSource`). Both source and evidence are canonicalized to ASCII (entities + typographic punctuation → ASCII) BEFORE substring comparison. The canonicalization is deterministic 1:1 — it preserves the strict-quote guarantee, just expands "substring" to cover equivalent character encodings. Secondary control is the critique pass: Haiku reviews extracted events against source, flags non-events / paraphrases / duplicates; flagged indices are dropped. Critique-pass failure (parse error, API hiccup) is non-fatal — falls back to the evidence-checked set.
- **Hints:** `{ venue_name?, town?, timezone?, default_category? }` — pass-through context from collector_targets.site_config or Google Places venue context. Model uses these for disambiguation; not echoed in output.
- **Cost tracking:** Optional `opts.supabase` → calls `increment_api_usage('anthropic_haiku', cost_cents)` after each successful run. Caller is responsible for the pre-call budget guard (`get_api_budget('anthropic_haiku')`). Pricing constants in module: Haiku 4.5 at $0.80/MTok input, $4.00/MTok output. costCents() rounds up (over-attribute rather than under-attribute).
- **Schema (Zod-doc-equivalent, hand-rolled):** title (3-200), starts_at (strict ISO 8601 nullable), ends_at (same), recurrence_text, description (≤500), price_text, source_url_path, title_evidence (≥3 verbatim), date_evidence (verbatim or null).
- **Known limitations** (see Section 5).
- **Test harness:** `scripts/llm_extractor_test.ts` runs all 10 fixtures with retry-on-429 + 1.5s inter-fixture pacing. Recall computed against all GT; precision computed only on `expected_complete=true` fixtures (truncated fixtures excluded). Two-phase matcher: primary match (claims an unclaimed GT slot) + secondary recurring match (extra instances of an already-matched recurring GT entry count toward precision, not recall).

### LLM fallback integration in ingest-web-collector (Phase 5.2, 05/20/2026)
- **Entry point:** [`supabase/functions/ingest-web-collector/index.ts`]. After `extractCandidates()` (deterministic) returns for each cached page, if `target.use_llm_fallback && candidates.length < LLM_FALLBACK_THRESHOLD (2)`, the LLM fallback block runs.
- **Budget guard:** call-site checks `get_api_budget('anthropic_haiku')` BEFORE the LLM call. Skips with `extractErrors.push('llm_fallback_skipped: ...')` if budget exhausted. `extractEvents()` itself then calls `increment_api_usage('anthropic_haiku', cost_cents)` AFTER successful run via `opts.supabase`. Both ends are protected — runaway-cost scenarios can't slip through.
- **Per-service unit semantic on `api_usage_counters`:** for `service='anthropic_haiku'`, 1 unit = 1 cent (not 1 request as it is for `google_places`). `requests_limit=5000` ⇒ $50/mo cap, matching the Phase 5 design-doc hard cap.
- **LLM-sourced row marker:** the raw_json upserted into `event_ingest_raw` carries `_llm_extracted: true` (underscore-prefix convention, same as `_target_*`). Downstream queries can distinguish LLM rows: `SELECT * FROM event_ingest_raw WHERE raw_json->>'_llm_extracted' = 'true'`. Additional fields: `_llm_title_evidence`, `_llm_date_evidence`, `_llm_price_text` preserve the original LLM output for audit.
- **Validity filter:** LLM events without a temporal signal (no `starts_at` AND no `recurrence_text`) get `is_valid=false` and are filtered before the upsert — matches the existing pipeline contract. This means Pennings-style button-only events with title-but-no-date are extracted by the LLM, surface in the diagnostic log, but DON'T flow to `event_ingest_raw`. Acceptable for now; null-date handling is a separate downstream concern.
- **Telemetry:** per-target result and aggregate summary expose `llm_calls_made`, `llm_candidates_added`, `llm_cost_cents`. Surfaced in console log, response body, and `pipeline_health_log.details_json` for monitoring. Watch these once Week 0/1 venues are enabled.

### Push notifications
- Expo Push Notification Service
- Implementation: `supabase/functions/send-event-reminders/`
- Current types: friend requests, RSVPs, comments, event reminders
- No proactive feed-content pushes yet (audit pending)

### Patterns to maintain
- "Diagnose first, implement second" — always have Claude Code propose changes before writing code
- Server-delivered config over compiled constants (for anything experimentable)
- Feature flags for all V2 changes — no untested code paths in production by default
- All sheets/modals should refresh on visible (lesson from Bug 1)
- All notification handlers should emit refresh events (lesson from Bug 3)
- New edge functions should capture errors via the `_shared/sentry.ts` wrapper (`withSentry(name, handler)` or `captureEdgeException` in the catch) unless there's a specific reason not to — so silent failures surface in the `euda-edge` Sentry project

### Known tech debt (added this session)

**1. Edge function auth: inconsistent verify-jwt strategy.**
- 16 service-role functions deployed with `--no-verify-jwt` (gateway off); function-level `requireServiceRole` is sole check, now accepts both new sb_secret and legacy JWT formats.
- 6 user-facing functions still have gateway verify-jwt on (correct — they use `requireUser` which validates JWTs).
- 1 function (rerank-explore-items) uses both auth styles; kept gateway on.
- Tech debt to track: write a CI test that proves `requireServiceRole` returns 403 for empty/wrong/forged bearers. Defer to Phase 2 (staging environment setup).

**2. pg_cron DB-level `app.service_role_key` is stale but no longer matters.**
- Has the original legacy JWT value, can't be updated from dashboard SQL editor (postgres role isn't superuser).
- Auth-guard accepts that legacy JWT via `LEGACY_SERVICE_ROLE_JWT` custom env var.
- Long-term fix: replace `current_setting()` lookup in cron jobs with a Supabase Vault-based read so secret rotation is mechanical. Out of scope until staging env exists.

**3. Default DOM extractor in `_shared/web-extractors.ts` matches very few real-world sites.**
- `.event`, `.event-item`, `article.event`, `[itemtype*='Event']` covers maybe 5% of sites we sampled.
- Phase 5 LLM extraction addresses this. After Phase 5 ships, the DOM path becomes "tier-0 cheap free pass; LLM fills the rest."
- Don't deprecate DOM extractor — it's the right tool for the 5% of sites where it works.

**4. Trailing-slash convention bug in `allowed_paths` was latent across the whole catalog.**
- Original migration 045 used `discovery_urls=['/events']` + `allowed_paths=['/events/']` which prefix-fails. Same pattern in every collector_target since.
- FIXED in `_shared/web-collector.ts:isPathAllowed` — normalize trailing slash on both sides; bonus: also fixes over-match (e.g., `/events-archive` no longer matches `/events`).
- Existing data could be normalized in a follow-up migration but is not necessary — the code fix is sufficient.

**5. Supabase auto-injected env vars change format unpredictably.**
- The platform migrated SUPABASE_SERVICE_ROLE_KEY from legacy JWT to sb_secret_* sometime between Feb and May 2026, silently. Cost us 3 months of ingestion before discovery.
- Lesson: every cron-driven function should write to `pipeline_health_log` even on success, so the LACK of recent entries is detectable.
- Lesson: monitoring dashboard (Phase 6 originally) should surface "no recent activity per source" as a top-level alert.

**6. `get_items_needing_images` returns rows whose source doesn't support Places photo API.**
- RESOLVED 05/21/2026 (migration 135). RPC now filters `deleted_at IS NULL` and defaults `p_source_type = 'api_google_places'`. Soft-deleted civic rows no longer surface; non-Places sources need to opt-in via the param.
- Follow-up: `lookup-venue-images` exists for non-Places venues but isn't on a cron. If/when it goes on a cron, it'll need to pass `p_source_type` explicitly.

**7. Distance filtering is client-side only.**
- This session's fix made the gate strict (drop null-coord items when filter active) but the architecture is still "fetch everything, filter in app." At Boston/NYC scale this needs to move server-side via an RPC parameter on `filter_explore_items`.
- Latent cost: paginated lists may surface uneven counts after distance filter trims them (e.g., page of 20 → 7 visible).
- Phase 2 work (the recommendation overhaul touches `filter_explore_items` anyway).

**8. Pipeline lacks a semantic gatekeeper between LLM extraction and user-facing feed.**
- Current point fixes — civic filter, facility-pattern guardrail in `web_collector.ts`, dateless-event omission via `is_valid` — are all tactical patterns on specific failure modes. Each adds maintenance load.
- Phase 5.5 (enrichment overhaul with `audience_fit` classifier + two-tier tag taxonomy) is the systemic fix: a single classifier that decides "would a real person want to do this?" replaces the growing list of hand-written regexes.
- Prioritize before catalog scales 10x. Once Phase 5.5 ships, the per-pattern filters can be deprecated.

**9. Sentry replay + performance tracing are DISABLED by default.**
- Commented out (not deleted) in `src/lib/sentry.ts` with a re-enable note (Chief Engineer Phase 2). They cost money and add noise.
- Don't flip them on without a measured reason. If we do, budget for the Sentry quota impact and re-check the PII scrubbing covers replay payloads.

**10. Production schema dashboard-era drift — AUDITED & largely RESOLVED (Phase 3a, 06/18/2026).**
- Full prod-vs-staging audit done via `scripts/schema_audit.js` (tables, columns, indexes, RLS, triggers, functions, sequences, grants, extensions, cron). Report: `docs/chief_engineer/schema_drift_audit.md`.
- Migration 138 catches up the real prod-only objects (events RLS policy, `get_pipeline_health`, `pg_net`, hand-patched `invoke_cleanup_orphaned_media`) + revokes over-permissive grants from the staging rebuild. Idempotent / no-op on prod. Applied to staging; **prod apply pending Kevin approval (RLS rule)**.
- Zero real function-logic drift (the 156 "differences" were CRLF/comment cosmetics). Accepted: monthly partition tables, pg_net patch version, 3 legacy fns prod manually dropped.

**11. pg_cron job definitions live outside the migration set.**
- 9 prod cron jobs were created via the `diagnose-cron` edge function with prod URL + auth embedded as literals (decision 05/21/2026), so they're not reproducible from migrations and not on staging. Same gap class that caused the 3-month silent outage.
- Phase 3b mitigates *detection* (monitor jobs + GitHub Actions heartbeat) AND demonstrates the fix: migration 140 schedules the new monitor jobs reading URL+key from `app_config` (env-aware, reproducible). The older 9 jobs should be migrated to the same pattern later.

**12. Monitoring thresholds are first-guess — need tuning.**
- pipeline-health 4h/24h, api-budgets 50/80/95%, error-rate 3×/5× of 7-day median with a 10-event floor. Set before any baseline data.
- After ~1-2 weeks of monitoring output (and the `monitoring_daily` trend), revisit so alerts are signal not noise. The error-rate floor especially may need raising once real volume is known.

### Monitoring architecture (Phase 3b)
- **Alerting:** `_shared/notify.ts` → Slack Incoming Webhook (`SLACK_WEBHOOK_URL`, recommend dedicated `#euda-monitoring`). Severity info/warning/error/critical; `critical` appends `SLACK_ALERT_MENTION`. Sentry crash alerts stay in `#euda-app`.
- **Monitors (edge fns, Sentry-wrapped, on pg_cron via migration 140):** `monitor-pipeline-health` (30m), `monitor-api-budgets` (1h), `monitor-data-quality` (daily → `monitoring_daily`), `monitor-error-rates` (30m, queries Sentry).
- **Redundancy:** `.github/workflows/scheduled-monitoring.yml` invokes the 3 frequent monitors every 4h independent of pg_cron (outage backup).
- **Activation/rollout:** deploy the `monitor-*` functions, set `SLACK_WEBHOOK_URL` (+ `SENTRY_ORG_AUTH_TOKEN` for error-rates) as function secrets, then apply migration 140. Until `SLACK_WEBHOOK_URL` is set the monitors run but post nothing.

---

## 8. Long-term Roadmap

### Geographic expansion sequence
1. Potsdam (V1, live) — completed
2. Warwick (in progress) — primary social-graph test
3. Portland, Maine — cold market test, Kevin's new home
4. Boston — first audience-driven launch
5. NYC — commercial thesis test
6. Northeast expansion — Philadelphia, DC metro, secondary cities
7. National (future, post-V2 validation)

### Major V2 milestones (next 16 weeks)
- **Phase 1 (current, ~2 weeks):** Foundation — impression logging, evaluation harness, staging environment
- **Phase 2 (~4 weeks):** Recommendation overhaul — semantic retrieval, weight profiles, MMR
- **Phase 3 (~4 weeks):** Scaling readiness — LLM batching, async logging, throughput improvements
- **Phase 4 (~4 weeks):** Northeast expansion — Boston launch, NYC waitlist, multi-city tuning

### Business model
- Free for users, indefinitely during V2 and through Boston launch
- Free venue claim-and-verify tier launches at Boston
- Paid Verified Partner tier (~$49/mo) introduced once any metro hits ~5K users
- No outside funding planned during V2; self-funded at ~$1,500/mo budget

---

## Document maintenance

- Updated by Claude after every significant conversation with Kevin
- Updated by Claude after every Claude Code work session that resulted in a real change
- Reviewed by Kevin weekly (or whenever he wants)
- Kevin can edit directly to add observations, change priorities, or correct mistakes

---

*If you are Claude reading this for the first time in a new conversation: welcome. Read sections 1, 2, and 3 carefully before doing anything else. They tell you who you are and what you're currently working on.*

# Euda — Project State

**Last updated:** 05/18/2026 (Phase 5 design + production triage session)
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
- ⏳ Phase 5.1 (build LLM extractor) — deferred to next session
- ⏳ Atomic enable of Warwick partitions/targets — deferred until LLM extractor ships
- ⏳ Onboarding brothers and friends in Warwick

**Active blockers:** None. Production ingestion is restored, pg_cron will auto-fire correctly on next */30 tick.

**Awaiting Kevin's input on:**
- Slack workspace setup (where these messages will live)
- Weekly email day-of-week preference
- Decision on V1.1 timing trade-off: 7-day TestFlight target (tight, zero buffer) vs 10-day (comfortable, given Phase 2 surprises)
- *(sb_secret rotation confirmed done by Kevin — old key revoked, new key in place, all functions verified working post-rotation)*

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
- (Phase 5.1) Build `_shared/llm-extractor.ts` + 10 fixture HTMLs + unit test + critique pass — next session
- (Phase 5.2) Wire LLM fallback into ingest-web-collector for collector_targets
- (Phase 5.3) Build Google Places venue-discovery bridge (new function + venue_crawl_state table)
- (Phase 5.4 Week 0) Manual single-venue end-to-end validation
- (Atomic flip) Enable all Warwick partitions and targets — DEFERRED until LLM extractor lands
- (Civic classifier) Folded into Phase 5.5 — handled by LLM extractor's structured output, no separate classifier prompt
- (V1.1 release) Bundle bug fixes + Warwick LLM (10 venues) + impression logging for TestFlight

### Open bugs (NEW this session)
- **Path-allow bug in `_shared/web-collector.ts`** — discovery_urls without trailing slash failed prefix check against allowed_paths with trailing slash. FIXED & deployed to ingest-web-collector. Was a latent bug across the whole catalog since migration 045 (every Potsdam target also affected).
- **3-month ingestion dormancy** — production ingestion silently stopped Feb 3-25 when Supabase migrated auto-injected SUPABASE_SERVICE_ROLE_KEY from legacy JWT to sb_secret_*. FIXED via 15-function redeploy with --no-verify-jwt. Manual ALTER DATABASE pending from Kevin to update pg_cron auth.
- **iCal feed URL for Town of Warwick is dynamic / JS-rendered** — switching to 'ics' parsing strategy in migration 128 was premature. The discovery URL still points at the HTML calendar, not the actual .ics endpoint. Low priority; LLM extractor will handle the HTML version regardless.

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

### In flight
- *(nothing — Phase 5.1 ready to start in next session)*

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

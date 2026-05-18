# Euda — Project State

**Last updated:** 05/18/2026 1:20PM
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

**This week (Warwick, week of [DATE TBD]):**
- Complete Warwick data ingestion (migrations 126, 127, 128) — Claude Code mid-execution
- Verify the 9 flagged URLs before atomic enable
- Build trust in the autonomous-development pattern via Phase 1 setup
- Begin onboarding brothers and their friends to Euda in Warwick

**Active blockers:** None currently.

**Awaiting Kevin's input on:**
- Slack workspace setup (where these messages will live)
- Weekly email day-of-week preference
- Whether to verify Warwick URLs manually himself or let Claude Code do the web fetches

---

## 3. Recent Decisions

| Date | Decision | Rationale | Decided by |
|------|----------|-----------|------------|
| [today] | Adopt lead-engineer-agent model with Claude in role | Founder wants to spend time on app and business, not on technical operations | Kevin |
| [today] | PROJECT_STATE.md as single source of truth, lives in repo | Markdown is portable, Claude Code can read/write it, version controlled by default | Kevin + Claude |
| [today] | Slack for ping-me, weekly email for longer reports | Slack matches founder's existing communication habits; email allows for longer-form weekly context | Kevin |
| [recent] | Warwick before Portland in launch sequence | Founder will be physically present in Warwick, has dense social graph, brothers can help with acquisition | Kevin |
| [recent] | Scrap nearby-users feature for now (Bug 6) | Not actually a bug, user density doesn't justify building yet, friends-of-friends already covers the use case | Kevin |
| [recent] | Stage Warwick partitions and collector targets with is_enabled=FALSE for atomic flip | Avoid debugging a half-populated catalog if Phase 4 surfaces an issue | Claude (approved by Kevin) |
| [recent] | Bump PredictHQ monthly budget from 500 to 1000 | Now serving 2 geographies on same cap; raise proactively rather than reactively | Claude (approved by Kevin) |
| [recent] | Civic-meeting ignore_patterns at collector level, defer LLM enrichment classifier | Cheapest, most deterministic defense; defer global prompt change to its own scoped work | Claude (approved by Kevin) |

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
- Trigger to revisit: After Warwick curated collector targets are live for 1 week and we can quantify the gap
- Current default: Design now (Phase 5 of current Claude Code prompt), implement later
- Risks: Major infrastructure effort during a time we should focus on V2

**Q: When to enable the LLM reranker?**
- Trigger to revisit: After offline evaluation harness is in place and we have baseline metrics
- Current default: Disabled until measurable
- Risks: Shipping more sophistication without measurement infrastructure means we can't tell if it helps

---

## 5. Bug & Feature Backlog

### In flight
- (Migration 128) URL verification for 9 flagged Warwick collector targets
- (Atomic flip) Enable all Warwick partitions and targets once verified
- (Phase 4 of current prompt) Civic-meeting enrichment classifier — deferred
- (Phase 5 of current prompt) Venue-discovery bridge design — pending

### Open bugs
*(None currently known beyond what's already in flight)*

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

### In flight
- **Migration 126** (Warwick fetch partitions): written and applied
- **Migration 127** (Warwick collector targets): written and applied
- **Migration 128** (URL fixes): written and applied

### Disabled / Feature-flagged
- LLM reranker (`rerank-explore-items` edge function): deployed but feature flag off
- Eventbrite source: globally disabled (migration 036)

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
- PostgreSQL via Supabase, 108+ migrations applied to production
- Row-level security throughout
- Migrations numbered sequentially; never reuse numbers
- Migration apply pattern: write file → review → `supabase db push`

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

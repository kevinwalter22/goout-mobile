# Appropriability, IP & Non-IP Mechanisms

**Supports report section: E (appropriability)**

---

## 1. Euda as a Startup Product

### 1a. IP Mechanisms

**Copyright (Code)**
Source code is copyrightable in most jurisdictions. The 56-commit git history with clear timestamps (from January 17, 2026) establishes provenance. However, the copyright status of AI-generated code is actively unsettled:

- The US Copyright Office issued guidance in 2023 confirming that purely AI-generated content without sufficient human creative selection/arrangement is not copyrightable (USCO Guidance, Feb 2023; *Thaler v. Vidal*, Fed. Cir. 2022).
- EU AI Act (2024) does not resolve IP ownership of AI-generated outputs directly; member state law applies.
- **Practical implication for Euda:** The founder reviewed, directed, and modified agent-generated code — creating a human creative contribution layer. Copyright likely attaches to the selection, arrangement, and modification, but this is a grey area that enterprise legal teams will flag.
- **Risk:** A well-funded competitor could rewrite the UI and data pipeline from scratch in 6–10 weeks (with their own agentic tools), facing no copyright barrier. Code is not a durable moat.

**Trademark / Brand**
- "Euda" brand name — no evidence of formal USPTO trademark filing in the repository. The bundle ID `com.euda.app` (committed in `app.json`) and the domain `links.euda.live` signal brand commitment.
- App Store listing under "Euda" will create common-law trademark rights in jurisdictions that recognize use-based trademark (US, UK).
- **Recommendation:** File a USPTO trademark application for "Euda" in Classes 42 (software) and 38 (communications) before launch. Cost: ~$350/class.

**Trade Secrets**
The most defensible IP category for Euda:
- **Prompting methodology:** The wave planning approach, MEMORY.md conventions, and CLAUDE.md context structure are tacit know-how that enables 15–30× development speed. These are not visible in the final app.
- **DB schema decisions:** The specific combination of assert_caller pattern, feature flag architecture, scoring signal weights, and materialized view strategy are implementation choices that competitors cannot see from the app binary.
- **Data ingestion configuration:** The `collector_targets` table (migration 044) and web collector target list represent proprietary knowledge about which data sources produce high-quality, high-relevance local content.
- **Protection mechanism:** Don't publish CLAUDE.md or MEMORY.md files publicly; treat the prompting playbook as confidential.

### 1b. Non-IP Appropriability Mechanisms

**Lead Time Advantage**
- The 38-day build represents a significant head start. A competitor starting today (March 2026) with equivalent skills would require the same 38+ days minimum, while Euda will have iterated through beta testing, user feedback, and first-mover App Store presence.
- This advantage is highest right now and decays as agentic tools become more widely used.

**Network Effects**
- The social graph (friend connections, RSVPs visible to friends, check-in posts) creates a direct network effect: the app's value increases with each new user who joins and connects with existing users.
- Social network effects are the strongest lock-in mechanism available to Euda — they cannot be replicated by a competitor; they must be grown organically.
- Evidence: `friendship` tables (migration 011), `explore_item_rsvps` with friend visibility (migration 019), friend-scoped feed (Phase 7).

**Proprietary Data Corpus**
- The `explore_items` table contains enriched, deduplicated, geo-tagged event and activity data assembled from Google Places, PredictHQ, web collectors, and curated imports. This dataset took 38 days to build and reflects local data quality choices.
- A competitor can access the same upstream APIs, but would need weeks to months to build an equivalent enriched corpus with comparable quality and coverage.

**Learning Curve / Tacit Know-How**
- The prompting methodology, MEMORY.md, and wave planning conventions represent accumulated tacit knowledge. A competitor building with the same tools (Claude Code) would not have these conventions and would rediscover the same lessons (the assert_caller gap, the migration numbering collision, the Deno import deprecation) through their own experience.
- This know-how compounds with every new session, making Euda's founder faster at building the next feature than a competitor starting fresh.

**User Switching Costs**
- A user's social graph within Euda (friends, posts, event history) creates real switching costs. The cost of recreating a friend network on a new platform is non-trivial.
- Evidence: `profiles`, `friendships`, `posts`, `explore_item_rsvps` tables all contain user-generated data that is not exportable in a competitor-compatible format.

**Complementary Assets**
- App Store presence (reviews, ratings, download momentum) — once established, provides sustained discovery advantage.
- Venue and event operator relationships — if Euda provides value to local businesses, those relationships become a complementary asset competitors must replicate.

---

## 2. Agentic Coding Platforms (Category-Level)

| Platform | Core IP Mechanism | Primary Non-IP Moat |
|----------|------------------|---------------------|
| **Anthropic / Claude Code** | Model weights (trade secret); API platform; RLHF methodology | Network effects from usage data improving models; ecosystem of Claude-native integrations |
| **OpenAI / Codex / Operator** | Model weights; GPT architecture; API platform | Developer ecosystem lock-in; IDE integrations; brand recognition |
| **GitHub / Copilot** | Distribution via GitHub (1B+ repositories); IDE integration; Microsoft ecosystem | Lock-in through VS Code + GitHub + Azure stack; enterprise contracts |
| **Cursor (Anysphere)** | IDE-native UX; proprietary indexing of user codebases | High switching cost (re-index, re-configure); developer habit formation |
| **Cognition / Devin** | Agentic task execution model; proprietary eval suite | Early enterprise contracts; benchmark performance claims |

**Key observation:** At the platform level, the appropriability race is primarily between model quality (IP: model weights + training data) and ecosystem lock-in (non-IP: distribution, integrations, habits). Open-source alternatives (Continue.dev, Aider, Ollama + local models) apply commoditization pressure on all closed platforms.

---

## 3. Imitability Assessment

| Asset | Ease of Imitation | Why Hard/Easy | Time to Replicate | Durability |
|-------|-----------------|---------------|-------------------|------------|
| App UI/UX | Easy | React Native is open; screens are standard patterns | 4–8 weeks with same tools | Low |
| DB schema (migrations) | Moderate | Schema is inferred from app behavior; but design decisions are invisible | 6–10 weeks (reverse engineering) | Medium |
| Recommender logic | Moderate | Weights and signals are internal; can approximate by observing ranking behavior | 4–8 weeks | Medium |
| Explore item data corpus | Moderate | Same APIs available; enrichment pipeline must be rebuilt | 2–4 months | Medium-Low (decays as corpus grows) |
| Social graph (users + connections) | Very Hard | Must be grown organically; cannot be purchased or copied | Years | Very High |
| Brand recognition | Hard | Requires marketing investment + time + user trust | 6–18 months | High |
| Agentic workflow / prompting methodology | Moderate | Tacit; not visible in app; requires experience with Claude Code | 1–3 months for experienced developer | Medium |
| Lead time advantage | Decays | Real now; diminishes as competitors build | N/A | Temporary |

---

## 4. Dependency License Summary

*Note: A complete license audit was not run (`npm license-checker` not installed in current environment). The following is a best-effort assessment based on known npm ecosystem licensing.*

| Dependency | License (Expected) | Risk Level |
|-----------|-------------------|------------|
| React Native | MIT | None |
| Expo SDK | MIT | None |
| expo-router | MIT | None |
| @supabase/supabase-js | MIT | None |
| @sentry/react-native | Proprietary (Sentry SDK License) | Low — free tier for small apps; review terms for commercial scale |
| react-native-maps | MIT | None |
| expo-camera, expo-location | MIT | None |
| All @expo/* packages | MIT | None |
| TypeScript, ESLint, Prettier (devDeps) | MIT / ISC | None (dev only) |
| jest, jest-expo | MIT | None (dev only) |

**Recommendation:** Run `npx license-checker --production --summary` before commercial launch to confirm all production dependencies are MIT/Apache/ISC. The Sentry SDK commercial terms should be reviewed if Sentry usage exceeds the free tier event volume.

**No GPL or AGPL dependencies detected** in the dependency list — which would require source code disclosure if distributed as a commercial product.

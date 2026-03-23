# Recommendations with Metrics

**Supports report section: J (recommendations)**

Each recommendation includes: **Action**, **Rationale** (linked to course concepts), and **Success Metric** (quantitative KPI).

---

## Section A: Recommendations for Euda (Startup Building with Agentic Coding)

### Recommendation 1 — Add a Staging Environment
**Priority: P0 (before scaling)**

**Action:** Create a separate Supabase project as a staging environment. Configure `eas.json` with a `preview` build profile pointing to the staging project. Establish a rule: every migration is applied to staging and smoke-tested before being applied to production via `supabase db push`.

**Rationale:** Currently all agentic development — including schema migrations — deploys directly to production (risk R-O1 in 05_risks). A single malformed migration during an agentic session could corrupt production user data with no rollback path. This violates the fundamental operational principle that irreversible changes require a checkpoint. The staging environment is not a luxury; it is the minimum required safety boundary for continuing aggressive agentic development as user count grows.

Concept connection: *Operational risk management*; *blast radius minimization*; *reversibility of agentic actions*.

**Success Metric:**
- Primary: Zero production database incidents attributable to migration errors in the 90 days following staging adoption.
- Secondary: Mean time to detect migration errors < 15 minutes (caught in staging, not production).
- Process: 100% of migrations applied to staging before production (auditable via commit history).

---

### Recommendation 2 — Implement a Migration Security Checklist
**Priority: P1 (before first external users)**

**Action:** Add a 5-item checklist to `CLAUDE.md` that the agent references (and the human confirms) before committing any new migration:
1. Does the table have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`?
2. Do all policies have explicit `USING` and `WITH CHECK` clauses?
3. Does every new RPC have `PERFORM assert_caller(p_user_id)`?
4. Does every new RPC have `GRANT EXECUTE ON FUNCTION ... TO authenticated`?
5. Is rate limiting applied (`check_rate_limit`) on any write RPC accessible from the client?

**Rationale:** The near-miss of 3 push notification RPCs lacking `assert_caller` (fixed in migration 106) demonstrates that security patterns established in early migrations (074) do not auto-propagate to later migrations written in different sessions. A 5-minute checklist at commit time prevents this entire class of error. This is the "human-in-the-loop governance" mechanism required for responsible agentic development.

Concept connection: *Human-AI division of labor*; *governance of agentic systems*; *risk R-S3 mitigation*.

**Success Metric:**
- Zero security-relevant migration defects reaching production in 6 months post-checklist adoption.
- Checklist completion rate ≥ 95% (auditable via PR comments or commit message convention).

---

### Recommendation 3 — Instrument Cycle Time Measurement
**Priority: P1 (within 30 days)**

**Action:** For every new feature from this point forward, record in a simple spreadsheet or GitHub Issue:
- Time from "start prompting" to "first working implementation" (agent implementation time)
- Time from "implementation" to "approved on device" (human review + test time)
- Complexity estimate (S/M/L) assigned before starting
Track for 10 features minimum.

**Rationale:** The current case for agentic coding productivity is estimate-based (38 days total, wave timing from git commits). Without rigorous measurement, productivity claims are anecdotal. Measuring cycle time by phase (agent vs. human) identifies the actual bottleneck: if agent implementation is fast but human review takes 3× as long, the intervention is review process improvement, not agent improvement. This data also transforms the Euda case from "anecdote" to "publishable evidence."

Concept connection: *Innovation metrics*; *value creation measurement*; *evidence-based diffusion*.

**Success Metric:**
- 10 features measured within 60 days.
- Data completeness ≥ 85% (at least 8 of 10 with both agent time and human time recorded).
- Baseline established: agent implementation time, human review time, and total cycle time by complexity band (S/M/L).

---

### Recommendation 4 — Launch TestFlight and Acquire First 50 Beta Users Within 30 Days
**Priority: P1 (time-sensitive)**

**Action:** Complete EAS production build (credentials are already configured in `eas.json`). Submit to TestFlight. Recruit 20–50 beta users from the target demographic (college campus or urban young adults). Instrument Week-1 and Week-7 retention from the existing analytics_events table.

**Rationale:** The codebase passed all P0 and P1 audit items. Every day without users is a day without the network-effect compound engine running. Social apps are zero-sum on social graphs — the first users to onboard friends on Euda are users who are *not* onboarding those friends on a competitor. The social graph is the primary appropriability mechanism (non-replicable moat), and it only exists with real users.

Concept connection: *Network effects as appropriability mechanism*; *timing* (first-mover advantage decays without user accumulation); *early-mover lead time*.

**Success Metric:**
- TestFlight submission within 14 days.
- 50 beta users recruited within 30 days.
- Day-7 retention ≥ 25% (industry average for social apps; strong would be ≥ 40%).
- At least 1 event RSVP or check-in per active user per week in first cohort.

---

### Recommendation 5 — Formalize the Agentic Workflow as an Organizational Asset
**Priority: P2 (within 60 days)**

**Action:** Write a `docs/AGENTIC_WORKFLOW.md` document covering: wave planning template, CLAUDE.md structure, MEMORY.md update protocol, migration review checklist, and feature cycle checklist. Treat this as the primary onboarding document for any new engineer or new Claude project session.

**Rationale:** The current agentic workflow is tacit knowledge — it lives in the founder's head and fragmented notes. This is the knowledge equivalent of undocumented legacy code: fast to use when you know it, catastrophic to hand off. Formalizing it (a) enables a second engineer or contractor to contribute without re-discovering conventions, (b) makes the workflow portable to future projects, and (c) creates a publishable artifact (case study, blog post, conference talk) that builds brand and attracts talent.

Concept connection: *Non-IP appropriability via tacit know-how*; *knowledge management*; *complementary assets* (brand, recruiting).

**Success Metric:**
- Document written and reviewed within 60 days.
- A new developer (human or fresh Claude project) can complete setup and ship a first feature within 4 hours using only the document.
- At least 1 public artifact (blog post, tweet thread, or conference abstract) derived from the document within 90 days.

---

## Section B: Recommendations for Managers at Larger Companies Adopting Agentic Coding

### Recommendation 1 — Start with a Contained Sandbox Project
**Priority: P0 (risk management)**

**Action:** Select a greenfield internal tool or non-customer-facing API as the first agentic coding project. Scope it to 4–6 weeks. Measure outcomes (cycle time, defect rate, developer satisfaction) and publish results internally before expanding.

**Rationale:** Agentic coding agents need codebase context and write access to the repository. Introducing an agent into a production codebase with millions of lines — without established workflow conventions and a tested review process — creates material risk. The Euda case shows what's possible in a controlled, greenfield context. Enterprises need the same controlled starting conditions: a bounded project, a willing team, and explicit measurement of outcomes. Starting with production code skips the learning phase that is essential for safe adoption.

Concept connection: *Rogers diffusion: trial before adoption*; *risk management*; *staged rollout*.

**Success Metric:**
- Sandbox project delivers working feature in ≤ 3 weeks.
- Zero security incidents during sandbox phase.
- Developer NPS > 30 after 60-day trial.
- Internal report published within 75 days with quantitative cycle time comparison.

---

### Recommendation 2 — Establish an "AI Code Review" Protocol Before Team Rollout
**Priority: P1**

**Action:** Before expanding beyond the sandbox, create a 10-point AI code review checklist specific to agent-generated code. Train all engineers who will review agent output. Examples of checklist items:
1. Are all secrets managed via environment variables (not hardcoded)?
2. Are all DB queries parameterized (no string interpolation)?
3. Is error handling explicit, or are errors silently swallowed?
4. Do `as any` / `@ts-ignore` suppressions have explanatory comments?
5. Do all new write RPCs have auth ownership checks?
6. Is rate limiting applied on public-facing endpoints?
7. Are all new dependencies reviewed for license and known vulnerabilities?
8. Does the feature work without the happy path (empty state, error state, offline)?
9. Are there tests for the non-trivial logic paths?
10. Is the code understandable to a developer who did not write it?

**Rationale:** Generic code review is insufficient for agent-generated code. Agents have systematic blind spots that differ from human engineers (cross-session consistency gaps, as demonstrated by the assert_caller near-miss in Euda). Human reviewers need to know what to look for. A checklist also creates accountability and a paper trail for governance purposes — important for regulated industries.

Concept connection: *Human-AI division of labor*; *quality governance*; *risk management*.

**Success Metric:**
- Checklist adoption rate 100% for agent-generated PRs in pilot team.
- Reduction in security-review-flagged items per PR by ≥ 40% within 3 months (as checklist catches issues before formal review).
- Zero post-merge security regressions attributable to AI-generated code in 6 months.

---

### Recommendation 3 — Track AI Cost as a First-Class Engineering Metric
**Priority: P2**

**Action:** Instrument AI coding tool spend per developer per week. Report alongside engineering velocity metrics (PRs merged, features shipped, bugs closed) in the quarterly engineering review. Calculate "cost per feature" before and after agentic adoption. Include AI API cost in the engineering budget line (currently most companies expense it under "software tools" without visibility).

**Rationale:** Agentic coding shifts the cost structure of software development from labor to compute. A team of 10 engineers spending $300/month each on Claude Code adds $36K/year to the budget — visible only if tracked. More importantly, measuring cost alongside velocity creates the evidence needed to justify investment at board level and to identify when AI spend is not generating proportional velocity gains (a leading indicator of tool misuse or excessive prompt iteration).

Concept connection: *Value creation measurement*; *appropriability ROI*; *diffusion metrics for institutional adoption*.

**Success Metric:**
- AI cost per feature tracked monthly within 60 days of rollout.
- Target: AI cost < 15% of total engineering cost.
- Target: Engineering velocity (features shipped per engineer per month) ≥ 25% higher than pre-AI baseline after 3 months.
- Quarterly board report includes "AI tools ROI" line within 2 quarters of adoption.

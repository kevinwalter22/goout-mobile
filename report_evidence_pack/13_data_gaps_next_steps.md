# Data Gaps & Next Steps

**Supports: Methodology appendix; strengthens all sections with honest evidence disclosure**

---

## 1. Missing Measurements for Publishable-Quality Evidence

The following measurements are absent from the current evidence base. Without them, the Euda case is compelling but anecdotal — not peer-review-ready.

| Data Gap | Why It Matters for Report | Current Status | Priority |
|----------|--------------------------|----------------|---------|
| **Actual developer hours per feature** | Without this, all productivity ratios are estimates from git timestamps. True ROI requires hours input, not just calendar time. | Not tracked. Git timestamps give wall-clock bounds only — they include idle time, interruptions, review time undifferentiated. | High |
| **Baseline comparison (same feature, no AI)** | Without a control condition, the 15–30× compression claim has no counterfactual. The comparison to "traditional team" is estimate-based. | No control data exists. | High |
| **Defect rate (bugs per KLOC)** | Quality must be measured by outcomes (bugs found), not just process (CI passing). | No bug tracking system in place pre-launch; no post-launch defect data. | High |
| **Formal test coverage percentage** | "~20–30% estimated" is inadequate for a published report. | Jest configured but `--coverage` never run; no coverage report captured. | High |
| **AI API cost per feature** | Required to calculate the cost side of the productivity ROI. "$200–800 total" is a rough estimate. | Anthropic billing not segmented by feature or session. | Medium |
| **Cyclomatic complexity / code quality metrics** | "Complexity hotspot" claims in 04_quality need quantification. | No complexity analysis tool run (e.g., `complexity-report`, ESLint complexity rule). | Medium |
| **SAST scan results** | npm audit covers dependency vulnerabilities. SAST covers code-level vulnerabilities (injection, path traversal, etc.). | Semgrep, CodeQL, or Snyk not yet run. | High |
| **Actual line count (TS + SQL)** | "8,000–12,000 lines estimated" should be a measurement. | `wc -l` across source files not captured. | Low |
| **User retention and engagement (post-launch)** | Product quality ultimately measured by whether users return. | Pre-launch; no users yet. | High (post-launch) |
| **Time from feature idea to production deployment** | End-to-end cycle time (not just implementation time). | Not tracked. Would require instrumenting from "idea" (GitHub Issue creation) to EAS build to production `supabase db push`. | Medium |
| **Peer review quality of agent-generated code** | "Code quality" assessed by static analysis; not by independent human expert review. | Not done. | Medium |

---

## 2. 8-Week Data Collection Plan

*Designed to be lightweight and realistic for a solo founder who is also shipping product.*

### Week 1–2: Establish Baselines

**Day 1–2:**
- Run `npx jest --coverage` and save the full coverage report. Screenshot the summary. This establishes the test coverage baseline.
- Run Semgrep free SAST: `docker run --rm -v "$(pwd):/src" returntocorp/semgrep semgrep --config=auto /src/src`. Save the output to `docs/SAST_BASELINE.txt`.
- Run actual line count: `powershell -Command "(Get-ChildItem -Recurse -Include *.ts,*.tsx -Exclude node_modules | Get-Content | Measure-Object -Line).Lines"`. Record in a metrics doc.

**Day 3–5:**
- Export Anthropic API billing CSV for January–February 2026 from the Anthropic console. Record total spend.
- Create a simple "Feature Log" spreadsheet with columns: Feature Name, Complexity (S/M/L), Start Time, Agent-Done Time, Human-Approved Time, Notes.
- Set up GitHub Issues with a `bug` label for tracking post-launch defects.

**Day 7–14:**
- Build the next 2 features using the Feature Log — record times as you work.
- Create a GitHub milestone for "Beta v1.0" and link all planned features.

### Week 3–4: Active Measurement Phase

- Continue Feature Log for all new work.
- Tag each Claude Code session with a feature name; at session end, note the session duration (Anthropic console shows usage).
- Launch TestFlight to first 10 beta users. Begin recording Sentry crash rate and basic retention from analytics_events.

### Week 5–6: Qualitative Evidence Collection

- Interview 3–5 beta users: "What's working? What's confusing? What would make you use this weekly?"
- Ask 1–2 developer friends to do a 30-minute code review of 2 agent-generated files without knowing which ones. Record their findings vs. the audit's findings.
- Write a 500-word reflection on the development experience: what the agent got right, what it got wrong, what you had to correct.

### Week 7–8: Synthesis and Second Measurement

- Run `jest --coverage` again. Compare to Week 1 baseline — did coverage improve as new tests were added?
- Run Semgrep again. Compare to baseline — any regressions?
- Compile Feature Log data: compute mean and median cycle time by complexity band.
- Pull Supabase analytics_events: compute Day-1 and Day-7 retention for first beta cohort.
- Update this document with measured values replacing estimates.

---

## 3. Replicate Study Design

**Study Title:** "Agentic vs. Unassisted Feature Development: A Pilot Comparison"

**Purpose:** Provide directional comparative evidence for the productivity claim. Small-n pilot study, framed honestly as exploratory rather than statistically definitive.

**Setup:** Two developers of comparable experience (3–5 years, familiar with TypeScript and PostgreSQL). Developer A uses Claude Code. Developer B uses no AI coding assistance (standard IDE, documentation, Stack Overflow).

**Features to replicate** (chosen for clear scope and measurable correctness):

| Feature | Description | Why This Feature |
|---------|-------------|-----------------|
| 1. User preferences hook | React hook that reads/writes user preferences to a DB table with RLS | Tests: CRUD, RLS awareness, hook pattern |
| 2. Single-signal recommender | Score items by distance only; return sorted list | Tests: business logic, SQL integration, numeric correctness |
| 3. Rate-limited write RPC | PostgreSQL function: ownership check + rate limit + insert | Tests: security pattern comprehension, SQL authoring |

**Measurements per participant per feature:**

| Metric | How Measured |
|--------|-------------|
| Time to working implementation | Stopwatch from "start" to "first passing test or working demo" |
| Lines of code written | `wc -l` on the output files |
| Iterations required | Count of times developer revised code before working |
| Bugs found in review | 30-minute independent code review by third party (blind to which condition) |
| Security issues found | Checklist from 11_recommendations applied by third-party reviewer |
| Self-assessed confidence | 1–5 Likert scale: "How confident are you this code is correct and secure?" |

**Analysis:**
- Compare means across conditions for each metric.
- **Explicit caveats to state in report:** n=2 is underpowered; results are directional only; selection bias (developer skill match is imperfect); the features are simpler than a real production feature.
- **Frame as:** "Pilot study providing directional evidence; larger controlled study needed for statistical confidence."

**Expected finding (hypothesis):** Agent condition will show 3–8× faster time to working implementation; comparable or slightly worse security score (due to systematic blind spots); higher LOC (agents tend to be verbose).

---

## 4. Permanent Measurement Infrastructure for Euda

Euda already has significant instrumentation. The following 5 additions would provide a defensible ongoing measurement baseline within 3 months of launch:

| Addition | How to Implement | What It Measures |
|----------|-----------------|-----------------|
| **Bug tracking** | GitHub Issues with `bug` label; close issues with fix commit hash | Post-launch defect rate (bugs/week) |
| **Build cycle time** | EAS build metadata → timestamp from push to available in TestFlight | Deployment frequency; time-to-deploy |
| **Edge function error rate** | Add Sentry alert when edge function error rate > 1%/hour | Operational reliability |
| **Monthly AI cost report** | Anthropic billing CSV → spreadsheet → $/feature calculation | ROI measurement |
| **Quarterly SAST scan** | Add Semgrep as new GitHub Actions step; run on schedule | Security regression detection |

### Already Instrumented (Do Not Need to Add)

| Instrument | Table / Service | What It Captures |
|-----------|----------------|-----------------|
| Product analytics | `analytics_events` (migration 066) | User actions, navigation, feature usage |
| Security events | `security_events` (migration 076) | Auth failures, rate limit hits, report submissions |
| Pipeline health | `pipeline_health_log` (migration 033) | Data ingestion success/failure rates |
| Crash reporting | Sentry | JS exceptions, native crashes, session replay |
| CI results | GitHub Actions | Typecheck/lint pass rate per commit |

---

## 5. What Would Make This a Publishable Case Study

For the Euda case to be cited in academic or industry research (beyond a course report), it would need:

1. **Measured, not estimated, productivity data** — actual hours tracked for ≥10 features
2. **A comparison condition** — the pilot replicate study above, or a reference to a comparable non-agentic project
3. **Post-launch defect data** — 90 days of bug tracking after user-facing launch
4. **Independent code quality review** — a neutral senior engineer assessing the codebase quality without prior knowledge of how it was built
5. **User outcome data** — Day-7 and Day-30 retention from real users
6. **Transparent disclosure of failures** — the near-misses (assert_caller gap, duplicate migration, deprecated import) should be included, not hidden, to demonstrate the real failure modes of agentic coding

The current evidence pack is suitable for a graduate innovation report and provides strong anecdotal evidence. With the 8-week measurement plan above, it becomes suitable for an industry white paper or practitioner-focused publication within 3 months of launch.

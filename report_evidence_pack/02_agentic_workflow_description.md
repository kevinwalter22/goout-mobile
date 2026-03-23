# Agentic Workflow Description

**Supports report sections: B (Value creation), C (Division of labor), D (Limitations)**

---

## 1. Tool Stack

The Euda development workflow used the following toolchain:

| Tool | Role | Evidence |
|------|------|----------|
| **Claude Code** (Anthropic CLI) | Primary agentic coding agent — generates TypeScript, SQL, Deno/edge functions, tests, and documentation | Primary development tool; 56 commits |
| **VSCode** + Claude Code extension | IDE with inline agent integration; human review of diffs | Development environment |
| **TypeScript 5.9** | Static type checking; catches agent errors before runtime | `tsconfig.json`, CI step `tsc --noEmit` |
| **ESLint** + **Prettier** | Automated linting and formatting quality gates | `.github/workflows/ci.yml`, `package.json` scripts |
| **Jest** | Unit test runner | `src/lib/__tests__/`, `src/lib/moderation/__tests__/` |
| **GitHub Actions CI** | Runs typecheck + lint on every push; fails fast | `.github/workflows/ci.yml` (added Day 1: commit `chore: add CI`) |
| **Supabase CLI** | Applies DB migrations to production (`supabase db push`) | `supabase/` directory, 108 migrations |
| **EAS (Expo Application Services)** | Cloud builds + App Store/Play Store submission | `eas.json`, `app.json` |
| **Sentry** | Crash reporting, session replay, performance monitoring | `src/lib/sentry.ts` |

---

## 2. Prompting Patterns

The founder used a structured **"wave planning"** methodology, not ad-hoc prompting. Each wave was a multi-day sprint with a defined scope:

- **Wave 0 (Days 1–3):** Core platform scaffolding — Expo project, Supabase auth, feed, camera
- **Wave 1 (Day 13):** Recommender infrastructure — scoring engine, interaction learning, friend recommendations
- **Wave 2 (Day 13, same day):** Data pipeline — 7 sub-features: Eventbrite source, dedup detection, deterministic normalization, seasonal filtering, pipeline health monitoring, re-enrichment scheduler, fetch rotation + geo partitioning
- **Wave 3 (Days 16–17):** Data ingestion — Google Places adapter, web collector framework, Eventbrite deprecation
- **Security Wave (Days 28–32):** Security audit, RLS hardening, RPC ownership enforcement, secrets hygiene

Each wave sub-feature followed a consistent commit message schema: `feat(W2-4): add pipeline health monitoring` — enabling clean attribution and traceability.

**Context management:** Claude Code was initialized with:
1. A `CLAUDE.md` file containing project-wide conventions (migration naming, RPC patterns, feature flag structure)
2. A `memory/MEMORY.md` file (persisted across sessions) containing discovered conventions: `"Weights MUST sum to 1.0"`, `"RPCs use p_ prefix"`, `"Open-Meteo API needs &temperature_unit=fahrenheit"`
3. The full existing codebase visible in context at each session start

This context priming means the agent produced code **consistent with existing patterns** rather than reinventing conventions each session.

---

## 3. Division of Labor

### Human Role

| Responsibility | Examples |
|----------------|----------|
| Product decisions | Which features to build; prioritization; UX choices |
| Architecture approval | Approving or rejecting agent-proposed schemas, data models, API shapes |
| Credentials management | Supabase API keys, Google Places API key, Sentry DSN, EAS secrets |
| Physical device testing | Testing camera, location, push notifications on real iOS/Android devices |
| Code review | Reviewing diffs from agent; requesting changes; accepting/rejecting |
| App Store submission | Apple Developer account management, screenshot capture, metadata |
| Legal/compliance | Privacy policy, terms of service, data practices documentation |

### Agent Role

| Responsibility | Examples |
|----------------|----------|
| Code generation | TypeScript hooks, React Native screens, Supabase edge functions, SQL migrations |
| Refactoring | Applying security patterns retroactively (migration 074: `assert_caller` added to all pre-existing RPCs) |
| Test writing | Unit tests for scoring engine, moderation policy, grouping engine, formatting utilities |
| Documentation | 50+ markdown files in `/docs`: architecture docs, wave verification suites, privacy policy, moderation policy, analytics guide |
| Security auditing | Auditing own code for vulnerabilities; filing patches; writing CI security workflow |
| Bug diagnosis and fixing | Identifying root causes from error descriptions; proposing and implementing fixes |
| Commit message authoring | Writing conventional commit messages with `feat:`, `fix:`, `docs:`, `chore:` prefixes |

**Key insight:** The agent generated approximately 85–90% of the code by character count. The human's primary role was *orchestration and verification*, not implementation.

---

## 4. Typical Feature Cycle

The following is a reconstructed timeline for a mid-complexity feature (e.g., adding a new data source adapter, or a new recommender signal):

| Step | Actor | Activity | Estimated Time |
|------|-------|----------|----------------|
| 1. Plan | Human | Describes the feature goal, constraints, and success criteria to the agent | 5–10 min |
| 2. Implement | Agent | Writes code across multiple files (TypeScript hook, SQL migration, edge function if needed) | 15–60 min |
| 3. Review | Human | Reviews diff in VSCode; asks for adjustments if needed | 10–20 min |
| 4. Typecheck/Lint | CI (automated) | `tsc --noEmit` + `eslint` on push; agent fixes any errors | 2–5 min |
| 5. Test | Human / Agent | Agent writes unit tests; human tests on physical device | 15–30 min |
| 6. Commit | Agent | Stages files, writes commit message, commits | 2 min |
| **Total** | | | **49–127 min** |

**Concrete example — Wave 2 (January 29, 2026):**
Seven distinct data pipeline features were committed between approximately 19:00 and 19:35 EST — roughly 35 minutes of wall-clock time for 7 production-grade features. Commit timestamps:
- `19:00` — `feat(W2-1): add Eventbrite API source adapter`
- `19:02` — `feat(W2-2): add cross-source dedup detection`
- `19:09` — `feat(W2-3): add re-enrichment scheduler and backfill script`
- `19:19` — `feat(W2-4): add pipeline health monitoring`
- `19:25` — `feat(W2-5): add seasonal filtering and availability_json validation`
- `19:32` — `feat(W2-6): wire deterministic normalization into ingestion pipeline`
- `19:35` — `feat(W2-7): add fetch rotation and geo partitioning`

This pace is only possible with an agent that can hold the full schema, data model, and conventions in context simultaneously across all seven tasks.

---

## 5. Memory and Context Persistence

Claude Code uses persistent memory files to carry key architectural decisions and hard-won discoveries across sessions:

**`memory/MEMORY.md` (active contents, as of Feb 2026):**
- `"Weights MUST sum to 1.0 (dev assertion in config file)"` — prevents breaking the recommender
- `"RPCs use p_ prefix for params, SECURITY DEFINER, GRANT TO authenticated"` — enforces DB security conventions
- `"Open-Meteo API needs &temperature_unit=fahrenheit for °F"` — prevents weather signal bug
- `"RSVP hook at event/[id].tsx must pass { tags, itemKind } to useExploreItemRSVP"` — prevents a runtime crash

These notes represent **discovered invariants** — bugs or near-misses that occurred once and were captured so the agent never repeats them. This is the agentic equivalent of a team wiki, but auto-populated and always referenced.

---

## 6. Quality Gates

Every commit triggers automatic quality checks:

1. **TypeScript typecheck** (`tsc --noEmit`) — catches type errors before they reach production
2. **ESLint** — enforces code style and catches common React/React Native mistakes
3. **npm audit** — flags new dependency vulnerabilities
4. **Security workflow** (`.github/workflows/security.yml`) — dedicated security CI step added in commit `43389a6`

The CI was set up on Day 1 (commit `chore: add CI (lint + typecheck)`, January 17, 2026) — before any application code was written. This "CI first" discipline means the agent was constrained to produce type-safe, lint-passing code from the start.

---

## 7. Security Review Process

A dedicated security audit phase was executed entirely by the agent. Evidence from git log (February 17, 2026):

- `15:30` — `security audit and fixes` (commit `564e1ca`)
- `15:30` — `security audit` (commit `9ce4763`)
- `17:24` — `pre testing audits done` (commit `d346899`)
- `17:54` — `fix: CI green — typecheck, lint, npm audit, security workflow` (commit `43389a6`)

The agent audited:
- All Supabase RLS policies across 108 migrations
- RPC ownership (assert_caller pattern)
- Storage bucket policies
- Secret management (env var validation, `.env` in `.gitignore`)
- Rate limiting coverage
- npm dependency vulnerabilities

This self-auditing pattern is a distinctive capability of agentic coding: the agent can switch from implementation mode to adversarial review mode within the same session, reviewing code it just wrote with fresh skepticism.

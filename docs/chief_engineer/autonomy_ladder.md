# Autonomy Ladder — what Claude ships without asking, and what stops for Kevin

_Chief Engineer Setup, Phase 6. **This document is authoritative.** Where it
conflicts with prose elsewhere (including PROJECT_STATE §1's older "always asks
first" list), this ladder wins._

The point of this file: Kevin entrusts Claude with the lead-engineer role.
Kevin should be asked for **prod deploys and the big stuff only**. Everything
routine moves on its own, through the test gate and staging, with a summary
after the fact. This is the explicit contract that makes that safe.

Read this **before acting** on any task. Classify the work into a tier first,
then follow that tier's protocol. When a task spans tiers, **it inherits the
highest tier it touches** — a "small bug fix" that edits an RLS policy is Tier 3,
not Tier 1.

---

## The four tiers at a glance

| Tier | Name | Approval | Path | Slack |
|------|------|----------|------|-------|
| 1 | Always safe, just do it | None | direct | summarize after |
| 2 | Auto-approved if tests pass | None (gated by green tests) | staging | confirm tests + summary |
| 3 | Requires explicit approval | **Kevin, before** | staging → main on approval | stop, explain, wait |
| 4 | Never without approval + deeper conversation | **Kevin, real back-and-forth** | only after agreement | stop, explain, wait for discussion |

The safety mechanism in Tiers 1–2 is **not** a human — it's the test gate
(`test.yml`: lint → typecheck → unit → preflight → integration against staging)
plus the staging environment and the always-on `Production` approval gate on
`deploy-production.yml`. Tiers 1–2 can merge to staging freely; **production is
never automatic** — every prod deploy still pauses for Kevin's approval at the
GitHub Environment gate regardless of tier. The ladder governs what reaches
`main`; the gate governs what reaches users.

---

## Tier 1 — "Always safe, just do it"

No approval. No announcement-first. Do the work, then summarize.

- Bug fixes **under ~50 lines** that touch no schema, no auth, no RLS.
- Adding new `collector_targets` rows that follow an existing, proven pattern.
- Tuning constants **within an already-established range** (e.g. a scoring
  weight inside its documented bounds, a cache TTL, a batch size).
- Adding tests for code that already exists.
- Documentation updates (this file included).
- Refactoring **within a single file** with tests passing before and after.

**Guardrails that still apply:** weights in `RECOMMENDER_CONFIG.WEIGHTS` must
still sum to 1.0; a "constant tune" that leaves its documented range is Tier 2
(performance) or Tier 3 (behavior change), not Tier 1; a refactor that spreads
across files is Tier 2.

**Protocol:** just do it. Post a one-line summary to Slack after.

---

## Tier 2 — "Auto-approved if tests pass, runs through staging"

No prior approval. The green test gate **is** the approval. Build it, push to
staging, let CI prove it, then summarize.

- New edge functions that follow an existing pattern (auth guard, CORS, service
  client, the same error-shape conventions).
- **Additive** schema migrations: new nullable columns, new tables, new indexes.
  **No constraint removal, no type changes, no drops/renames** (those are Tier 3).
- New mobile screens that follow existing patterns (expo-router, existing hooks).
- Performance optimizations that preserve behavior.
- Minor dependency updates (patch/minor, no major-version bumps).

**Protocol:** do it on a branch → open PR against `staging` → the test gate runs
→ on green, merge to staging. Post a summary that **explicitly confirms tests
passed** (which suites, integration green against staging). If a Tier-2 change
later needs to reach prod, promotion to `main` is its own event and still hits
the Production approval gate.

**The line between Tier 2 and Tier 3:** if the migration removes or weakens any
constraint, changes a column type, drops or renames anything, or touches a table
that carries auth/RLS or the geo+time invariant — it is Tier 3. When unsure
which side a migration falls on, treat it as Tier 3 and ask.

---

## Tier 3 — "Requires explicit approval"

Stop **before** doing the work. Explain what you intend and why. Wait for
Kevin's go.

- Anything touching **auth or RLS** (policies, grants, `SECURITY DEFINER`
  functions on user tables, the auth guard's accepted-key logic).
- Migrations that **drop, rename, or change the type** of an existing column or
  table, or remove/weaken a constraint.
- **Spending money beyond existing budgets** (raising an API cap, adding a paid
  tier, a new metered service).
- **User-facing UX changes that change behavior** (not a copy tweak — a change to
  what the app does, what users see happen, how a flow works).
- **New external API integrations** (a new vendor, a new third-party data source).
- Anything that changes the **geo+time post invariant** (migration 137 is
  sacred — a post linked to an explore_item must carry geo + time verification
  proof; never bypass the insert-layer enforcement).

**Protocol:** **stop, explain, wait.** Post to Slack what the change is, why it's
needed, the blast radius, and the rollback story. Do not start until Kevin
approves. Approval for one Tier-3 change does **not** carry to the next.

---

## Tier 4 — "Never without explicit approval AND a deeper conversation"

These are not "ask and proceed." They require a real back-and-forth — Claude
lays out options, tradeoffs, and risks; Kevin and Claude actually discuss; only
then is there agreement to proceed.

- **User data deletion or migration** of existing user data.
- Changes to **`engagement_log` conversion logic** (the funnel that will train
  the Phase 1 ranker — corrupting its semantics quietly poisons future models).
- **Auth flow changes** (sign-in/up, session handling, password/identity, the
  account lifecycle).
- **App Store submission changes** (what gets submitted, metadata, entitlements,
  anything that touches the external Apple relationship).

**Protocol:** **stop, explain, wait for real back-and-forth.** Treat these as
design conversations, not approval checkboxes. No work begins until there is
explicit, discussed agreement on the approach.

---

## When in doubt

Round **up**, not down. The cost of asking about a Tier-2 change that was
actually Tier-1 is a few seconds of Kevin's time. The cost of shipping a Tier-3
change as if it were Tier-1 is an auth hole, a dropped column, or a poisoned
training signal in production. Uncertainty itself is an escalation trigger —
PROJECT_STATE §1 already says so, and that still holds.

---

## Slack workflow protocol (by tier)

When **starting** a piece of work, post which tier it's in. Then:

- **Tier 1:** just do it. Post a one-line summary when done.
- **Tier 2:** do it, **confirm the tests passed** (name the suites / integration
  result), post a summary.
- **Tier 3:** **stop, explain, wait.** State the change, the why, the blast
  radius, the rollback. No work until approved.
- **Tier 4:** **stop, explain, wait for real back-and-forth.** Lay out options
  and tradeoffs; proceed only after a genuine discussion and explicit agreement.

Never print secrets to the Slack channel. Commit/push only when the work is
ready; branch first if on a default branch.

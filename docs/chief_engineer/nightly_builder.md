# Nightly builder — runbook

The overnight autonomous builder. Claims `ready` tasks from the `build_tasks`
queue, implements + self-tests each, and opens a **needs_kevin** PR per success.
**It never merges** — every task ends at a PR Kevin approves. Proven by the
screenshot-loop dry-run (T6) before it was ever turned on.

Files: `.github/workflows/nightly-builder.yml` (schedule + dispatch),
`scripts/builder/run_night.mjs` (orchestrator), `scripts/builder/feed_screenshot.mjs`
(the proven staging-feed screenshot helper for visual self-tests).
Queue + guardrails: migration 154 (`build_tasks`, `claim_build_task`,
`build_queue_enabled`, `build_queue_guardrails`). Task specs: `build_task_spec.md`.

## Per-task loop
`claim_build_task` → set `in_progress` → branch `chief/<id>` off `staging`
(or off the parent's branch when `spec.stack_on` is set) → `claude -p` implements
per the spec and self-tests → open PR to `staging` → set `needs_kevin` + `pr_url`.

Self-test = the task's `acceptance.checks`: `typecheck` + `npm test` (a unit test) +
`expo export --platform web`, and — for **visual** tasks (`spec.visual`) — a
Playwright screenshot of the served feed that Claude **reads and evaluates** against
the acceptance criterion.

## The two permanent rules
1. **Visual self-test is mandatory.** If a screenshot can't be captured or can't be
   confidently evaluated, the task flips to **`needs_device`** and opens only a
   **DRAFT** (not merge-ready) PR. A visual change is never shipped unseen.
2. **Never two same-file tasks in parallel per night.** A same-file pair is allowed
   only when one **stacks on** the other (`spec.stack_on` → serial: the second
   branches off the first). Otherwise the lower-priority one is **deferred** to a
   later night (released back to `ready`). Under-fill rather than create a morning
   merge mess.

## Guardrails (`build_queue_guardrails` flag config)
`max_tasks_per_night` (4) · `max_cost_usd_per_task` (8) · `max_cost_usd_per_night`
(25) · `model` (sonnet) · `lease_minutes` (30).

Turn/wall caps are **split by task type**, because the visual screenshot loop is far
more turn-hungry than non-visual work (a measured known-good visual task took ~61
tool-rounds / ~13 min to complete; a non-visual one ~13 turns):
- **non-visual:** `max_turns_per_task` (40) · `max_wallclock_min_per_task` (30)
- **visual:** `max_turns_visual` (120) · `max_wallclock_min_visual` (45)

A task that hits a turn/wall cap or crashes but **left changes in the working tree**
is committed and opened as a **DRAFT PR** ("PARTIAL — hit cap, needs continuation"),
so near-complete work is never lost to a hard kill. Only a genuinely empty tree →
`blocked`. The night stops at the per-night cost cap.

## Batch composition (learned night one)
Night one ran 4 tasks: the 1 non-visual **passed**, all 3 visual **failed** (turn
cap, serve-hang, turn cap). Non-visual work is cheap (~13 turns, ~$0.15) and reliable;
visual work is expensive (~61 turns, ~$1+) and fragile (screenshot loop + login +
virtualized scroll). So a night should be **mostly non-visual with at most 1–2 visual**,
and those visual tasks **must be independent** (not `stack_on` each other) so one
failure can't block another. Never stack 4 visual tasks in one night.

## Safety
- **Kill-switch:** `build_queue_enabled` (OFF by default). While OFF, `claim_build_task`
  returns nothing and the workflow no-ops. Flipping it never touches the read-workers.
- **Never merges**, never touches prod, Tier 1-2 only (a Tier-3 need → the task
  self-reports `fail`). The prod service-role key stays in the orchestrator; each
  `claude -p` subprocess runs with a scrubbed env (no prod keys, no `ANTHROPIC_API_KEY`,
  no `GITHUB_TOKEN`) — subscription OAuth only.
- Auth: `CLAUDE_CODE_OAUTH_TOKEN` (Max subscription; never alongside `ANTHROPIC_API_KEY`).

## Running night one
1. Confirm the `ready` tasks are seeded (`build_tasks` where `status='ready'`).
2. Flip the kill-switch: `UPDATE feature_flags SET is_enabled=true WHERE flag_name='build_queue_enabled'`.
3. **Run workflow** → "Nightly builder" (workflow_dispatch), or wait for the 07:00 UTC cron.
4. Each task lands as a `needs_kevin` PR to `staging` (drafts for anything device-flagged),
   with a Slack line and the screenshots in the run artifacts.
5. Review each PR the next morning — the fix AND whether its self-test (screenshots
   included) did its job. Merge the good ones; comment/close/reopen-as-`ready` the rest.
6. Turn the cap up as trust builds. Flip the kill-switch OFF anytime to pause.

Note: creating PRs from Actions requires the repo setting **Settings → Actions →
General → "Allow GitHub Actions to create and approve pull requests"** to be ON
(enabled 2026-08-15 — without it the builder's `pulls` POST 403s and leaves the branch
pushed-but-PR-less, which is what stranded night-one's T1). PRs are opened with the
default `GITHUB_TOKEN`, so the PR's own CI gate does not auto-run (GitHub suppresses
workflow-triggered workflows) — the builder's self-test is the pre-merge check; the
full test gate runs on merge to `staging`. If auto-open ever fails again, the
orchestrator now leaves the branch pushed and flags it (`blocked` + Slack) rather than
faking a `needs_kevin` with no PR.

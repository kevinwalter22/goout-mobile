# Chief-engineer read-workers (Phase A)

Three weekly, **report-only** GitHub Actions workers that run on Kevin's Max
subscription and post to **#euda-chief**. They ship no code and cannot: each has
`contents: read`, no PR/issue write, and never commits. This is the read-half of
the scheduled autonomous-engineering system; the code-writing **builder is
deliberately NOT built yet** (pending the single-task quota measurement).

## The workers

| Worker | Cron (UTC) | max-turns | What it does |
|---|---|---|---|
| Auditor | Mon 12:00 | 30 | North Star Level-1/2 curation scorecard + week-over-week delta + "what to fix first" |
| Maintainer | Wed 12:00 | 15 | Dependency / deprecation / security watch across the real stack, tagged by autonomy tier |
| Researcher | Fri 12:00 | 15 | Ideas only — quick wins, improvement bets, competitive / ecosystem notes |

## How they run (terms-clean + free-at-the-margin)

- Auth: the official `anthropics/claude-code-action@v1` with
  `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}` — Kevin's Max
  subscription, **never** `ANTHROPIC_API_KEY` (which would shadow it into
  pay-per-token; auth precedence is API key > OAuth > login). The official action
  is the sanctioned client for subscription automation; a home-rolled harness or
  SDK around the token would violate Anthropic's Consumer Terms — don't.
- Model: `--model sonnet` for all three (cheap on quota).
- They draw on the **same weekly Max pool** as Kevin's interactive work; weekly
  cadence keeps the draw negligible. When the pool is exhausted the run stops
  read-only (no overage billing), and the finish step reports it.

## Guardrails (no silent failure, no runaway)

- **Guaranteed heartbeat:** workflow steps (not Claude) post `🟡 starting` and
  then `✅ report` / `🔴 did not finish` to #euda-chief via
  `scripts/worker_slack.mjs`. Every run is accounted for.
- `--max-turns` cap + job `timeout-minutes` + per-worker concurrency group
  (`cancel-in-progress: false`), weekly cron = 1 run/week each.
- The Claude step never holds prod credentials: the auditor's prod service-role
  key lives only in the read-only gather step
  (`.github/scripts/gather_audit_inputs.sh`), which writes JSON the Claude step
  reads. The Claude step's env carries no Supabase keys and no API key.
- The report reaches Slack via a file (`./chief-report.md`) the workflow reads —
  Claude writes only that file; nothing is ever committed.

## The curation scorer (auditor's new substrate)

- Migration **153**: `curation_audit` (daily snapshot table for trends) +
  `compute_curation_scorecard()` (deterministic Level-1/2 scoring, read-only,
  `SECURITY DEFINER`, `service_role` only).
- Edge fn **`audit-curation-quality`**: runs the scorer, persists the daily
  snapshot, returns `{ current, previous }` for the week-over-week delta. Does not
  post to Slack — the auditor worker composes the #euda-chief report.
- **Honest scope gaps:** `coverage_pct` is null (Level-3 reference sets aren't
  built — North Star §10); notability is *proxied* (confidence + hidden-gem) with
  the qualitative "would a local recommend this" judgment done by the auditor on a
  small sample; intent is proxied by `category` until the intent layer exists.

## Activation checklist

1. `CLAUDE_CODE_OAUTH_TOKEN` repo secret (from `claude setup-token`).
2. `SLACK_CHIEF_WEBHOOK_URL` repo secret (incoming webhook bound to #euda-chief).
3. Migration 153 + `audit-curation-quality` deployed to prod through the gated
   pipeline (staging → main → Production approval gate).
4. Merge to `main` — GitHub runs scheduled workflows only from the default
   branch, so the weekly crons activate there. Test earlier with **Run workflow**
   (workflow_dispatch) on the branch.

Until both secrets exist the workers are inert (the Slack helper no-ops; the
Claude step has no token), so landing this is safe.

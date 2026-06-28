# Batches API for enrichment — design (Tier 3, design-first)

**Status:** **APPROVED** by Kevin 2026-06-28 (design). **Implementation gated** until P-C
settles (48h aggregator stability + day-3 steady-state cost confirmation), then staged
rollout starting at `shadow`; quality numbers (schema-valid rate, tag counts, validation
classes) reported before each `shadow→canary→batch` step.
**Author:** Claude (chief engineer), 2026-06-28.
**Goal:** cut enrichment LLM spend ~50% via the Anthropic Message Batches API, without
regressing quality or the freshness of newly-ingested items.

---

## 1. Why batches (and where the value actually is)

The Batches API runs standard Messages requests asynchronously at **50% of token price**
(≤100K requests / 256 MB per batch; most finish ≪1h, hard cap 24h; results retained 29
days). Enrichment is cron-driven and **not latency-critical**, so async fits.

**Honest ROI framing:** in the *storm-fixed steady state* (migration 142), enrichment only
touches new / below-`enrichment_version` items — a trickle — so the absolute monthly saving
is small. **The real value is BACKFILLS:** the current ~3,076-item drain, and any future
deliberate re-enrichment (a `v3` bump for better tags). Batching a ~4,000-item re-enrich at
50% off is the saving that matters. So the design optimizes for *bulk* while keeping a
*sync fast-lane* for freshness.

Caching is **not** part of this — separately measured: enrichment prompt ≈ 3,416 tokens <
Haiku 4.5's 4,096 cache floor (see token-audit + extractor-caching investigation).

---

## 2. Current sync flow (unchanged, kept)

`run-enrichment-queue` (cron) → `claim_enrichment_job` (one at a time, marks `running`) →
`needsEnrichment` skip-guard → `buildEnrichmentPrompt` → `llm.chat` (Haiku 4.5 primary) →
`validateEnrichmentResponse` → `apply_enrichment` (sets `enrichment_version=2`) →
`complete_enrichment_job`. Guards: 110s wall-clock, `max_items=25`/run,
`check_llm_daily_budget` (1000/day), `record_llm_usage` per call. Stuck `running` jobs are
reset by `reset_stale_enrichment_jobs` (cron, migration 141).

**Keep this entirely.** It becomes the *fast lane* for fresh/urgent items.

---

## 3. Proposed side-by-side architecture

A new async path runs **alongside** sync, gated by a flag. Three new pieces:

### 3a. State (additive migration)
- `enrichment_queue.status`: add **`batched`** (claimed-but-in-flight-via-batch), distinct
  from `running` (sync in-flight). Lifecycle: `queued → batched → done|failed` (or back to
  `queued` on requeue).
- `enrichment_queue.batch_id` (nullable uuid FK → `enrichment_batches.id`).
- New table **`enrichment_batches`**: `id`, `anthropic_batch_id`, `status`
  (`submitted|ended|reconciled|expired|canceled|error`), `job_count`, `submitted_at`,
  `ended_at`, `succeeded`, `errored`, `expired`, `canceled`, `input_tokens`, `output_tokens`.
- Feature flag `enrichment_mode` in `feature_flags`: `sync` (default) | `shadow` | `canary` |
  `batch`. Default `sync` → **zero behavior change on deploy** (Tier-2 additive).

### 3b. `submit-enrichment-batch` (new edge fn, cron)
1. Budget gate **at submit time** (cost is incurred on submission): check a batch-aware
   daily cap.
2. Claim up to N eligible jobs via a new `claim_enrichment_jobs_for_batch(p_limit)` that
   marks them `batched` + stamps a placeholder `batch_id` (atomic, like `claim_enrichment_job`).
   Apply the same `needsEnrichment` pre-filter so we don't pay to re-enrich good items.
3. Build N requests, **`custom_id = job_id`**, identical model/prompt/params as sync.
4. `POST /v1/messages/batches`; store `anthropic_batch_id` + flip the jobs' `batch_id` to the
   real row. On submit failure → release jobs back to `queued` (nothing half-committed).

### 3c. `poll-enrichment-batches` (new edge fn, cron ~15 min)
For each open `enrichment_batches` row: `GET /v1/messages/batches/{id}`.
- still `in_progress` → update counts, move on (unless age > 24h → treat as expired, §5).
- `ended` → stream `/results`; per item (`custom_id` = job_id): apply the **same**
  validate → `apply_enrichment` → `complete_enrichment_job` logic as sync. Tally tokens
  (`record_llm_usage`, at the 50% rate). Mark batch `reconciled`.

Idempotency: `custom_id`=job_id; `apply_enrichment` overwrites and `complete_enrichment_job`
is a status set, so re-running `/results` after a poller crash is safe.

---

## 4. Migration path (gradual, reversible at each step)

| Phase | `enrichment_mode` | Behavior | Exit criteria |
|---|---|---|---|
| 0 | `sync` | New fns + table deployed, **dormant**. No traffic to batch. | Deploys clean; flag off. |
| 1 **shadow** | `shadow` | Sample ~200 items go through batch **in parallel**; results compared to sync, **not applied**. | Quality parity (§5) met. |
| 2 **canary** | `canary` | ~10% of bulk jobs routed to batch (results applied); 90% sync. | 48h: error/expiry rate < 2%, cost ≈ 50%, no quality drift. |
| 3 **batch** | `batch` | **Full cutover:** bulk → batch; **sync fast-lane retained** for fresh items only — **rule: age < 1h** (no priority gating; see decision (a)). | Steady state. |

Rollback at any phase = flip `enrichment_mode` back; in-flight batches reconcile or expire-requeue harmlessly. No data migration to undo.

---

## 5. Quality verification (sample size + method)

The batch path uses the **identical model + prompt + temperature** as sync, so output quality
is drawn from the *same distribution* — this is **not** a model-quality A/B. What must be
proven is **pipeline correctness**: parsing, schema validation, apply, and error handling
behave identically when results arrive via batch instead of inline.

- **Shadow sample: ~200 items** spanning kinds (event/activity), categories, and
  enrichment-thinness (some below-v2, some at-v2-thin). 200 gives a tight functional check
  and ≥95% confidence to detect a ≥3pp regression in schema-valid rate.
- **Compared fields per item:** schema-valid (yes/no), `tags` count, `hook_line` present,
  `price_bucket` resolved, validation-rejection reason. 
- **Acceptance gates:**
  - batch schema-valid rate within **2pp** of sync on the same items,
  - **zero** new validation-failure classes attributable to the batch path,
  - token accounting reconciles (sum of per-result `usage` ≈ batch-level), billed at 50%.
- Output stored side-by-side in a temp `enrichment_shadow_compare` table for diffing; dropped after sign-off.

---

## 6. Failure handling + expiry semantics

**Per-item result types** (from `/results`):
- `succeeded` → validate → apply → `complete(success)`. Validation fail → `complete(fail)`,
  attempts++ (existing exponential backoff applies).
- `errored: invalid_request` → `complete(fail)` + log; **do not auto-resubmit** (deterministic
  failure — would just fail again).
- `errored: server/api` / `canceled` → **requeue** (`batched → queued`, clear `batch_id`).
- `expired` → **requeue**.

**Batch-level / expiry:**
- Submit API error → jobs released to `queued`, batch row not created.
- A batch `in_progress` > 24h → Anthropic expires it; poller marks batch `expired` and
  **requeues all its still-`batched` jobs**. A new **`reset_stale_batched_jobs(p_hours)`** cron
  (sibling of `reset_stale_enrichment_jobs`) is the backstop: any job `batched` with no live
  batch, or older than the expiry window, returns to `queued`.
- Budget: enforce the daily cap **at submit** (requests counted when sent); `record_llm_usage`
  on reconciliation with **halved** cost (50% batch rate) so the budget/accounting stays honest.

**Freshness guard:** because a batch can take up to ~1h (rarely 24h), brand-new items would
wait longer than today. The retained **sync fast-lane** (Phase 3) enriches **age < 1h** items
inline so the card feed never shows long-lived un-enriched items; only the bulk backlog goes
async. (Decision (b): the ~1h bulk delay is acceptable pre-launch — small trusted user base
won't perceive sync vs 1h-batch; full cutover, not backfill-only.)

---

## 7. Monitoring additions

- `enrichment_batches` dashboard metrics: open batches, oldest open age, succeeded/errored/
  expired counts, per-batch token totals.
- `pipeline_health_log` rows for `enrichment_submit` and `enrichment_poll` stages.
- **Alerts:** batch open > 2h (slow), > 20h (expiry risk), poller failure, submit failure,
  shadow/canary quality gate breach.
- Daily cost line: batch spend (50% rate) vs the prior sync baseline — confirm the saving is real.
- Extend `scheduled-monitoring.yml` to ping the poller (pg_cron + `--no-wait` backup, same
  pattern as the other monitors).

---

## 8. Implementation footprint (when approved)

- 1 additive migration: `status` enum value, `batch_id` col, `enrichment_batches` table,
  `claim_enrichment_jobs_for_batch` RPC, `reset_stale_batched_jobs` RPC + cron, the
  `enrichment_mode` flag row. (Tier 2 additive — but the *feature* is Tier 3.)
- 2 edge fns: `submit-enrichment-batch`, `poll-enrichment-batches` (raw `fetch` to the
  batches endpoints, consistent with the existing `llm-provider` raw-fetch pattern; no new SDK).
- Cron schedules for submit + poll.
- Shadow-compare scaffolding (temp table + a compare script), removed after sign-off.

**Decisions (Kevin, 2026-06-28):**
- **(a) Fast-lane threshold = `age < 1h`.** No priority gating on top — no signal to tune it
  yet; keep the rule simple and easy to remove later.
- **(b) ~1h bulk-enrich delay is acceptable pre-launch. Full cutover** (Phase 3 `batch`), not
  backfill-only — the 50% saving on the v3 re-enrich pass alone justifies the work.
- **(c) Batch size per submit = 500.**
- **Sequencing:** no implementation until P-C settles (48h aggregator clock + day-3
  steady-state). Then staged rollout from `shadow`; quality numbers reported before each
  `shadow→canary→batch` advance.

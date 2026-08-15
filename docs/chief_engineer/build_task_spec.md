# Build-task spec — the canonical reference

**This is the most important artifact in the overnight-builder system.** It is what keeps the builder **cheap and accurate** instead of expensive and exploratory. Every task added to `build_tasks` is checked against this doc before it becomes `ready`. Future Kevin, and every future session, calibrate here.

## Why this doc exists (the measurement that proves it)

The B2 quota probe (2026-08-14) measured one **well-scoped** Tier-1/2 task at **≈ $0.79 / ~2 min / 13 turns** on Opus. The load-bearing finding: **scoping quality — not the quota — is the cost and quality driver.** A vague or oversized task costs **5–20×** a well-scoped one (more exploration, more iteration) *and* produces worse output. A queue of vague tasks makes overnight building expensive and bad; a queue of tight specs makes it cheap and good.

So the queue's real product is **well-specified tasks**, and this doc is the spec.

## The gate rule (memorize this)

> **A task belongs in the overnight queue only if a competent engineer could do it without asking questions.**

If a task needs **product-taste decisions** or **open-ended exploration**, it is **not** a queue task — it is a conversation with Kevin first, then a queue task once scoped. The Auditor/Researcher **surface candidates** (as `draft`); a human (or a scoping step) turns them into `ready` specs. **The builder never invents its own work.**

This is enforced structurally: the `build_tasks` trigger blocks any non-`draft` task whose `spec` lacks `why/files/change/context/out_of_scope` or whose `acceptance` lacks `checks`. But **schema-complete ≠ sharp** — this doc is the bar for *sharp*.

## The template (maps 1:1 to `build_tasks.spec` / `.acceptance`)

```jsonc
{
  "title": "one line — what the task delivers",            // build_tasks.title
  "tier": 2,                                                // 1 or 2 ONLY
  "needs_device": false,                                    // map/camera/native → true (built, never merged)
  "spec": {
    "why":     "the user-facing symptom (grounds the change, stops scope drift)",
    "files":   ["src/exact/File.ts", "grep: SymbolName"],  // #1 COST LEVER — exact files/entry points + grep hints
    "change":  "precise, bounded description of the edit. Target < ~150 lines / a few files.",
    "context": ["what to READ to understand HOW: related code, a similar past fix, the North Star / design-doc section"],
    "out_of_scope": "what NOT to touch; don't refactor beyond the ask; don't touch auth/RLS/schema"
  },
  "acceptance": {
    "checks":   ["npm run typecheck", "npm test — add/adjust test X proving Y",
                 "npx expo export --platform web passes",
                 "browser: <what the web self-test should show/screenshot>"],
    "done_when": "one sentence: the observable done condition"
  }
}
```

**Field notes:**
- `files` says **where** to change — this is what stops the builder from expensive whole-subsystem exploration.
- `context` says **what to read to understand how** — the B2 measurement showed codebase context (the big cache-read) is what makes a task cheap; pointing the builder at the right prior art up front cuts exploration turns further. `files` ≠ `context`: one is where you edit, the other is what you study.
- `acceptance.checks` must be **checkable by the builder itself** (typecheck / unit test / web export / a browser screenshot assertion). If the only way to verify is a human on a device, it's `needs_device` — and biased *out* of early batches.

## The calibration pair (permanent — do not delete)

Every future task is measured against these two. Keep both here forever.

### ✅ GOOD — bounded, exact, checkable (this is the F5/2b task; measured $0.79 / 13 turns)
```jsonc
{
  "title": "Per-group minItems so niche card groups surface",
  "tier": 2, "needs_device": false,
  "spec": {
    "why": "Niche card groups need the global minimum of 3 items to appear, so the grouped explore feed collapses to a few broad groups and feels random.",
    "files": ["src/config/groupTaxonomy.ts", "grep: GroupDefinition, minItemsPerGroup in src/lib/groupingEngine.ts"],
    "change": "Set minItems:2 on the niche groups (date_night, pet_friendly, volunteer). The grouping engine already honors a minItems field; just use it. Add definingTags where a niche group is missing them.",
    "context": ["QUALITY_AUDIT.md Finding F5 / fix 2b", "src/lib/groupingEngine.ts already reads minItems", "the existing group defs in groupTaxonomy.ts for the shape"],
    "out_of_scope": "Do not change the grouping engine internals or the global default; presentation only."
  },
  "acceptance": {
    "checks": ["npm run typecheck", "npm test — add a groupingEngine test proving a 2-item niche group surfaces while a non-override group stays gated at the global min of 3", "npx expo export --platform web passes"],
    "done_when": "A niche group with 2 matching items renders in the grouped feed; groups without an override are unchanged."
  }
}
```
*Why it's good:* exact files, a change a competent engineer does without questions, a unit test as the acceptance proof, explicit out-of-scope. Small blast radius.

### ❌ BAD — vague, unbounded (costs 5–20×, unpredictable output)
> **"Make the card view feel less random."**

*Why it's bad:* no files, no bounded change, no checkable acceptance, and it smuggles in product-taste decisions. The builder would explore the whole grouping + scoring + enrichment stack, burn turns, and ship something Kevin didn't ask for. This is a **conversation**, not a queue task — it becomes queue tasks only after it's decomposed into sharp pieces (F5/2b is one such piece).

## First-batch bias (early nights)

Until trust is built, bias `ready` tasks toward:
- **Browser-testable** (`needs_device:false`) — the builder can fully self-verify, so Kevin reviews clean self-tested work, not device-flagged half-work.
- **Bounded** — target the F5/2b size (few files, a clear change), not big ones.
- **Mostly non-visual** — night one proved `spec.visual` tasks (the screenshot loop) are ~5× costlier (~61 turns vs ~13) and far more fragile than non-visual: a night should be **mostly non-visual with at most 1–2 visual**, and those independent (not `stack_on` each other) so one failure can't block another. Never stack 4 visual tasks. See `nightly_builder.md` → Batch composition.
- **Genuinely valuable** — real fixes Kevin wants, never filler to exercise the system.

`needs_device` tasks (map/camera/native) are legitimate queue tasks, but the builder implements + flags them for Kevin's device review and **never merges** — keep them out of the first batches.

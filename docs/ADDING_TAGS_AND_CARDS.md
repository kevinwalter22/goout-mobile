# How to Add New Tags & Cards

Quick reference for extending the Euda tag taxonomy and explore card system.

---

## 1. Adding a New Tag

Tags are the atomic building blocks. Every tag flows through three files that **must stay in sync**.

### Step 1 — Canonical source

Add the tag to `src/config/tagTaxonomy.ts` under the appropriate section:

```ts
export const CANONICAL_TAGS = [
  // ── Vibe ──
  "nightlife",
  "relaxing",
  "your_new_tag",   // <-- add here
  ...
] as const;
```

Update `CANONICAL_TAG_COUNT` at the bottom of the file to match the new array length.

### Step 2 — Enrichment mirror

Copy the exact same tag string into `supabase/functions/_shared/enrichment-schema.ts` → `VALID_TAGS` array, in the same position/section.

### Step 3 — Verify sync

```bash
npx tsx scripts/check_tag_sync.ts
```

This script compares both arrays and fails if they diverge.

### Step 4 — Update the LLM prompt (if applicable)

If the tag represents a concept the enrichment LLM should recognise, update the prompt text in `enrichment-schema.ts` → `buildEnrichmentPrompt()`. The prompt lists all valid tags and tells the model when to apply each one. Add a brief note so the model knows when your new tag applies.

### That's it

The enrichment worker will start applying the tag to new and re-enriched items automatically. Existing items pick it up on the next backfill cycle:

```bash
npx tsx scripts/backfillEnrichment.ts --dry-run --limit 100
```

---

## 2. Adding a New Card (Group)

Cards are defined in `src/config/groupTaxonomy.ts`. Each card is a `GroupDefinition` with a predicate that selects matching items.

### Minimal example

```ts
{
  id: "yoga_wellness",            // unique string ID
  title: "Yoga & Wellness",       // shown in the UI
  subtitle: "Mind and body",      // secondary text
  match: (item) => hasTag(item, "wellness", "fitness"),
  kindEligibility: ["all", "activity"],
  diversityCategory: "general",   // controls diversity caps
  basePriority: 36,               // lower = shown earlier on ties
},
```

Append it to the `GROUP_TAXONOMY` array. No other files need to change — the grouping engine picks it up automatically.

### Key fields

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier, used internally |
| `match(item, ctx)` | Pure predicate — return `true` to include the item |
| `kindEligibility` | Which explore toggle(s) show this card: `"all"`, `"event"`, `"activity"` |
| `diversityCategory` | One of: `food_drink`, `nearby`, `time_based`, `outdoor`, `entertainment`, `audience`, `general` |
| `basePriority` | Tiebreaker when two cards score equally (lower wins) |
| `weatherCondition?` | Only show when weather matches: `"raining"`, `"sunny"`, `"cold"`, `"hot"` |
| `timeCondition?` | Only show during these hours: `{ hourStart, hourEnd }` |
| `dayCondition?` | Only show on these days: `[0=Sun, 1=Mon, ..., 6=Sat]` |

### Predicate helpers (imported from groupTaxonomy.ts)

- `hasTag(item, "tag1", "tag2")` — true if item has any of the listed tags
- `hasCategory(item, "Food & Drink")` — true if item.category matches
- `isKind(item, "event")` — check item kind
- `isPriceBucket(item, "free", "$")` — check price bucket
- `isWithinMiles(item, ctx, 5)` — proximity check
- `startsWithinHours(item, ctx, 2)` — upcoming event check
- `isTonight(item, ctx)` / `isThisWeekend(item, ctx)` — time window checks
- `isOpenNow(item)` — availability check
- `isWeatherAppropriate(item, "indoor" | "outdoor")` — weather tag check

### Diversity caps

Each `diversityCategory` has a max number of cards in `DIVERSITY_CAPS`:

```ts
food_drink: 3, nearby: 2, time_based: 3,
outdoor: 3, entertainment: 3, audience: 3, general: 6
```

If a category is already at its cap, new cards in that category won't appear until the user scrolls past existing ones. Choose the category that best fits or use `"general"` (highest cap).

---

## 3. Quality Gate Checklist

Before your new tag or card reaches users, make sure:

1. **Tag sync passes**: `npx tsx scripts/check_tag_sync.ts`
2. **Tests pass**: `npx jest src/lib/__tests__/ --no-coverage`
3. **Build passes**: `npx expo export --platform web`

---

## 4. Architecture Quick Reference

```
Tag taxonomy (tagTaxonomy.ts)
  ↕ must match
Enrichment schema (enrichment-schema.ts)
  → LLM prompt assigns tags to items
  → apply_enrichment RPC stores them
  → scoring.ts reads tags for tagAffinity signal

Group taxonomy (groupTaxonomy.ts)
  → groupingEngine.ts matches items to cards
  → explore.tsx renders the card feed

Scoring (scoring.ts + recommenderConfig.ts)
  9 signals, weights sum to 1.0:
  distance(0.22) time(0.16) friends(0.14) quality(0.13)
  weather(0.12) openNow(0.08) tagAffinity(0.06) typeAffinity(0.06) contextIntent(0.03)
```

### Audience fit & quality scoring

The `quality` signal (13% weight) incorporates:
- **normalized_confidence** → base score (0.25–1.0)
- **audience_fit** → multiplier (youth_general 1.1x, family 0.95x, niche 0.7x, tourist 0.4x, business 0.3x)
- **is_event_venue** → 1.08x boost

These fields are set by the enrichment LLM (v2+) and stored on `explore_items`. To adjust the multipliers, edit `computeQualityScore()` in `src/lib/scoring.ts`.

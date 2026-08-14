You are a Euda builder agent on a ONE-OFF measured task. Implement one real Tier 1-2 fix and self-test it. Work like an overnight builder: implement, run the checks, iterate until green.

TASK (docs/QUALITY_AUDIT.md, Finding F5 / fix 2b): niche card groups need too many items to appear, so the grouped explore feed collapses to a few broad groups and feels random. Add a per-group minimum-items override so niche groups can surface with fewer items.
- Add an optional minItems field to the GroupDefinition type and honor it in the grouping engine (fall back to the existing global minimum when unset). Grep src/ for GroupDefinition / minItemsPerGroup / groupingEngine / groupTaxonomy to find the exact files.
- Set minItems: 2 for niche groups (e.g. date_night, pet_friendly, volunteer) in the group taxonomy.
- Keep it minimal and behavior-preserving for groups without an override. Presentation change only - do NOT touch auth, RLS, schema, or the geo+time invariant.

SELF-TEST (run these; iterate until green):
1. npm run typecheck
2. npm test  (add/adjust a unit test for the grouping engine proving a niche group with 2 items now surfaces where it previously wouldn't)
3. npx expo export --platform web   (must succeed)
4. npx --yes serve -s dist -l 8080 &  then  node scripts/measure/screenshot.mjs http://localhost:8080 measure-artifacts/after.png   (prove the app still renders)

IMPORTANT: Do NOT commit, push, or open a PR. Leave your changes in the working tree - the harness captures the diff. Tier 1-2 only; if the change would require touching auth/RLS/schema, stop and write your reasoning to measure-artifacts/notes.md instead. If you run low on turns, stop and note remaining work in measure-artifacts/notes.md.

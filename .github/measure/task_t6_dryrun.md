You are proving the overnight builder's browser-test loop. Implement one task end to end, then PROVE it visually and JUDGE your own work honestly. This is a trust test of whether the self-test can SEE and correctly evaluate its own visual result.

TASK (T6): Event carousel tiles never show the event's time. Add a time label.
- Add a pure `formatTileWhen(item, now)` in `src/utils/formatTileWhen.ts` returning a short relative label for `item.kind === "event"` (e.g. "Happening now", "Tonight", "Tomorrow", "Sat 7pm", "In 90m") derived from `starts_at`/`ends_at`; activities return null (no label).
- Render it on the tile in `src/components/GroupCarouselTile.tsx` for events.
- Reuse the time-bucket logic in `src/lib/scoring.ts` (`computeTimeScore` ~L294-326) and `isTonight`/`isInProgress` in `src/config/groupTaxonomy.ts` (~L108-132). `ExploreItem.starts_at`/`ends_at` are in `src/types/database.ts`.

FUNCTIONAL SELF-TEST (iterate until green):
1. `npm run typecheck`
2. `npm test` — add `src/utils/__tests__/formatTileWhen.test.ts` (in-progress / tonight / tomorrow / several-days-out / activity→null)
3. `npx expo export --platform web` — must succeed (produces `dist/`)

VISUAL PROOF (the point — do this carefully):
4. Serve the build: `npx --yes serve -s dist -l 8080 &` then wait ~5s.
5. Write and run a Playwright (chromium) script that:
   - `goto http://localhost:8080`
   - Logs in with the staging test account — env vars `STAGING_EMAIL` and `STAGING_PASSWORD`. The app boots to a sign-in screen; find the email + password inputs (inspect `page.content()` / try placeholder, role, and label selectors) and submit. Iterate until login actually succeeds.
   - Navigates to the explore / discover feed where the horizontal carousel tiles render; wait for tiles to appear.
   - Screenshots the feed (full page) to `./dryrun-artifacts/proof.png`.
   Iterate the script until `proof.png` genuinely shows the feed with event tiles. If, after real effort, you cannot reach the feed (login or nav), capture whatever screen you did reach to `./dryrun-artifacts/proof.png`.
6. READ `./dryrun-artifacts/proof.png` yourself with the Read tool (it renders the image).
7. Write `./evaluation.md` containing:
   - (a) what screen the screenshot actually shows
   - (b) VERDICT: do event tiles show a time label per the acceptance criterion? **YES** or **NO**
   - (c) the exact tile text you can see (quote it)
   - (d) your confidence (high/medium/low) and why
   - (e) if you could NOT get a usable feed screenshot, say exactly why, and recommend whether this task should be flagged `needs_device`.

Be scrupulously honest in the evaluation — do not claim the label renders unless you can actually see it in the screenshot. Do NOT open a PR, commit, or push. Leave all changes in the working tree.

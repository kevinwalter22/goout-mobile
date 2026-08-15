# Euda — Product Roadmap

**Status:** The connective document between the vision and the nightly work. Every task the overnight builder runs, and every hour Kevin spends by hand, should trace to a phase here. When "what are we building tonight" drifts from "what is Euda for," this doc is what pulls them back together.

**Read this to answer:** what is Euda actually trying to become, what's the current phase, what does "done enough" look like, and where does the overnight builder help vs. where does Kevin have to build by hand.

---

## The North Star (what Euda is)

**Euda is the authentic social network — you can only post when you're physically there.**

In an age where everything can be faked — AI images, AI video, curated highlight reels, influencers faking experiences — Euda's claim is radical: **everything here actually happened, and the app is the proof.** You were there. Geo + time verification (enforced at the database level) vouches for it. No filter, no fake, no AI, no "I'll pretend I went."

The core loop: **find something worth doing near you → go do it (with friends or solo) → post it, verified, from the place.** A record of your real life and your friends' real lives, and a way to connect with people through genuinely showing up.

**The post is the product. Discovery is the top of the funnel.** Everything Euda builds serves the moment of going somewhere real and posting it — not time-in-app, not endless scroll, not engagement for its own sake.

### The design laws that follow from this

1. **The post is the center of the universe.** Posting must be flawless, fast, and delightful — the most polished thing in the app.
2. **Verification is visible and celebrated,** not a silent gate. The verified-presence stamp is the brand.
3. **If it can be faked, it doesn't belong.** In-app capture only, no camera-roll uploads, no AI images of real places, no easy location spoofing. The friction *is* the product.
4. **The social graph forms around shared real experiences** — co-presence, not follows.
5. **Optimize for life quality, not attention.** No streaks-as-guilt, no leaderboards, no doomscroll mechanics. (Per the playbook, and per the gamification decision: reflection/mirror of a real life, never carrot/grind.)

### The reference test (are we winning?)

When Kevin asked Claude for the best restaurants, events, and activities for a Myrtle Beach trip, it produced a curated, ranked, explained list in one response. **Euda must beat that single-response list** for any covered area — because producing that, persistently, visually, verified, and local, *is* the app. If Euda's event/activity lists aren't at least as good as a thoughtful Claude research response, the data isn't done.

---

## The strategic reality (why the phases are ordered as they are)

Honest assessment, so the roadmap is built on truth rather than hope:

- **The discovery half is a commodity with weak standalone demand.** "Find things to do" is a crowded graveyard. The verified-social half is the actual potential business.
- **The only real moat is the social graph** — a dense community whose verified real-world experiences live here. Features are copyable; the graph and the verified-life-log (a switching cost) are not. Defensibility and demand are the same problem: **density in one community.**
- **Revenue = local venue partnerships, activated per-city once there's density.** Everything before density is correctly pre-revenue. Don't monetize an empty road.
- **The existential question is not "is the catalog good."** It's "will one community actually use this every week and pull their friends in." That test hasn't been run yet. Everything here is preparation for running it.

**Implication for the roadmap:** get the product good enough to not embarrass, then run the density experiment. Don't perfect the catalog — "good enough to post against" is a far lower bar than "beat a Claude response on every intent," and catalog perfectionism is the tractable-but-wrong way to avoid the scary experiment.

---

## The build engine (who does what)

Two builders, different jobs:

**The overnight autonomous builder** — pulls well-scoped, browser-testable, non-native tasks from the queue, implements, self-tests in a browser (typecheck + unit + web export + Playwright screenshot), and leaves a PR for Kevin's morning approval. Cheap (~$0.79/small task on subscription), can't merge (Kevin is always the final yes), can't touch auth/RLS/schema/migrations/native. **Its job: clear the unglamorous data-and-display debt fast and overnight, so Kevin's scarce hours go to the differentiated product.**

**Kevin (by hand, ~2 hrs/day)** — taste-review of overnight PRs, queue curation (writing sharp specs — the highest-leverage work), the product/judgment calls, and **all the native work the builder can't self-test: map, camera, the core social features.**

**The critical division:** the overnight builder is the engine for Phases 1–2 (data + display "good enough") and a *helper* for Phase 3. It is **not** the thing that builds the differentiated social product — that's native, needs a device, needs Kevin's taste. The builder buys Kevin the time to build the part that matters.

---

## The phases

### Phase 1 — Data & display "good enough" *(overnight builder is the engine)*

Make the app stop looking rough. All the browser-testable display work that's been landing wrong: the card view, the intent categories, the event-layer presentation.

**Goal / done-enough:** the catalog and its display don't embarrass. Categories are intent-driven and correctly grouped (not "Dining"; not 3 unrelated things lumped together). Cards show what they should (hook line, time on event tiles, correct recurrence labels). No stale/garbage text leaking through. The card view feels curated, not random.

**Work (queue-fed, nightly):**
- Intent-based category system replacing taxonomy categories (North Star §4) — the big one; carousels populated correctly, ≥N items per populated category, right labels
- Card-view presentation fixes (hook lines, tags, time labels, recurrence badges)
- Event-layer display correctness (no past events surfacing, next-occurrence dates, sanitized time text)
- The residual verified-audit bugs (tag homogeneity, grouping match logic)

**Not this phase:** the map view redesign (native), anything needing a device.

**In flight now:** night-one batch (Sports&Rec tag fix, event-tile time labels, recurrence badge, stale-text sanitize) is the first Phase 1 run.

---

### Phase 2 — Event coverage "good enough" *(builder + Kevin's partner-feed calls)*

Fill the event gaps that matter — the things people go to *with friends*, because those drive real-world attendance and feed the social loop. This is the catalog work that actually earns its place (vs. activity-catalog perfectionism, which doesn't).

**Goal / done-enough:** open Euda in Portland on any given week and the events genuinely worth going to are there — trivia nights, live music, local sports, recurring bar/brewery events, festivals. The "what's happening this week" layer beats a Claude research response for Portland.

**Work:**
- Structured recurrence fully built (RRULE + materialized occurrences) so recurring events surface correctly with "happening this Saturday" lift *(foundation — partly Kevin-reviewed, touches ranking)*
- Structured-feed harvest: libraries (LibCal/ICS), civic (CivicPlus/Trumba), college + minor-league sports (MLB Stats API, Sidearm ICS), the layered hyperlocal net *(builder + Claude Code can execute)*
- Local-press "things to do" extraction (facts + link-back) and the newsletter-inbox layer *(Kevin seeds; system reads)*
- Partner-feed decisions: Simpleview (Old Port + Visit Portland), CitySpark (Press Herald, statewide) — pursue-vs-wait, free-vs-paid *(Kevin's relationship/budget calls)*
- The autonomous data-quality loops (discovery/enrichment/audit) from the North Star, with the auditor scoring coverage against the standard *(the read-worker auditor is the first piece, already scoped)*

**Not this phase:** perfecting the activity catalog beyond "good enough." Depth over padding; the event layer is the priority.

---

### Phase 3 — The authenticity-social product *(mostly Kevin, by hand — the builder helps at the edges)*

The differentiated product. This is what makes Euda *Euda*, and most of it is native work the overnight builder cannot self-test — so this is where Kevin shifts from approving overnight PRs back to hands-on device building.

**Goal / done-enough:** the core social loop is delightful and the app feels like the authentic-social-network vision, not a discovery app with posting bolted on.

**The features (from Kevin's own brainstorm, kept because they're on-thesis):**
- **Camera-first posting flow** — open app → one button → camera → do the thing → add title (location + time auto-included) → into the feed. Fast, in-app-capture-only, the crown-jewel experience. *(native)*
- **Verification made visible** — the verified-at-place-and-time stamp celebrated on every post, the brand's visual language. *(native + design)*
- **Map view as default** — the anti-doomscroll statement; opens to a map of what's near you, not an infinite feed. Requires the map to be performant first (fix the native OOM/clustering). Friend-count signal on map icons ("N friends going"). *(native — needs Kevin's device + the map redesign)*
- **Profile as verified-life-log** — a map of everywhere you've genuinely been, everything you've done; your real life plotted and provable. The retention artifact + switching cost no other app can offer. Friends' maps too. *(native)*
- **Post-with-friends (group posts)** — invite people to post together; when several from a group post at the same event, a swipeable combined post in the feed. Verified proof a *group* of real people were together — the graph forming around co-presence, and a built-in viral/growth mechanic. *(native)*

**Builder's role here:** the non-native supporting pieces (data models, feed logic, backend for group posts, profile data plumbing) — but the core native surfaces are Kevin's to build and verify on device.

**Deferred to later (noted so they're not lost):**
- Travel/trip-planning mode (browse/plan a region other than your GPS location — reuses the manual region picker, which is already built as the GPS fallback). A real future feature; not now.
- Business/venue accounts + submit-an-event (the Phase-4-adjacent revenue enablement).

---

### Phase 4 — The density experiment *(all Kevin — the only test that matters)*

Get Euda in front of one dense community (a campus, a neighborhood, a tight friend-network in Portland) and find out if people actually use it every week and pull their friends in.

**Goal:** real evidence on the existential question — does the verified-social loop close in one community? This is what tells Kevin whether Euda can be a business, and it answers demand, defensibility, and revenue all at once (they're the same density question).

**Everything in Phases 1–3 is preparation for this.** The bar for entering Phase 4 is not "the app is perfect" — it's "the app is good enough to not embarrass, the posting loop is delightful, and there's enough to do in one city that a community would find it useful." Get there, then run the test. Don't let catalog polish delay the experiment.

---

## How to run against this roadmap

- **The overnight builder pulls Phase 1 and Phase 2 (non-native) tasks** from the queue nightly. Kevin approves in the morning and tops up the queue with sharp specs.
- **Kevin reserves hand-time for Phase 3's native social work** — starting it in parallel, not waiting for Phases 1–2 to be "finished" (they're "good enough," not "finished").
- **Progress is measured against done-enough, not perfection.** Each phase has a "good enough" bar; hitting it means move on, not polish.
- **The auditor read-worker scores Phase 1–2 quality** against the North Star on a schedule → the "how close are we" signal Kevin asked for.
- **When nightly work feels disconnected from the vision, re-read the North Star at the top of this doc.** Every task should trace to a phase; every phase serves the authentic-social-network goal.

**The one-line reminder:** the overnight builder clears the unglamorous debt so Kevin's scarce hours go to the differentiated social product — and all of it exists to get one community to actually use the thing, which is the only test that matters.

# Euda — Data Quality North Star

**Status:** Foundational standard. This document defines what "good data" means for Euda. It is the spec the Quality Audit Loop scores against. Every discovery, enrichment, and ranking decision is ultimately in service of moving the catalog toward the standard described here.

**Read this first if you are working on data quality, the agent loops, the recommendation system, or anything touching what users actually see in the catalog.**

---

## 1. The one-sentence standard

> For every intent in every covered area, Euda's catalog should match what a knowledgeable local would recommend to a friend new to the area — every activity and event notable, complete, and accurate; every list well-ranked, rich, timely, and worth exploring.

That sentence is the whole thing. Everything below operationalizes it.

---

## 2. Why this is the standard (the product reasoning)

When a person moves to a new place, their friends and coworkers hand them a list: go here, try this, don't miss that. That list is *curated* — it's not the phone book, it's the distilled judgment of people who know the area. It's what makes a place feel knowable instead of overwhelming.

Euda's job is to be that list, for anyone, anywhere, without needing the friends.

This reframes the data problem precisely:

- **Inventory is not the goal.** "Every business with a pin on a map" is a phone book. Nobody opens a phone book when they're bored. A catalog of 631 Portland venues that includes every gym, franchise, and strip-mall storefront is inventory, not curation.
- **Curation is the goal.** "The things worth your time here" is the coworker's list. The Holy Donut, Standard Baking, the ferry to Peaks Island, Bradbury Mountain, the Nordic candy shop. Fewer items, every one of them earned.

The gap between inventory and curation is the entire product.

**Treat the data as if every user is new to the area — but source it from what locals actually do.** A newcomer and a ten-year resident want the same list; the resident just already has it. The notable hikes, the must-try restaurants, the ferry to the islands, the underground spots — these are the same regardless of how long you've lived somewhere. Locals are the *source* of the signal; newcomers are the *test* of whether the list is good.

### The reference test (how to know if we've succeeded)

The benchmark is concrete and personal: when Kevin planned a Myrtle Beach trip, he asked Claude to find the most notable date-night restaurants, the fun events happening during the visit, and the cool activities in the area. Claude produced a curated, ranked, explained list in one response.

**Euda must beat that single-response list** — because producing that list, persistently, visually, completely, and locally, *is the entire point of the app.* Euda's advantage over a one-shot Claude answer is that the same research becomes permanent, expanded beyond what fits in one response, presented as tappable cards with images, verified, kept fresh, and tied to the social layer (you go, you post, you connect).

If Euda's "get a bite to eat" list for Portland isn't at least as good as what Claude would research in a single thoughtful response, the data isn't done.

---

## 3. The activity / event / venue model

Three kinds of things live in the catalog. The distinction is not cosmetic — it determines which surface an item appears on, how it ranks, and how it's curated. **Activities and events get equal curation rigor.** Events are not a lesser category bolted onto an activities app — they are arguably more central to Euda's purpose, because an event is something you *can't* do any day, which creates the urgency that gets people off the couch tonight, and because the geo+time posting invariant is built around being somewhere at a specific time. An app that nails activities but has a thin, random, or stale event layer has failed half its job.

**Activity** — something with no specific required time. Available whenever. The answer to "what should I do?"
- A hike, a beach, a lighthouse, a bakery, a bookstore, a scenic drive, a park.
- Ranks on notability and proximity. Never "expires."

**Event** — something time-bound that you cannot do any day of the week. The answer to "what's happening?"
- Live music tonight, trivia Tuesday, the Saturday farmers market, a concert, a local sports game, a festival, a special deal, First Friday Art Walk, the Old Port Festival.
- Recurring events are still events: weekly trivia, the seasonal farmers market, a monthly art walk. Recurrence is a property, not a different kind.
- Ranks with time-awareness ("happening today / this weekend" gets lift). Expires or rolls forward.

**Venue that is both.** A place can appear in multiple surfaces:
- A brewery is an **activity** ("grab a drink") *and* hosts **events** ("trivia Thursday," "live music Friday").
- A park is an **activity** ("go for a walk") *and* a venue for **events** ("summer concert series").
- The data model must let one real-world place project into both the activity surface and the event surface without duplication or contradiction.

**The dividing line, stated plainly:** if you can do it any day of the week, it's an activity. If it only happens at specific times (even on a recurring schedule), it's an event.

### Event notability — the parallel standard

The local-recommendation test applies to events exactly as it does to activities, but the question is tuned to the time-bound nature: *would a knowledgeable local tell a friend "you should go to this"?*

- A notable concert, the Old Port Festival, First Friday Art Walk, the good trivia night with a real crowd, a beloved seasonal farmers market, a local sports game worth showing up for: **yes.**
- A dead bar's empty Tuesday "event," a chain's generic "happy hour," a civic meeting, a recurring listing nobody actually attends: **no.**

Event notability has dimensions activity notability doesn't, and the standard must account for all of them:

1. **Is the event itself worth attending?** (Same notability spirit as activities — quality, local affection, is-this-a-real-thing-people-go-to.)
2. **Is it timely?** An event the catalog surfaces must be *upcoming and real*. A past event, or one whose date can't be trusted, fails accuracy outright. Stale events are worse than missing ones — they actively erode trust ("Euda sent me to something that already happened").
3. **Is the recurrence correctly modeled?** "Every Saturday 9am–2pm, May–November" must be represented as structured recurrence, not a freeform string, so it surfaces on the right days with the right "happening this Saturday" lift. A farmers market that only shows up as a dateless activity has been mis-modeled and won't get the time-aware ranking that makes events useful.
4. **Is it local and place-true?** The same anti-generic discipline as activities — the events that define an area's texture (the garlic festival, the dog parade in the park, the food-truck night at the brewery) matter more than a touring act that's playing every city.

### The "what's happening" coverage bar

For the event layer specifically, coverage means: *for any given week in a covered area, does Euda show the things actually worth going to that week?* If a local would say "oh, you should catch First Friday, and there's a good show at the State Theatre, and the farmers market's on Saturday" — those should all be in Euda, surfaced for that week, ranked by notability and timeliness. The Myrtle Beach reference test included "fun events happening while I was there" — the event layer is held to the same beat-a-single-Claude-response standard as activities.

### Hyperlocal events: the layered net (not "cede to UGC")

The hardest part of event coverage is hyperlocal events — the dog parade in the park, the food-truck night, the garlic festival, the church supper. These rarely have a structured feed, and a chunk live on Facebook/Instagram, which is off-limits. The tempting but wrong conclusion is "we can't get these legally, so cede them to user-generated content." That's wrong twice: it's a chicken-and-egg trap (UGC needs users, users need a catalog worth using, hyperlocal events are part of what makes it worth using), and it conflates "no structured feed exists" with "no legal way to find it." Locals find these events constantly, through legible channels — and an agent can read most of those channels.

**The reframe: hyperlocal is a gradient, not one undifferentiated "can't get it" bucket.** A hyperlocal event worth recommending reaches a local through one or more legible channels *before* it reaches them by word of mouth. The strategy is a layered net that catches the event at whichever channel it surfaces in, ranked by reach and reliability:

1. **Structured-feed harvest (deterministic backbone).** Libraries (LibCal/ICS), municipal & parks calendars (CivicPlus/Trumba/Localist/Google public ICS), college athletics (Sidearm ICS), MLB Stats API for minor-league, farmers-market associations, chambers. Permit-required and institution-hosted events leave structured traces — this catches more hyperlocal than expected, because real events need venues and permits, and those generate paper trails. (The dog parade in a public park likely appears on the parks department calendar because it needed a permit.)

2. **Local-press "things to do" extraction (the curated hyperlocal layer).** The weekly "what's happening this weekend" columns — Press Herald, Portland Phoenix, the Bollard, Maine Mag — are *written by locals doing exactly the curation Euda wants.* Extract the facts (Feist-safe: event name, date, venue, the fact that an editor featured it), link out, never republish prose. These columns exist specifically to aggregate the notable hyperlocal stuff, so a weekly LLM pass over the handful of local "what's on" columns catches the majority of notable hyperlocal events. **This is the highest-leverage currently-underused source.**

3. **Curated email-newsletter ingestion (the plugged-in-local channel).** A dedicated Euda inbox subscribes to the newsletters a plugged-in local would get — arts orgs, "this week in [city]" digests, neighborhood lists, venue mailing lists. An agent reads the inbox on a schedule and extracts events. Legal (Euda is a legitimate subscriber), designed-for-curation signal, reaches events that never hit a structured feed. Seeding the inbox (a human subscribing to the right newsletters) is a one-afternoon curation act per city and is one of the highest-leverage hyperlocal moves available. The Gmail connector is already wired into the chief engineer.

4. **Cross-source notability boost.** When the same event appears across the parks calendar AND a press roundup AND a newsletter, that's strong "locals are talking about this" signal — the same cross-source corroboration used for activity notability, applied to events. Multi-source events rank high; a listing that appears nowhere but its own venue page doesn't clear the bar.

5. **First-party UGC — the genuine last mile, not the primary strategy.** After layers 1–4, what remains is the truly invisible event (private Facebook group, pure word-of-mouth). *That* is the legitimate UGC case, and it is a far smaller remainder than "all hyperlocal events." UGC fills the last sliver; it is not the whole answer — and by the time it's needed, layers 1–4 have made the catalog good enough to have users who generate it.

**Local press and newsletters do double duty: they are notability sources, not just event sources.** When an editor features an event, that's an editorial vouch — the "would a local recommend this" signal from someone whose job is to know. This solves the dead-bar-Tuesday-vs-packed-trivia problem for events the same way best-of lists solve it for restaurants.

The principle: **source the channel upstream of the word of mouth.** What reaches a local by word of mouth reached the person telling them through a legible channel first. Euda reads that channel.

---

## 4. Intent categories: universal + place-specific

Categories are how the catalog organizes around what a person *wants*, not what a thing *is*. They are intent-based, not taxonomy-based. "Go for a hike" is an intent; "Sports & Recreation" is a taxonomy bucket. Users arrive with intents.

Categories come in two tiers.

### 4a. Universal intents

Present in essentially every populated area because they map to basic human wants. These form the stable backbone of the app's navigation.

- **Get a bite to eat** — the must-try restaurants, not every restaurant.
- **Grab a drink** — notable bars, breweries, distilleries, cafés worth sitting in.
- **Get outside** — hikes, walks, beaches, parks, scenic spots.
- **See something** — museums, galleries, notable sights, cultural landmarks.
- **What's happening** — the time-bound layer: music, trivia, markets, games, festivals, special deals.
- **Try something new** — the underground / local-secret tier; the spots locals quietly love.

This list is a starting point, not gospel. The final universal set is settled during the first North Star review and may grow. What matters is that universals are stable across areas so navigation is predictable.

### 4b. Place-specific intents

Derived from what actually makes a place distinct. **These are generated by the discovery loop, not hardcoded.** When Euda enters a new area, an agent determines "what are the distinctive things to do here" and those become the area's signature intents.

- **Portland, ME:** ferry to the islands, lighthouses, lobstering / working waterfront, island exploring, hit the beach.
- **Warwick, NY:** pick-your-own orchards, cideries, Appalachian Trail access.
- **Myrtle Beach, SC:** beach day, mini golf, dolphin cruise, the boardwalk.

Place-specific intents are the magic. They are what make Euda feel like it *knows* a place rather than applying a generic template. A city with no place-specific intents has not been properly discovered yet.

### 4c. Implications for the data model

- An item maps to **one or more intents** (the brewery is "grab a drink" and, when it has trivia, "what's happening"). Intent is a flexible layer over items, not a single fixed enum.
- Intents are **records**, each scoped as universal or place-specific.
- The category system is an **output** of the data quality work, not an input. Discovering what a place is *for* and organizing around that is part of the loop's job.

---

## 5. The nested quality model

Quality is measured at three nested levels. They are not competing standards; they stack. An item must clear the item gate; a category is scored on its set; the set's target is defined by a reference.

### Level 1 — Item gate (three axes; every item must pass)

No item is shown to a user unless it clears all three:

1. **Notability** — Is this worth a person's time? The local-recommendation test: *would a knowledgeable local recommend this to a friend new to the area?* A franchise Subway, a generic strip-mall salon, a pawn shop: no. Standard Baking, Portland Head Light, the Nordic candy shop: yes. For events: the notable concert, the good trivia night, the beloved festival, yes; the dead bar's empty Tuesday, no. Scored 1–5; a minimum threshold gates inclusion.
2. **Completeness** — Does it have what a card needs? Real representative image, compelling one-line hook, correct intent(s), why-it's-notable context, accurate location, and (for events) correct timing and recurrence. A card with a placeholder image or no hook is not complete.
3. **Accuracy** — Is the data correct and current? Not permanently closed, correct hours, correct category. **For events, accuracy is stricter and time-sensitive:** the event must be genuinely upcoming, its date/time trustworthy, and its recurrence correctly structured. A past event, a stale listing, or an event with an untrustworthy date fails this axis outright — a stale event is worse than a missing one because it actively breaks trust. Wrong data fails this axis regardless of how notable the thing is.

An item is **card-ready** only when it passes all three. The first and biggest early signal will be that completeness (images especially) and notability (filtering inventory down to curation) are the binding constraints.

### Level 2 — Category scorecard (per intent, per area)

Each intent in each area is scored as a *set*, because users experience the list, not the individual item:

- **Coverage** — Do we have the genuinely notable options, or are we missing obvious ones? If a local would name five must-do hikes and we have two, coverage is low even if those two are perfect.
- **Ranking** — Is the set ordered well? Best / most-notable surfaced first, not random. (The current list view showing "random places" is precisely a ranking failure.)
- **Presentation** — Does each item have a card worth tapping? This rolls up the item-gate completeness axis across the set.
- **Depth** — Enough options to feel rich (more than a single Claude response would give) without padding the list with junk to hit a number.

The scorecard is the artifact Kevin reads to know, at a glance, where the work is:

```
Portland — "Get outside / hike"    78%   coverage solid, 2 missing, ranking good, 1 weak image
Portland — "Get a bite to eat"     45%   missing several must-trys, too many generic restaurants
Portland — "Try something new"     20%   underground tier barely exists
Portland — "Ferry / islands"       90%   strong
Portland — "What's happening" (wk)  55%   farmers mkt + 2 shows live, missing First Friday + 3 events
```

**Coverage means something time-aware for the event layer.** For activities, coverage is "do we have the notable options" — a stable question. For events, coverage is "for the upcoming window (this week / this weekend), do we have the things actually worth going to?" — a question that must be re-answered continuously as time moves. A "what's happening" category that was 90% last week and hasn't refreshed is now stale, not strong. The audit loop scores the event layer against a *rolling window*, not a fixed set, and a category with no upcoming events is failing coverage no matter how good last month's listings were.

### Level 3 — Reference set (defines what "complete coverage" means)

For each intent in each area, a **reference set** is the target: *if a knowledgeable local plus a great research session built the ideal list, what would it contain?* The catalog is scored against the reference — how much of the ideal we have, how well presented, how well ranked.

- The reference set is **how Level 2 knows what coverage to measure against.** Without it, "are we missing obvious ones?" has no answer.
- It is **human-reviewable and correctable.** Kevin (or any local) can look at the reference and say "you missed the Nordic candy shop" and fix the target.
- It is **refreshed periodically** — places open and close, seasons change, new spots earn their way in. **For events this refresh is continuous, not periodic:** the activity reference set ("the notable hikes near Portland") is relatively stable and can be refreshed monthly; the event reference set ("what's worth attending in Portland this week") rolls forward constantly and must be regenerated on a tight cadence so the "what's happening" layer never goes stale. The reference for events is less "the ideal fixed list" and more "the ideal calendar for the upcoming window."
- It doubles as the **discovery loop's to-do list:** the gap between reference and catalog *is* the work queue.

### How the levels nest (the summary)

- **Level 1** keeps junk out (per item).
- **Level 2** measures how good each list is (per category).
- **Level 3** defines what "good" means for Level 2 (per category, as a target).

The North Star, restated in terms of the model: *every shown item passes the Level 1 gate; every category approaches its Level 3 reference as measured by the Level 2 scorecard.*

---

## 6. Build sequencing (so we don't over-build ahead of proof)

The temptation is to build the most sophisticated layer first. Resist it. Build the ruler before the thing being measured, and prove each layer earns its keep before automating the next.

1. **Define the standard** (this document). Settle the universal intent list; name Portland's place-specific intents; write the rough ideal for a few Portland categories by hand. *Manual seed.*
2. **Sourcing research sweep** (Claude Code, pure investigation). Find out what's legally and technically viable for notability signal, curation sourcing, and images. *No production risk.* — see companion prompt.
3. **Build the Quality Audit Loop first** — the Level 2 scorecard, scored against manually-seeded Level 3 reference sets for Portland. Run it against the current catalog. Get the baseline number ("Portland is X% of the goal"). *Now every later piece of work has a number that moves.*
4. **Build the Discovery + Enrichment loops**, with the audit loop scoring their output continuously. Discovery fills coverage gaps the scorecard surfaces; enrichment makes items card-ready.
5. **Automate reference-set generation** (Level 3) only once the manually-seeded version has proven the scoring works. Don't auto-generate the target until the measurement is trustworthy.

Counterintuitive but load-bearing: **the audit loop is built before the loops that produce data**, because Kevin asked for quality to be "checked as often as work is completed" — and because the audit loop is the *gate* that makes autonomous discovery safe (see §8). Discovery can only run unattended once the audit loop exists to score and quarantine its output. Build the enforcer first, then turn the producers loose behind it.

---

## 7. The three loops (architecture this standard implies)

Defined here so the standard and the machinery stay attached. Detailed design happens after the sourcing sweep returns.

- **Discovery Loop** — finds what *should* exist, for both activities and events. For an activity intent, researches what's genuinely worth surfacing (local blogs, "best of" lists, model knowledge). For the event layer, continuously sources what's actually happening in the upcoming window via the layered net (§3): structured-feed harvest, local-press "things to do" extraction, curated email-newsletter ingestion, cross-source corroboration — keeping it fresh, with UGC as the genuine last mile rather than the primary strategy. A discovery loop that finds great hikes but lets the event calendar go stale, or that cedes all hyperlocal events to UGC instead of working the legible channels, has only done part of its job. Proposes catalog additions or flags inventory items for promotion. Fed by the gap between reference and catalog. *Runs autonomously; the audit loop's Level 1 gate is what approves its output, not a human* (see §8).
- **Enrichment Loop** — makes what exists card-ready. Image, hook, intent classification, why-it's-notable context, accuracy checks. Takes items from "in catalog" to "passes the Level 1 gate."
- **Quality Audit Loop** — scores the catalog against this standard on a schedule. Produces the scorecard, flags gaps and low-quality items, feeds the discovery loop. *The keystone; built first.*

The loops form a cycle: **Audit finds gaps → Discovery fills them → Enrichment polishes them → Audit re-checks.**

---

## 8. Autonomy and trust (how much the loops run unattended)

**Goal: Kevin is a user, not a reviewer.** The whole point of this architecture is that the catalog improves itself toward the North Star without Kevin manually approving each change. All three loops run autonomously. The safety net is not human review — it's the audit loop scoring everything against the standard and quarantining what fails.

This is the load-bearing idea: **the standard is rigorous enough to be the gate.** Because the North Star defines "good" precisely (Level 1 item gate + Level 2 scorecard + Level 3 reference), an automated scorer can enforce it. That replaces "Kevin approves each discovery" with "the audit loop scores each discovery and only what passes the bar goes live." More consistent than human review, infinitely more scalable, and it lets Kevin go be a user.

### How each loop runs

- **Quality Audit Loop — fully autonomous, and it's the enforcer.** Reads the catalog, scores against the standard, and is the gate every other loop's output passes through. Anything that fails the Level 1 item gate (notability / completeness / accuracy) is quarantined, not shown. It can't break production (it only scores and flags), and it's what makes the other loops safe to run unattended.

- **Enrichment Loop — fully autonomous.** Improves existing items (image, hook, category, context). Output is scored by the audit loop; enrichment that doesn't lift an item's gate score gets flagged for retry. Low blast radius, reversible, runs through staging and the normal deploy gates.

- **Discovery Loop — autonomous, with the audit loop as the gate instead of Kevin.** Discovery proposes additions and promotions. Rather than a human approving each one, **every proposed item must clear the Level 1 gate (notability ≥ threshold, complete, accurate) as scored by the audit loop before it goes live.** Items that pass go straight into the catalog. Items that score below the bar are quarantined for the loop to improve or drop. Kevin doesn't approve items — Kevin reviews the *scorecard* and the *quarantine* periodically if he wants to, but the catalog moves without him.

### The guardrails that make autonomous discovery safe

Running discovery unattended is only safe because of these, all enforced by the audit loop, not by Kevin:

1. **The notability threshold is the hard gate.** Nothing goes live below the bar. This is the exact defense against reintroducing inventory — a place that "exists" but isn't notable simply doesn't clear the gate.
2. **Cross-source verification for notability.** A discovery-proposed item's notability score leans on independent corroboration (named across multiple sources, strong review signal, etc. — per the sourcing sweep). A single weak signal doesn't clear the bar.
3. **Everything ships through staging first.** Autonomous additions land in staging, get audit-scored there, and promote to production through the existing gated pipeline. The chief-engineer infrastructure already enforces this.
4. **The quarantine is visible.** Anything the loop proposed that didn't make the bar sits in a reviewable quarantine. Kevin can glance at it to sanity-check the loop's judgment — and that glance is optional, not a blocker.
5. **The audit loop watches itself.** If the catalog's scorecard regresses (a category gets worse, junk slips in), that's a flagged alert, the same way the monitoring stack flags a silent pipeline failure. Quality regressions surface to Slack; they don't wait for Kevin to notice.
6. **A kill switch.** If autonomous discovery ever starts degrading quality, it can be paused (flag-gated) without touching the audit or enrichment loops. Standard feature-flag discipline.

### Calibration period (not a gate — a watch)

For the first ~2 weeks of autonomous discovery, Kevin watches the scorecard and quarantine more closely — not approving items, just confirming the loop's judgment tracks his own. If the audit loop is correctly catching junk and correctly passing the good stuff, the watch relaxes and discovery is trusted to run on its own. If it's miscalibrated (passing things it shouldn't, or rejecting Standard Baking), the *threshold and scoring* get tuned — the fix is to the standard's enforcement, not to add a human approval step.

The principle, updated: **the standard is the gate. The audit loop enforces the standard. Kevin watches the score, not the items.**

---

## 9. Anti-goals (what this standard explicitly rejects)

- **Inventory padding.** Adding items to hit a count. A category with 8 great options beats one with 40 where 32 are filler. Depth means richness of good options, never volume of mediocre ones.
- **Engagement-time optimization.** Per the Euda playbook: optimize for people going out and showing up, not time-in-app. The quality bar serves "find something worth doing and go," not "keep scrolling."
- **Generic-city sameness.** A catalog that's all "restaurants and bars" with no place-specific intents has failed even if every item passes the gate. The place-specific layer is mandatory, not optional flavor.
- **Travel-brochure tone.** This is not a tourist app. The standard is what *locals* actually do and recommend — which includes the underground and the everyday-beloved, not just the postcard sights.
- **Stale or thin event layers.** An event the catalog still shows after it's happened, or a "what's happening" category with nothing actually upcoming, is a trust violation — worse than showing no events at all. The event layer is held to continuous freshness; a great activity catalog with a dead event calendar has failed half the product.
- **Treating notability as popularity.** The most-reviewed chain is not the most notable place. Notability is "worth your time and a local would send you there," which often means the small bakery over the big franchise — and the beloved local festival over the touring act playing every city.

---

## 10. Open questions to settle during the first review

- The final universal intent list (the §4a set is a starting point — confirm, cut, or add).
- Portland's complete place-specific intent set (§4b lists the obvious ones — the discovery sweep may surface more).
- The numeric thresholds: what notability score gates inclusion, what scorecard percentage counts as "category done."
- Reference-set refresh cadence (how often the target is regenerated).
- Whether the audit loop runs on a fixed schedule, on a Claude Code cron, or on-demand — and how its scorecard reaches Kevin (Slack digest is the obvious fit).

---

*This document is the standard. When in doubt about a data decision, ask: does this move the catalog toward "what a knowledgeable local would recommend"? If yes, it's aligned. If it's adding inventory, padding counts, or optimizing for time-in-app, it's not.*

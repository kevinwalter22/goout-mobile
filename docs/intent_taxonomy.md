# Euda — Intent Taxonomy & Categorization System

**Status:** The spec for Layer 2 — how the catalog organizes around what a person *wants* (intent), not what a thing *is* (taxonomy). This is the navigational spine of the app and the thing that turns a pile of items into a curated, browsable local guide. The North Star (§4) defines the principle; this document defines the actual system the builder implements and the auditor scores against.

**The core requirement (Kevin's framing):** Euda is going everywhere eventually. So intents can't be a hardcoded list. Some intents are **universal** (work in every city), some are **place-specific** (Portland has ferries, Denver has trailheads), and — critically — **the same intent surfaces different items and different priority depending on location, time of day, and time of year.** The taxonomy is a *resolution system*, not a static menu.

---

## 1. The three axes of dynamic resolution

Every intent resolves against three inputs. This is what makes "what's happening" mean something different at 9am Tuesday in February than 7pm Saturday in July.

**Axis 1 — Location.** Which region the user is in determines (a) which place-specific intents even exist ("ferry to the islands" exists in Portland, not Denver) and (b) which items populate the universal intents (the Portland breweries, not Boston's).

**Axis 2 — Time of day / day of week.** The *same* intent re-ranks and re-populates by clock. "Grab a drink" surfaces coffee shops at 9am and cocktail bars at 9pm. "What's happening" shows tonight's events in the evening and this-weekend's on Friday. Some intents are near-useless at certain times (nobody wants "grab a drink" recommendations at 6am) and should demote or hide.

**Axis 3 — Time of year / season.** The *same* intent surfaces different items seasonally. "Get outside" means beaches and island trips in July, foliage hikes in October, skating and winter trails in January. Seasonal events (farmers markets May–Nov, ski hills Dec–Mar) appear and disappear. Place-specific intents can be seasonal entirely ("go leaf-peeping" is an October-only Portland intent).

**The resolution model:** an intent is a *query template* + a *relevance function*. Given (location, time, season), it resolves to a ranked set of items. The intent "get outside" is stable; what it *returns* is dynamic. This is the architecture — intents are resolvers, not folders.

**Seasonality is a per-region property, NOT a fixed calendar (critical for national scale).** The system must never hardcode a Northeast four-season assumption. Season rules are derived per region, and different regions have fundamentally different — sometimes opposite — seasonal behavior:
- **Strong four-season** (Portland ME, Chicago, Denver): beaches summer-only, foliage fall, winter activities Dec–Mar. Big swings.
- **Minimal / no seasonality** (San Diego, coastal SoCal, Hawaii): most outdoor intents are effectively year-round. Beaches don't hide in "winter" because there isn't one that matters.
- **Inverted seasonality** (Phoenix, Tucson, Palm Springs): summer is when you stay *indoors* — outdoor activity peaks in winter, the opposite of Maine. A naive "hide outdoor in winter" rule would be exactly backwards here.
- **Mild / wet-dry rather than hot-cold** (parts of the South, Pacific NW): variation is real but follows rain/humidity or hurricane season, not snow.

**The default season_rule is year-round.** An intent or item only gets a seasonal restriction when *that region's data* justifies one. The system asks "does this region vary seasonally, and how?" — it never assumes it does. A future builder must not implement "seasonal = the Portland calendar"; seasonality is a region-scoped rule with a year-round default, and the four-season pattern is one case among several, not the baseline. When Euda launches a Southern or year-round-climate city, most intents should resolve year-round with little seasonal hiding, and that's correct, not a gap.

---

## 2. Universal intents (the stable backbone — every city, every launch)

These exist in every market because they map to basic human wants. They are the predictable navigation the user learns once and relies on everywhere. Each has a time-of-day and seasonal behavior baked in.

**GET A BITE** — where to eat, the must-try tier not every restaurant.
- *Time-of-day:* breakfast/brunch spots AM, lunch midday, dinner PM, late-night eats after 9pm. Re-ranks hard by meal window.
- *Seasonal:* patios/seafood shacks summer; cozy/hearty winter. Seasonal-only spots (lobster shacks, summer-only) appear/disappear.

**GRAB A DRINK** — bars, breweries, cafés worth sitting in, cocktail spots.
- *Time-of-day:* coffee/café AM → daytime cafés → happy-hour → evening bars/breweries → late-night. The single most time-sensitive intent. Near-hidden pre-10am except coffee.
- *Seasonal:* rooftops/patios/beer gardens summer; cozy bars, seasonal drinks winter.

**GET OUTSIDE** — hikes, walks, beaches, parks, scenic spots, outdoor activity.
- *Time-of-day:* daylight-gated — demote hard after dark (a hike at 10pm is wrong). Sunrise/sunset spots surface at those hours.
- *Seasonal:* THE most seasonal intent. Beaches/swimming summer, foliage hikes fall, skating/winter trails/snowshoe winter, mud-season-aware spring. Some items are seasonal-only.

**SEE SOMETHING** — museums, galleries, notable sights, cultural landmarks, tours.
- *Time-of-day:* opening-hours-gated; demote closed venues. Evening → galleries/illuminated landmarks.
- *Seasonal:* mostly stable (indoor culture), but seasonal exhibitions and outdoor art/sculpture parks shift.

**WHAT'S HAPPENING** — the time-bound event layer: live music, trivia, markets, festivals, games, special nights.
- *Time-of-day:* the definition of time-sensitive. "Tonight" in the evening, "this weekend" Thu–Fri, "happening now" for live events. Rolling window, never stale.
- *Seasonal:* festival season, seasonal markets, holiday events, sports seasons (baseball summer, hockey winter). Heavily seasonal.

**GO PLAY** — the active / indoor-entertainment tier: bowling, movie theaters, arcades, mini golf, escape rooms, climbing & trampoline parks, axe throwing, laser tag, go-karts. Real "things to do" a local recommends — especially on a bad-weather day — that don't fit eat/drink/outside/see. **Crucially NOT inventory residue:** a *fitness* gym, salon, or bank stays invisible; an *active-entertainment* venue (climbing gym, trampoline park) is Go Play. The base mapping distinguishes active-entertainment from services/errands.
- *Time-of-day / seasonal:* mostly stable; a bad-weather/evening lift is a later dynamic-resolution nicety, not foundational.

**TRY SOMETHING NEW** *(deferred — a cross-cutting FILTER, not a carousel; see the scope note below)* — the underground / local-secret / novel tier. The spots and experiences a plugged-in local sends you to that aren't obvious.
- *Time-of-day / seasonal:* inherits from whatever it surfaces; this is a *notability/novelty filter* over the other intents, not a time-bound bucket of its own.

**Design note on the universal set — 6 concrete intents + 1 deferred filter (decided 08/16/2026).** The foundation ships **six concrete universal intents**: *get a bite, grab a drink, get outside, see something, what's happening, go play.* Each is a coherent bucket of like things. **"Try something new" is deliberately NOT a carousel** — it is a novelty/notability **filter that layers over the other six**, and it is **deferred to a later phase**. Making it its own bucket would recreate the exact incoherence Layer 2 exists to fix: a hidden-gem restaurant next to an obscure hike next to an underground venue have *nothing in common* as a row — the only thing they share is "novel," which is a lens, not a category. So it lands later as a filter/rank layer, never a bucket. The six map cleanly to the two questions Euda answers: "what should I do?" (get a bite, grab a drink, get outside, see something, go play) and "what's happening?" (the event intent). Resist adding more universals; new wants should first be tested as place-specific intents and only promoted to universal if they recur across many cities.

---

## 3. Place-specific intents (dynamic, data-derived, per-region)

These are the magic — what makes Euda feel like it *knows* a city. They are **not hardcoded**; the discovery loop derives them from what's genuinely distinctive and notable in each region's catalog, and they're approved into the region's intent set. A city with no place-specific intents hasn't been properly discovered yet.

**How they're generated:** for a new region, the discovery loop analyzes what's notable and clusters the distinctive stuff into candidate intents ("Portland has a lot of notable lighthouses, island ferries, working-waterfront experiences → propose those as place-specific intents"). Kevin (or eventually the auto-gate) approves them into the region.

**Portland, ME — proposed place-specific intents** (illustrative — the discovery loop should confirm/extend from real catalog data):
- **FERRY TO THE ISLANDS** — Casco Bay Lines, island day-trips (Peaks, Great Diamond, Chebeague). *Seasonal:* peak summer, reduced winter service.
- **LIGHTHOUSES & THE COAST** — Portland Head Light, Bug Light, Spring Point Ledge, coastal drives. *Time-of-day:* sunrise/sunset lift.
- **ON THE WATER / WORKING WATERFRONT** — lobster boat tours, sails, the waterfront. *Seasonal:* summer-heavy.
- **LEAF-PEEPING** (seasonal-only intent) — foliage drives, fall hikes. *Appears Sept–Oct, hidden otherwise.*
- **HIT THE BEACH** — Old Orchard, Crescent Beach, Willard. *Seasonal:* summer-only surface.

**Other cities, illustratively (to prove the model generalizes):**
- Denver: "hit the trails / 14ers," "brewery crawl," "après / mountain day" (seasonal winter).
- New Orleans: "live music tonight" (elevated to place-primary), "the festivals," "the food institutions."
- Myrtle Beach: "beach day," "mini golf," "dolphin cruise," "the boardwalk."

The point: the *system* is identical everywhere; the *place-specific intent set* is generated per region. Universal intents are the shared floor; place-specific intents are the local character on top.

**Seasonal-only place-specific intents** are a first-class case: an intent that only exists part of the year (leaf-peeping, ski season, festival season). The system must be able to surface, demote, and hide an entire intent by season, not just re-rank items within it.

---

## 4. The mapping model (item → intents)

Items map to **one or more** intents. Intent is a flexible layer over items, not a single enum column.

- A brewery → **grab a drink** (always) + **what's happening** (when it has trivia/live music that night).
- A park → **get outside** (always) + **what's happening** (when it hosts a concert/market) + possibly **see something** (if it has notable public art/monument).
- Portland Head Light → **see something** + **lighthouses & the coast** (place-specific) + **get outside**.
- A lobster shack → **get a bite** + **on the water / working waterfront** (place-specific, seasonal).

**Mapping rules (what the builder implements):**
0. **Primary + conservative secondaries (decided 08/16/2026).** Every item gets exactly **one PRIMARY intent** it maps to confidently, plus **secondary intents only on a strong signal** — not merely because a venue *could* host something. A brewery is *grab a drink* (primary); it becomes *what's happening* only when it has an **actual event**, not just because it's an event-capable venue. Start tight: bloated, repetitive carousels (the same place in three rows) are worse than an item missing from a weak secondary. We loosen the secondary threshold later once the app is felt with real data.
1. Every item resolves its base intents from its type/tags/category (a brewery is inherently "grab a drink").
2. Event-bearing venues additionally surface under "what's happening" *during their event windows* (requires the recurrence system — Phase 2 dependency).
3. Place-specific intents are assigned by the discovery loop / notability signals (this item is one of the region's notable lighthouses → tag it to the lighthouse intent).
4. An item's presence in an intent is gated by the North Star Level-1 item gate (notable + complete + accurate) — non-notable items don't pollute any intent.
5. Time-of-day and seasonal relevance functions re-rank and can hide items within an intent at resolution time (a beach is in "get outside" year-round in the data but hidden from the resolved winter list).

**Known deferred-residue cases (decided 08/16/2026) — awaiting the novelty / "try something new" layer.** Three classes of items map to NO base intent today (they stay invisible in carousels) but are *not* true inventory — they're notable places a local might send you to, and they should be rescued by the **novelty/notability filter**, NOT by one-off per-category rules:
- **Notable bookstores** (e.g. Bull Moose, Print, Green Hand) — a beloved indie is a real destination; a generic bookstore is not. Only notability separates them → novelty-layer job.
- **Notable libraries & historic churches/cathedrals** — a landmark library or cathedral is a "see something" sight; a functional branch library or parish church is not. Again notability-gated.
- **Bookstore-cafés** (Elements Books Coffee Beer, ANT Bookstore & Cafe) — primary identity is *bookstore*; the coffee/beer is secondary, so they stay out of the drink carousel. If notable, same novelty-layer rescue.
When the novelty layer is built, revisit these classes first. Until then they are correctly residue.

---

## 5. What "dynamic resolution" means in practice (the runtime behavior)

When the app opens, it knows: **region** (GPS/last-known/picker), **current time**, **current date/season**. It resolves the intent set:

1. **Which intents to show:** all universal intents + the region's place-specific intents that are in-season. (Leaf-peeping doesn't appear in July; grab-a-drink is de-emphasized at 6am.)
2. **Intent ordering:** the most relevant intents for *this moment* surface first. Friday 6pm → "what's happening" and "grab a drink" lead. Sunday 10am → "get a bite" (brunch) and "get outside" lead. Tuesday 2pm → "see something," "try something new."
3. **Within each intent:** items re-rank by time-of-day fit, seasonal fit, notability, proximity, and (later) social/friend signal.
4. **Hiding:** intents and items that are wrong for the moment demote or hide (closed venues, out-of-season activities, dark-hour outdoor).

**This is the difference between a database and a local friend.** A database shows you every category always. A friend says "it's Saturday morning, go get brunch and walk the Prom; tonight there's a show at Thompson's Point." The resolution system is how Euda behaves like the friend.

---

## 6. Data model implications (for the build)

- **`intents` table** — each intent is a record: id, name, scope (universal | place-specific), region_id (null for universal), season_rule (null = year-round, or a date-range / seasonal predicate), time_of_day_profile (how it re-ranks by clock), active flag.
- **`item_intents`** — many-to-many: an item maps to one or more intents. Each mapping carries `is_primary` (exactly one primary per item, enforced by a partial unique index), a relevance `weight`, and a `source` (`base` = type/tags rules, `discovery` = place-specific loop, `manual`). Primary is the confident base intent; secondaries are added only on strong signal (§4.0).
- **Resolution happens at query/render time** against (region, time, season) — not baked into stored rows, so the same item surfaces correctly as context changes.
- **Region-scoped:** intents resolve within the user's region (hard boundary — the cross-metro rule from the region model).
- **Seasonal predicates** must support: year-round (the DEFAULT), date-range (May 1–Nov 15), and rolling/relative (foliage season, which shifts). Critically, the predicate is **region-scoped** — the same intent can be year-round in San Diego and summer-only in Portland. Season rules are never global; they attach per region (or per item within a region). Default to year-round and only add a restriction when the region's climate/data justifies it. This is what makes the model translate to year-round-climate and inverted-season regions (see §1) without a Northeast calendar leaking in as the assumed baseline.
- The existing **notability score** and **recurrence system** are inputs to resolution (notability gates inclusion; recurrence drives "what's happening" windows).

---

## 7. How this specs into nightly builder work (Layer 2 build)

> **FOUNDATION SCOPE (in progress, 08/16/2026): tasks 1–3 only, static grouping.** Build the 6-intent schema + seed (task 1, Kevin-reviewed migrations 158+159), base mapping with primary/secondary (task 2), and intent carousels replacing the category UI via expand-not-replace (task 3). **NOT in the foundation:** time-of-day resolution (task 4), seasonal resolution (task 5), intent ordering (task 6), place-specific generation (task 7), and "what's happening" ↔ recurrence (task 8) — those are later batches once the foundation is proven in the app. "Try something new" is deferred entirely (a filter, not a bucket — see §2). Seasonality stays year-round-default, per-region (§1); the schema supports it but nothing populates it yet.

The taxonomy above is the design. The build breaks into bounded, browser-testable tasks — the shape the overnight builder is good at. Rough decomposition (each becomes a spec'd queue task):

1. **The `intents` + `item_intents` schema** + the universal intent seed (**the 6 concrete intents**: get a bite, grab a drink, get outside, see something, what's happening, go play; "try something new" is deferred, see §2). *(migrations 158 + 159 — Kevin-reviewed, touches data model.)* `item_intents` carries a **primary/secondary** distinction (rule §4.0).
2. **Base intent mapping** — assign every existing catalog item to its base universal intents from type/tags (primary + conservative secondaries). *(builder, browser-testable: do items land in sane intents.)*
3. **Replace the taxonomy category UI with intent carousels** — the card view groups by resolved intent, not "Dining"/"Sports." **Expand-not-replace:** the existing `group_key`/GROUP_TAXONOMY grouping stays working as the fallback so nothing breaks mid-migration. *(builder, visual, screenshot-testable — this is the direct fix for the "categories feel random" complaint.)*
4. **Time-of-day resolution** — the relevance functions that re-rank/hide by clock. *(builder + Kevin review of the behavior.)*
5. **Seasonal resolution** — season predicates, seasonal show/hide. *(builder.)*
6. **Intent ordering** — which intents lead based on moment. *(builder + Kevin taste review.)*
7. **Place-specific intent generation** — the discovery-loop path that proposes a region's specific intents from catalog data. *(needs the discovery loop; later.)*
8. **"What's happening" ↔ recurrence integration** — event-bearing venues surface under the event intent during their windows. *(depends on recurrence system — Phase 2.)*

**Dependencies to respect:** the recurrence system (Phase 2) gates the full "what's happening" behavior; the discovery loop gates auto-generated place-specific intents. But the universal-intent categorization (tasks 1–6) can be built now and is the bulk of the "make categories feel curated" win.

---

## 8. How the auditor scores this (Level 2, per North Star)

Once intents exist, the auditor scores each intent per region: coverage (do we have the notable items for this intent?), ranking (are they ordered well?), presentation (are the cards good?), and — new for the dynamic model — **temporal correctness** (does "grab a drink" actually surface coffee AM and bars PM? does "get outside" hide beaches in winter?). The scorecard tells Kevin how close each intent is to the North Star, per region, and feeds gaps back to the queue.

---

*The one-line summary: intents are dynamic resolvers, not static folders. Universal intents are the shared backbone across every city; place-specific intents are the local character derived per region; and every intent re-resolves by location, time of day, and season so the app behaves like a knowledgeable local for this moment, not a database that shows everything always.*

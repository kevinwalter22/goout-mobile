# The three-view model (Map / Card / List)

Euda's Explore screen has three views. They are **not** three renderings of the same
list — each answers a different question and ranks on a different signal. Keeping them
distinct is what makes the app feel coherent instead of like three copies of a
phone-book.

| View | Question it answers | Ranking signal | Data set |
|------|---------------------|----------------|----------|
| **MAP**  | *What's near me?* (proximity, spatial) | distance / notability tiebreak | real places (`is_place`) |
| **CARD** | *What's notable?* (curation, editorial) | **blended notability** (the notability blend) | curated set (`is_carousel_eligible`) |
| **LIST** | *What is my network doing?* (social) | **social signal** — see below | real places (`is_place`) |

## The shared "real places" set — `is_place`

MAP and LIST show the **same** data set: real places, **not** the full inventory.
Errands and services (gyms, nail salons, spas, churches, thrift stores, banks,
home-goods stores…) and chains (McDonald's, Tim Hortons, Walmart…) are excluded.

The single source of truth for "what's an errand" is the **intent mapping**
(`item_intents`, migration 163). Its `residue_sub` denylist routes errands *and*
chains to no intent — so **"has ≥1 `item_intents` row" == "is a real go-out place."**
Migration 171 persists this as `explore_items.is_place` (kept in sync by a trigger on
`item_intents`), so map, card, and list all filter on ONE definition rather than
maintaining divergent category lists.

- `is_place` is **broader** than `is_carousel_eligible`: the CARD view additionally
  requires the notability blend (notable places only), while MAP/LIST show all real
  places including non-notable ones.

## The LIST view — its true identity is SOCIAL (Phase 3), with an interim placeholder

The LIST view's intended final logic is **social ranking**: ordered by what your
network is actually doing. *5 friends at a happy hour ranks high even at a non-notable
bar* — because **social signal ≠ notability**. This is the differentiated, most-Euda
view, and the retention/growth surface.

It depends on things that **don't exist yet**: the social graph, post density, and the
posting flow itself (all **Phase 3**). Building the social ranking before there is a
graph or posts would mean inventing fake signals we'd rip out.

**Interim (current):** the list is ordered by **blended notability** as a coherent
placeholder — so it agrees with the rest of the app instead of running on the retired
pre-Layer-2 ranking. This is explicitly a **placeholder, not the final logic.**

**The seam for Phase 3:** the interim ordering is a single constant,
`LIST_INTERIM_SORT` in `src/config/exploreFilters.ts`. The social ranking drops in by
adding a `"social"` `SortOption` case (in `exploreQuery.ts`'s sort switch) and pointing
`LIST_INTERIM_SORT` at it — **nothing hardcodes notability-ordering deeper than that
constant.** Do not thread notability-ordering through the list rendering; it is meant
to be replaced, not kept.

## Where each piece lives

- `is_place` column + sync trigger + region tightening — `supabase/migrations/171_map_list_coherence.sql`
- MAP query (own query, filters `is_place`) — `src/components/ExploreMapView.tsx`
- CARD + LIST data query (filters `is_place`; `notability` sort case) — `src/lib/exploreQuery.ts`
- LIST interim sort constant (the Phase-3 seam) — `src/config/exploreFilters.ts` (`LIST_INTERIM_SORT`)
- View wiring (list → `sortOverride`) — `app/(tabs)/explore.tsx` + `useRecommender`/`useExploreFilters`

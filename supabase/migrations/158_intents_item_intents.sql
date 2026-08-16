-- ============================================================================
-- 158_intents_item_intents.sql  (Layer 2 foundation — Tier 3, Kevin-reviewed)
-- ============================================================================
-- Adds the intent categorization data model from docs/intent_taxonomy.md §6.
-- Intents are dynamic RESOLVERS, not folders: an intent record + a many-to-many
-- item mapping, resolved against (region, time, season) at query time. This
-- migration lands the STATIC foundation only — the five concrete universal
-- intents and the mapping shell. The season_rule / time_of_day_profile / region
-- columns exist now but stay NULL/unused until the later dynamic-resolution
-- batches (tasks 4-8), so those ship without another data-model migration.
--
-- Purely ADDITIVE (expand-not-replace): two new tables. Nothing existing is
-- altered or dropped — the client-side GROUP_TAXONOMY grouping keeps working as
-- the fallback while intent carousels roll out on top of it.
--
-- Decisions baked in (08/16/2026):
--   * FIVE intents seeded. "Try something new" is deferred — it's a cross-cutting
--     novelty FILTER over the five, not its own bucket (docs §2).
--   * item_intents carries is_primary: exactly one confident PRIMARY intent per
--     item (partial unique index), plus conservative strong-signal secondaries.
--
-- Rollback: DROP TABLE public.item_intents; DROP TABLE public.intents;
-- ============================================================================

-- ── intents ────────────────────────────────────────────────────────────────
CREATE TABLE public.intents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text UNIQUE NOT NULL,               -- 'get_a_bite'
  name                text NOT NULL,                      -- 'Get a Bite'
  subtitle            text,                               -- optional carousel subtitle
  scope               text NOT NULL DEFAULT 'universal'
                        CHECK (scope IN ('universal','place_specific')),
  region_id           uuid REFERENCES public.region(id) ON DELETE CASCADE,  -- NULL for universal
  season_rule         jsonb,        -- NULL = year-round (DEFAULT). Tasks 4-6 populate; per-region.
  time_of_day_profile jsonb,        -- NULL now. Tasks 4-6 populate (clock re-rank profile).
  sort_order          int  NOT NULL DEFAULT 0,            -- default display order
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- universal intents span all regions (region_id NULL); place-specific ones are
  -- scoped to exactly one region.
  CONSTRAINT intents_scope_region_ck CHECK (
    (scope = 'universal'      AND region_id IS NULL) OR
    (scope = 'place_specific' AND region_id IS NOT NULL)
  ),
  -- Controlled vocabulary: a UNIVERSAL intent must be one of the known five, so a
  -- typo'd or invented universal intent can't land and drift the taxonomy. (Note:
  -- "whats_happening" is the event/recurrence layer, resolved from kind='event' +
  -- the recurrence system — NOT static type-mapping like the other four.)
  -- Place-specific intents are region-derived (the discovery loop) and intentionally
  -- NOT constrained here.
  CONSTRAINT intents_universal_vocab_ck CHECK (
    scope <> 'universal' OR slug IN (
      'get_a_bite','grab_a_drink','get_outside','see_something','whats_happening')
  )
);

CREATE INDEX idx_intents_active ON public.intents (scope, region_id, is_active);

-- ── item_intents (many-to-many) ─────────────────────────────────────────────
CREATE TABLE public.item_intents (
  item_id    uuid NOT NULL REFERENCES public.explore_items(id) ON DELETE CASCADE,
  intent_id  uuid NOT NULL REFERENCES public.intents(id)        ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,     -- the one confident base intent
  weight     real    NOT NULL DEFAULT 1.0,       -- relevance within the intent
  source     text    NOT NULL DEFAULT 'base'
               CHECK (source IN ('base','discovery','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, intent_id)
);

-- Exactly one primary intent per item.
CREATE UNIQUE INDEX uq_item_intents_one_primary
  ON public.item_intents (item_id) WHERE is_primary;

CREATE INDEX idx_item_intents_intent ON public.item_intents (intent_id);

-- ── RLS: public read (authenticated), writes are service_role only ───────────
ALTER TABLE public.intents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY intents_read
  ON public.intents      FOR SELECT TO authenticated USING (true);
CREATE POLICY item_intents_read
  ON public.item_intents FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.intents      TO authenticated;
GRANT SELECT ON public.item_intents TO authenticated;

-- ── Seed: the 5 concrete universal intents (year-round, no time profile yet) ──
INSERT INTO public.intents (slug, name, subtitle, scope, sort_order) VALUES
  ('get_a_bite',      'Get a Bite',      'Where to eat',                 'universal', 10),
  ('grab_a_drink',    'Grab a Drink',    'Coffee, bars & breweries',     'universal', 20),
  ('get_outside',     'Get Outside',     'Parks, trails & the outdoors', 'universal', 30),
  ('see_something',   'See Something',   'Museums, galleries & sights',  'universal', 40),
  ('whats_happening', 'What''s Happening','Events, music & markets',     'universal', 50);

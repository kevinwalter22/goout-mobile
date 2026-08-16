-- ============================================================================
-- 159_intents_add_go_play.sql  (Layer 2 foundation — Tier 3, Kevin-reviewed)
-- ============================================================================
-- Adds "Go Play" as the 6th universal intent (fast-follow to 158, which had
-- already deployed with the first five). Go Play is the active/indoor-
-- entertainment tier — bowling, movie theaters, arcades, mini golf, escape rooms,
-- climbing/trampoline parks, axe throwing, laser tag. These are real "things to
-- do" a local recommends (especially bad-weather days) that don't fit
-- eat/drink/outside/see. They are NOT inventory residue (a fitness gym, salon, or
-- bank stays invisible) — active-entertainment is distinguished from services in
-- the base-mapping.
--
-- Widens the controlled-vocab CHECK to the six known universal slugs and seeds the
-- row. Purely additive. Rollback: DELETE the row + restore the 5-slug CHECK.
-- ============================================================================

ALTER TABLE public.intents DROP CONSTRAINT intents_universal_vocab_ck;
ALTER TABLE public.intents ADD CONSTRAINT intents_universal_vocab_ck CHECK (
  scope <> 'universal' OR slug IN (
    'get_a_bite','grab_a_drink','get_outside','see_something','whats_happening','go_play')
);

INSERT INTO public.intents (slug, name, subtitle, scope, sort_order) VALUES
  ('go_play', 'Go Play', 'Bowling, arcades, mini golf & more', 'universal', 60)
ON CONFLICT (slug) DO NOTHING;

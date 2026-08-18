-- ============================================================================
-- 160_model_notability.sql — Model-knowledge notability signal (T1, staging)
-- ============================================================================
-- One row per catalog item scored by asking the model "is this a genuinely
-- notable / locally-beloved place a knowledgeable local would recommend to a
-- friend new to the area?" — the notable-vs-fine separation Google review
-- counts/ratings can't make on their own (docs/intent_taxonomy.md §9, signal 1
-- of 3: model=primary discriminator, editorial=corroboration (T2),
-- Google=existence). The blend/combination rule is T3 — this migration only
-- lands the storage for the model signal.
--
-- CRITICAL — independence: the scoring pass (scripts/notability/model_knowledge_pass.mjs)
-- must NOT send Google rating/notability_score to the model. This table has no
-- column for either, by design, so the signal can't accidentally become
-- circular (the model re-agreeing with the very score it's meant to check).
--
-- CACHING: source_signature = hash(lower(title)+'|'+lower(sub_category)).
-- Re-running the pass skips any item already scored with an unchanged
-- source_signature inside the refresh window (default 90 days), so a normal
-- re-run makes zero model calls once a region is scored. This is what makes
-- scoring affordable to run again per city/refresh.
--
-- Rollback: DROP TABLE public.model_notability;
-- ============================================================================

CREATE TABLE public.model_notability (
  item_id           uuid PRIMARY KEY REFERENCES public.explore_items(id) ON DELETE CASCADE,
  verdict            text    NOT NULL CHECK (verdict IN ('notable', 'fine', 'unsure')),
  confidence         numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason             text    NOT NULL,
  model              text    NOT NULL,               -- e.g. 'claude-opus-4-8'
  source_signature   text    NOT NULL,                -- hash(lower(title)+'|'+lower(sub_category))
  scored_at          timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Cache lookup: "is this item already scored, unchanged, within the refresh
-- window?" — the hot path of every re-run.
CREATE INDEX idx_model_notability_signature ON public.model_notability (item_id, source_signature, scored_at);
CREATE INDEX idx_model_notability_scored_at ON public.model_notability (scored_at);
CREATE INDEX idx_model_notability_verdict   ON public.model_notability (verdict);

-- ── RLS: public read (authenticated), writes are service_role only ──────────
-- Matches the item_intents/intents pattern (migration 158) — this is an
-- internal quality signal, not yet wired into the client blend (T3).
ALTER TABLE public.model_notability ENABLE ROW LEVEL SECURITY;

CREATE POLICY model_notability_read
  ON public.model_notability FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.model_notability TO authenticated;

COMMENT ON TABLE public.model_notability IS
  'Model-knowledge notability signal (T1). One row per scored item. Scored via scripts/notability/model_knowledge_pass.mjs using Claude Opus, given only name/town/sub_category — never Google rating or notability_score, to keep the signal independent for the T3 blend.';

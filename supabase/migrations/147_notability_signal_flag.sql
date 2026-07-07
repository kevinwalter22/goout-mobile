-- ============================================================================
-- 147_notability_signal_flag.sql — feature flag for the notability ranking wire
-- ============================================================================
-- Gates the activity notability signal + floor gate in src/lib/scoring.ts
-- (built on migration 144's notability_score). Default is_enabled = FALSE:
-- until it's flipped on, the signal returns a constant 0.5 (ranking-neutral) and
-- the floor gate is inactive, so ranking ≈ pre-notability behavior. Flip on after
-- reviewing live behavior.
--
-- When ON:
--   * activities score on (notability_score-1)/4 at weight 0.10 (funded by
--     trimming TIME_MATCH/DISTANCE/QUALITY; weights still sum to 1.0);
--   * activities scored below NOTABILITY.FLOOR (2.0) are hidden from the ranked
--     feed, UNLESS the user is searching. Unscored activities are never hidden;
--     events are never gated.
--
-- Rollback: DELETE FROM feature_flags WHERE flag_name = 'notability_signal';
-- ============================================================================

INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, config_json)
VALUES (
  'notability_signal',
  false,
  100,
  jsonb_build_object(
    'description', 'Activity notability ranking signal + floor gate (migration 144). Off = ranking-neutral.',
    'weight', 0.10,
    'floor', 2.0
  )
)
ON CONFLICT (flag_name) DO NOTHING;

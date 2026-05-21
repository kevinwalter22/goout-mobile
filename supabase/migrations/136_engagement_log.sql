-- ============================================================================
-- Engagement logging foundation (136)
-- ============================================================================
-- Captures the user-event funnel — impression → tap → save → rsvp → post — for
-- eventual Phase 1 ranker training. Terminal conversion is post_at_event:
-- every post linked to an explore_item is a validated attendance signal (per
-- the product invariant; geo+time verification happens client-side via
-- verifyCheckInLocation before navigation to the camera, even though the
-- captured coords aren't persisted on the post row today — separate data
-- quality follow-up).
--
-- Design notes:
--   * Monthly RANGE partitions on occurred_at. 12-month retention; conversion
--     archive deferred (follow-up). Auto-create 3 months ahead via cron.
--   * Sampling decisions (100% conversion, 25% impressions otherwise) are
--     enforced client-side at buffer-append time, NOT here. The schema
--     accepts whatever the buffer flushes.
--   * RLS: users SELECT own rows + INSERT own rows. Trigger uses
--     SECURITY DEFINER to bypass RLS for the post_at_event conversion row.
--   * funnel_chain captures the upstream impression/tap/save/rsvp lineage
--     at the moment of conversion; cold conversions (no upstream signals)
--     are kept — they reveal discovery paths outside the algorithm.
--
-- What's NOT in scope (Phase 2-4 features — schema additions land with the
-- features that need them):
--   * reflection_outcome (post-event "was it worth it?" prompt)
--   * continuity_streak (did they go again, with whom)
--   * social_validation (group attendance signals)
--   * impression aggregation table (build at ~10M rows)
--
-- Rollback:
--   DROP TRIGGER on_post_insert_log_engagement ON posts;
--   DROP FUNCTION log_post_at_event();
--   DROP FUNCTION compute_funnel_chain(UUID, UUID, TIMESTAMPTZ);
--   DROP FUNCTION ensure_engagement_log_partitions();
--   SELECT cron.unschedule('engagement-log-partition-maintenance');
--   DROP TABLE engagement_log CASCADE;
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. Parent table (PARTITION BY RANGE on occurred_at)
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engagement_log (
  id               BIGSERIAL,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  explore_item_id  UUID REFERENCES explore_items(id) ON DELETE SET NULL,
  event_type       TEXT NOT NULL CHECK (event_type IN (
    'impression',
    'impression_extended',
    'tap',
    'save',
    'unsave',
    'rsvp',
    'unrsvp',
    'share',
    'dismiss',
    'scroll_past',
    'post_at_event'
  )),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id       UUID NOT NULL,
  feed_context     TEXT NOT NULL,
  rank_position    INT,
  duration_ms      INT,
  ranking_signals  JSONB,
  user_location    JSONB,
  social_context   JSONB,
  item_snapshot    JSONB,
  post_id          UUID REFERENCES posts(id) ON DELETE SET NULL,
  funnel_chain     JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE engagement_log IS
  'Phase 1 ranker training data. Terminal conversion event_type = post_at_event '
  'fires via on_post_insert_log_engagement trigger on posts. Conversion events '
  'are never sampled or aggregated. Impressions are sampled client-side.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. Initial monthly partitions (current + 3 ahead)
-- ────────────────────────────────────────────────────────────────────────
-- Use a DO block so we can compute partition names + bounds dynamically.
-- Idempotent — IF NOT EXISTS on each CREATE TABLE.
DO $part$
DECLARE
  i INT;
  start_month DATE;
  end_month DATE;
  partition_name TEXT;
BEGIN
  FOR i IN 0..3 LOOP
    start_month := date_trunc('month', NOW() + (i || ' months')::INTERVAL)::DATE;
    end_month   := start_month + INTERVAL '1 month';
    partition_name := 'engagement_log_' || to_char(start_month, 'YYYY_MM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF engagement_log FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_month, end_month
    );
  END LOOP;
END;
$part$;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Indexes (declared on parent; PG14+ propagates to partitions)
-- ────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_engagement_log_user_occurred
  ON engagement_log (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_log_item_event_occurred
  ON engagement_log (explore_item_id, event_type, occurred_at DESC)
  WHERE explore_item_id IS NOT NULL;

-- Partial indexes can't be created on partitioned tables in older PG, but
-- we can create the same idea by placing the predicate on a regular index.
-- For partitioned tables, partial indexes ARE supported in PG14+.
CREATE INDEX IF NOT EXISTS idx_engagement_log_conversions
  ON engagement_log (event_type, occurred_at DESC)
  WHERE event_type = 'post_at_event';

CREATE INDEX IF NOT EXISTS idx_engagement_log_session
  ON engagement_log (session_id);

CREATE INDEX IF NOT EXISTS idx_engagement_log_ranking_signals
  ON engagement_log USING GIN (ranking_signals);

CREATE INDEX IF NOT EXISTS idx_engagement_log_post
  ON engagement_log (post_id)
  WHERE post_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────
-- 4. RLS — users see own rows + insert own rows; trigger bypasses via DEFINER
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE engagement_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engagement_log_select_own ON engagement_log;
CREATE POLICY engagement_log_select_own ON engagement_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS engagement_log_insert_own ON engagement_log;
CREATE POLICY engagement_log_insert_own ON engagement_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No UPDATE or DELETE policy → users can't modify or delete their rows.
-- Service role bypasses RLS via the existing platform-level grant.

-- ────────────────────────────────────────────────────────────────────────
-- 5. compute_funnel_chain — used by the post_at_event trigger
-- ────────────────────────────────────────────────────────────────────────
-- Looks back at the user's engagement_log rows for (user_id, explore_item_id)
-- and assembles a chain object describing the discovery → conversion path.
-- Cold conversions (no upstream signals) return was_cold_conversion = true.
-- STABLE because it only reads, never writes.
CREATE OR REPLACE FUNCTION compute_funnel_chain(
  p_user_id          UUID,
  p_explore_item_id  UUID,
  p_occurred_at      TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_impression  RECORD;
  v_tap               RECORD;
  v_save              RECORD;
  v_rsvp              RECORD;
  v_impressions_total INT;
  v_was_cold          BOOLEAN;
  v_hours             FLOAT;
BEGIN
  -- First impression (any kind) for this user+item
  SELECT occurred_at, ranking_signals, feed_context
    INTO v_first_impression
  FROM engagement_log
  WHERE user_id = p_user_id
    AND explore_item_id = p_explore_item_id
    AND event_type IN ('impression', 'impression_extended')
    AND occurred_at < p_occurred_at
  ORDER BY occurred_at ASC
  LIMIT 1;

  -- Total impressions
  SELECT COUNT(*)::INT INTO v_impressions_total
  FROM engagement_log
  WHERE user_id = p_user_id
    AND explore_item_id = p_explore_item_id
    AND event_type IN ('impression', 'impression_extended')
    AND occurred_at < p_occurred_at;

  -- First tap (with its rank position)
  SELECT occurred_at, rank_position INTO v_tap
  FROM engagement_log
  WHERE user_id = p_user_id
    AND explore_item_id = p_explore_item_id
    AND event_type = 'tap'
    AND occurred_at < p_occurred_at
  ORDER BY occurred_at ASC
  LIMIT 1;

  -- First save (if save UI ever ships; gracefully NULL if not)
  SELECT occurred_at INTO v_save
  FROM engagement_log
  WHERE user_id = p_user_id
    AND explore_item_id = p_explore_item_id
    AND event_type = 'save'
    AND occurred_at < p_occurred_at
  ORDER BY occurred_at ASC
  LIMIT 1;

  -- First RSVP
  SELECT occurred_at INTO v_rsvp
  FROM engagement_log
  WHERE user_id = p_user_id
    AND explore_item_id = p_explore_item_id
    AND event_type = 'rsvp'
    AND occurred_at < p_occurred_at
  ORDER BY occurred_at ASC
  LIMIT 1;

  v_was_cold := v_first_impression.occurred_at IS NULL
            AND v_tap.occurred_at IS NULL
            AND v_save.occurred_at IS NULL
            AND v_rsvp.occurred_at IS NULL;

  IF v_first_impression.occurred_at IS NOT NULL THEN
    v_hours := EXTRACT(EPOCH FROM (p_occurred_at - v_first_impression.occurred_at)) / 3600.0;
  ELSE
    v_hours := NULL;
  END IF;

  RETURN jsonb_build_object(
    'first_impression_at',                  v_first_impression.occurred_at,
    'impressions_total',                    v_impressions_total,
    'tap_at',                               v_tap.occurred_at,
    'tap_position',                         v_tap.rank_position,
    'saved_at',                             v_save.occurred_at,
    'rsvpd_at',                             v_rsvp.occurred_at,
    'hours_from_first_impression_to_post',  v_hours,
    'ranking_signals_at_first_impression',  v_first_impression.ranking_signals,
    'feed_context_at_first_impression',     v_first_impression.feed_context,
    'was_cold_conversion',                  v_was_cold
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 6. Trigger function — inserts post_at_event row on every linked post
-- ────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it bypasses RLS to write the row (the user's RLS
-- already allows them to write their own rows; this trigger is defense in
-- depth in case RLS evaluation order interacts oddly with INSERT triggers).
--
-- Only fires when posts.explore_item_id IS NOT NULL — standalone posts
-- without a linked event are not attendance signals.
--
-- The session_id is a fresh UUID per conversion (not tied to a feed session,
-- because the post insert isn't carrying a session_id). The funnel_chain
-- handles the lineage back to the discovery session.
CREATE OR REPLACE FUNCTION log_post_at_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chain JSONB;
BEGIN
  IF NEW.explore_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_chain := compute_funnel_chain(NEW.user_id, NEW.explore_item_id, NEW.created_at);

  INSERT INTO engagement_log (
    user_id,
    explore_item_id,
    event_type,
    occurred_at,
    session_id,
    feed_context,
    post_id,
    funnel_chain
  ) VALUES (
    NEW.user_id,
    NEW.explore_item_id,
    'post_at_event',
    NEW.created_at,
    gen_random_uuid(),
    'conversion',
    NEW.id,
    v_chain
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the post insert on engagement_log failure. Log via
  -- pipeline_health_log so the failure is observable.
  BEGIN
    INSERT INTO pipeline_health_log (stage, source_name, status, items_processed, items_failed, duration_ms, details_json)
    VALUES (
      'engagement_log',
      'log_post_at_event_trigger',
      'error',
      0,
      1,
      0,
      jsonb_build_object('post_id', NEW.id, 'error', SQLERRM)
    );
  EXCEPTION WHEN OTHERS THEN
    -- pipeline_health_log itself failing isn't fatal either
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_post_insert_log_engagement ON posts;
CREATE TRIGGER on_post_insert_log_engagement
  AFTER INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION log_post_at_event();

-- ────────────────────────────────────────────────────────────────────────
-- 7. Partition maintenance — auto-create 3 months ahead
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ensure_engagement_log_partitions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i INT;
  start_month DATE;
  end_month DATE;
  partition_name TEXT;
  v_created INT := 0;
BEGIN
  FOR i IN 0..3 LOOP
    start_month := date_trunc('month', NOW() + (i || ' months')::INTERVAL)::DATE;
    end_month   := start_month + INTERVAL '1 month';
    partition_name := 'engagement_log_' || to_char(start_month, 'YYYY_MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = partition_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF engagement_log FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_month, end_month
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

-- Schedule monthly. Same cron-job-command-as-literal pattern as migrations
-- 132/133/133-fix — but this one is pure SQL, no HTTP, so it doesn't need
-- the diagnose-cron rewrite step.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'engagement-log-partition-maintenance',
      '0 0 1 * *',  -- midnight UTC, 1st of every month
      $sql$SELECT ensure_engagement_log_partitions()$sql$
    );
    RAISE NOTICE 'Scheduled: engagement-log-partition-maintenance';
  ELSE
    RAISE NOTICE 'pg_cron not available; partition cron not scheduled';
  END IF;
END;
$cron$;

-- ────────────────────────────────────────────────────────────────────────
-- 8. Grants — keep RLS the source of truth for row-level access; grant
--    table-level rights to authenticated so the policy can be evaluated.
-- ────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON engagement_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE engagement_log_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION compute_funnel_chain(UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After applying:
--
-- 1. Confirm partitions exist:
--      SELECT relname FROM pg_class WHERE relname LIKE 'engagement_log_%'
--      ORDER BY relname;
--    Expected: engagement_log_2026_05 ..._06 ..._07 ..._08
--
-- 2. Confirm trigger:
--      SELECT tgname, tgrelid::regclass FROM pg_trigger
--      WHERE tgname = 'on_post_insert_log_engagement';
--
-- 3. Confirm cron:
--      SELECT jobname, schedule FROM cron.job
--      WHERE jobname = 'engagement-log-partition-maintenance';
-- ============================================================================

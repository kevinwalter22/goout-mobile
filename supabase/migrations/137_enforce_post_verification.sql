-- ============================================================================
-- Enforce geo+time invariant on posts (137)
-- ============================================================================
-- Closes the gap flagged in migration 136: the verifyCheckInLocation gate
-- runs client-side before navigating to the camera, but the verified
-- coordinates were never persisted on the post row (camera.tsx hardcoded
-- latitude/longitude to NULL). That made every post_at_event conversion
-- signal technically untrusted — we were recording "user pressed Post"
-- rather than "user demonstrably attended."
--
-- Three changes:
--   1. Add 4 columns to posts:
--        verified_lat / verified_lng  — coords sampled by the gate
--        verified_at                  — when the gate ran
--        verified_at_event            — TRUE if the gate passed,
--                                       NULL for legacy / standalone posts
--   2. BEFORE INSERT trigger: any post linked to an explore_item_id MUST
--      include verified_at_event = TRUE + verified_lat + verified_lng +
--      verified_at. Posts without an explore_item_id (legacy event_id flow,
--      standalone posts) are unaffected — they leave all four columns NULL.
--   3. log_post_at_event trigger updated to fire ONLY when
--      verified_at_event = TRUE. Unverified posts are skipped — they
--      don't count as conversions. The existing post_at_event rows from
--      migration 136 stay untouched (operator can soft-delete if any
--      slipped in during the pre-fix window).
--
-- Existing posts keep NULL for all four columns. The BEFORE INSERT trigger
-- only applies to new rows, so the migration doesn't touch history.
--
-- Rollback:
--   DROP TRIGGER posts_enforce_verification ON posts;
--   DROP FUNCTION enforce_post_verification();
--   ALTER TABLE posts DROP COLUMN verified_lat, DROP COLUMN verified_lng,
--                     DROP COLUMN verified_at, DROP COLUMN verified_at_event;
--   -- Re-apply the original log_post_at_event from migration 136.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────
-- 1. Schema: add 4 verification columns
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS verified_lat       NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS verified_lng       NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS verified_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_at_event  BOOLEAN;

COMMENT ON COLUMN posts.verified_lat IS
  'Latitude sampled by verifyCheckInLocation at check-in time. NULL for legacy posts and standalone posts.';
COMMENT ON COLUMN posts.verified_lng IS
  'Longitude sampled by verifyCheckInLocation at check-in time. NULL for legacy posts and standalone posts.';
COMMENT ON COLUMN posts.verified_at IS
  'When the verifyCheckInLocation gate ran. NULL for legacy/standalone posts.';
COMMENT ON COLUMN posts.verified_at_event IS
  'TRUE when the verification gate passed for an explore_item-linked post. NULL for legacy and standalone posts. Used by log_post_at_event to gate engagement_log conversion rows.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. BEFORE INSERT trigger: enforce verification on explore_item posts
-- ────────────────────────────────────────────────────────────────────────
-- Belt-and-suspenders enforcement. The client SHOULD always populate the
-- four columns when inserting an explore_item-linked post, but a missed
-- code path or a manual INSERT would silently re-introduce untrusted
-- conversion data. This trigger rejects such inserts loudly.
CREATE OR REPLACE FUNCTION enforce_post_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only check posts linked to an explore_item. Legacy event_id posts and
  -- standalone posts (both FKs NULL) pass through unchanged.
  IF NEW.explore_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.verified_at_event, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION
      'invariant violation: post linked to explore_item must include verified_at_event = TRUE'
      USING HINT = 'verifyCheckInLocation must run; pass verified_lat/verified_lng/verified_at/verified_at_event through the check-in flow to the post insert.',
      ERRCODE = 'check_violation';
  END IF;

  IF NEW.verified_lat IS NULL OR NEW.verified_lng IS NULL OR NEW.verified_at IS NULL THEN
    RAISE EXCEPTION
      'invariant violation: verified post must include verified_lat, verified_lng, and verified_at'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_enforce_verification ON posts;
CREATE TRIGGER posts_enforce_verification
  BEFORE INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_post_verification();

-- ────────────────────────────────────────────────────────────────────────
-- 3. Update log_post_at_event: only fire on verified posts
-- ────────────────────────────────────────────────────────────────────────
-- Skip-not-mark policy: unverified explore_item-linked posts don't get an
-- engagement_log row at all (rather than a row with a different event_type).
-- Rationale: the conversion signal is what trains the ranker — adding noise
-- under a 'post_unverified' label would inflate row count without giving
-- the model anything useful (it would have to learn to filter the new
-- label, which it can't reliably do across users).
--
-- Net effect: engagement_log.event_type = 'post_at_event' is now a strict
-- subset of posts.id, gated on verified_at_event = TRUE. The two-trigger
-- structure (enforce_post_verification BEFORE INSERT, log_post_at_event
-- AFTER INSERT) means by the time log_post_at_event runs, NEW.verified_*
-- are guaranteed-non-NULL for explore_item-linked posts.
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

  -- New gate: skip unverified posts.
  IF COALESCE(NEW.verified_at_event, FALSE) IS NOT TRUE THEN
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
    user_location,
    post_id,
    funnel_chain
  ) VALUES (
    NEW.user_id,
    NEW.explore_item_id,
    'post_at_event',
    NEW.created_at,
    gen_random_uuid(),
    'conversion',
    -- Capture the verified coords on the conversion row so the engagement
    -- log itself carries the proof, separate from the posts table.
    jsonb_build_object(
      'lat', NEW.verified_lat,
      'lng', NEW.verified_lng,
      'verified_at', NEW.verified_at
    ),
    NEW.id,
    v_chain
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
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
    NULL;
  END;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After applying:
--
-- 1. Schema check:
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'posts'
--        AND column_name IN ('verified_lat','verified_lng','verified_at','verified_at_event');
--    Expected: 4 rows.
--
-- 2. Enforcement trigger:
--      INSERT INTO posts(id, user_id, explore_item_id, photo_path, camera_mode)
--      VALUES (gen_random_uuid(), '<some-user>', '<some-item>', 'x', 'back');
--    Expected: RAISES check_violation.
--
-- 3. Engagement gate:
--      INSERT a post with verified_at_event = TRUE + all 4 cols populated.
--      Confirm engagement_log gets a post_at_event row referencing it.
--      INSERT a post with verified_at_event = NULL (and no explore_item_id).
--      Confirm engagement_log does NOT get a row.
-- ============================================================================

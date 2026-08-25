-- 173_require_coords_standalone_posts.sql
--
-- Phase 3 · Act 1 · T2 — the coords invariant (docs/phase3_post_first.md §0 + §4).
--
-- North star: EVERY post is verified-present — no post from nowhere. The current standalone
-- insert branch writes null coords; this closes that gap by requiring the poster's coords on
-- standalone ("My Location") posts.
--
-- Enforcement = a SCOPED extension of the migration-137 trigger (the safest option — see the
-- spec's §4 tradeoff): a column NOT-NULL is wrong here (linked posts intentionally set
-- latitude/longitude to null and store coords in verified_lat/lng), and a CHECK would
-- validate existing rows. A trigger fires on NEW inserts only (zero existing-row risk) and we
-- scope it to standalone posts so linked + legacy event_id paths are untouched.
--
-- Unified coords model: verified_lat/lng/at carry the poster's post-time coords on EVERY post.
-- Idempotent (CREATE OR REPLACE); the BEFORE INSERT binding from migration 137 is re-asserted.

CREATE OR REPLACE FUNCTION enforce_post_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.explore_item_id IS NULL THEN
    -- Standalone / "My Location" post (both FKs null): Phase-3 principle — coords required.
    -- Legacy event_id-only posts still pass through unchanged.
    IF NEW.event_id IS NULL THEN
      IF NEW.verified_lat IS NULL OR NEW.verified_lng IS NULL OR NEW.verified_at IS NULL THEN
        RAISE EXCEPTION
          'invariant violation: a standalone post must include the poster''s coordinates (verified_lat, verified_lng, verified_at)'
          USING HINT = 'My-Location posts must persist the post-time GPS via verified_lat/verified_lng/verified_at.',
          ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Linked posts (explore_item_id set) — unchanged from migration 137.
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

-- Re-assert the trigger binding (unchanged from 137) for idempotency.
DROP TRIGGER IF EXISTS posts_enforce_verification ON posts;
CREATE TRIGGER posts_enforce_verification
  BEFORE INSERT ON posts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_post_verification();

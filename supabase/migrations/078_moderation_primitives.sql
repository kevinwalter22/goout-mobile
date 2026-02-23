-- Migration 078: Moderation Primitives
--
-- Adds core moderation infrastructure:
--   1. moderation_flags     — automated + admin flags on any content
--   2. moderation_actions   — enforcement actions against users (warn, suspend, shadowban)
--   3. user_enforcement     — current enforcement state per user
--   4. Moderation status columns on posts, post_comments, profiles
--   5. RLS policies
--   6. Admin-only RPCs
--
-- Does NOT modify explore_items — it already has review_status (migration 063).

-- ============================================================================
-- 1. Enums
-- ============================================================================

-- Flag source — who/what created the flag
DO $$ BEGIN
  CREATE TYPE moderation_flag_source AS ENUM (
    'auto_text',     -- client or server text classifier
    'auto_image',    -- image classifier (future)
    'user_report',   -- escalated from content_reports
    'admin'          -- manually created by admin
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Flag category (aligns with src/lib/moderation/policy.ts)
DO $$ BEGIN
  CREATE TYPE moderation_category AS ENUM (
    'hate_speech',
    'harassment',
    'sexual_content',
    'doxxing',
    'illegal',
    'spam',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Action taken on flagged content
DO $$ BEGIN
  CREATE TYPE moderation_content_action AS ENUM (
    'allow',
    'quarantine',
    'blocked',
    'blurred'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Content moderation status (for posts, comments, bios)
DO $$ BEGIN
  CREATE TYPE content_moderation_status AS ENUM (
    'approved',
    'quarantined',
    'blocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enforcement action type
DO $$ BEGIN
  CREATE TYPE enforcement_action_type AS ENUM (
    'warn',
    'suspend',
    'shadowban',
    'unsuspend',
    'unshadowban'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. moderation_flags — one row per flag on any piece of content
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.moderation_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who created the flag (null for automated systems using service_role)
  flagged_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- What is being flagged
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'profile', 'explore_item')),
  target_id   TEXT NOT NULL,

  source      moderation_flag_source NOT NULL,
  category    moderation_category NOT NULL,
  severity    INTEGER NOT NULL DEFAULT 50 CHECK (severity >= 0 AND severity <= 100),
  action      moderation_content_action NOT NULL DEFAULT 'quarantine',
  reason      TEXT,
  metadata    JSONB DEFAULT '{}',

  -- Resolution
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution  TEXT  -- admin note on resolution
);

CREATE INDEX idx_moderation_flags_status ON public.moderation_flags(status, created_at DESC);
CREATE INDEX idx_moderation_flags_target ON public.moderation_flags(target_type, target_id);

-- ============================================================================
-- 3. moderation_actions — enforcement log against users
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type    enforcement_action_type NOT NULL,
  duration_hours INTEGER,  -- null = permanent (for suspend/shadowban)
  reason         TEXT,
  metadata       JSONB DEFAULT '{}'
);

CREATE INDEX idx_moderation_actions_user ON public.moderation_actions(user_id, created_at DESC);

-- ============================================================================
-- 4. user_enforcement — current state (single row per user, upserted)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_enforcement (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_suspended    BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_until TIMESTAMPTZ,
  is_shadowbanned BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. Add moderation columns to posts
-- ============================================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS moderation_status content_moderation_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT,
  ADD COLUMN IF NOT EXISTS moderated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderated_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 6. Add moderation columns to post_comments
-- ============================================================================

ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS moderation_status content_moderation_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS moderation_reason TEXT,
  ADD COLUMN IF NOT EXISTS moderated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS moderated_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 7. Add bio moderation columns to profiles
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio_moderation_status content_moderation_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS bio_moderation_reason TEXT;

-- ============================================================================
-- 8. RLS on new tables
-- ============================================================================

ALTER TABLE public.moderation_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_enforcement ENABLE ROW LEVEL SECURITY;

-- ── moderation_flags ────────────────────────────────────────

-- Admins can do everything
CREATE POLICY "Admins can manage flags"
  ON public.moderation_flags FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- service_role can insert (for automated pipelines — bypasses RLS by default,
-- but explicit grant for clarity)
-- No policy needed: service_role bypasses RLS.

-- Regular users CANNOT see moderation_flags at all.
-- (They see moderation_status on their own content via posts/comments RLS.)

-- ── moderation_actions ──────────────────────────────────────

-- Admins can read the log
CREATE POLICY "Admins can view actions"
  ON public.moderation_actions FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- Admins can insert actions (RPCs handle the logic)
CREATE POLICY "Admins can insert actions"
  ON public.moderation_actions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_current_user_admin());

-- ── user_enforcement ────────────────────────────────────────

-- Admins can read/write
CREATE POLICY "Admins can manage enforcement"
  ON public.user_enforcement FOR ALL
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Users can read their own enforcement status
CREATE POLICY "Users can view own enforcement"
  ON public.user_enforcement FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- 9. Update existing RLS to respect moderation_status on posts
--    Quarantined/blocked posts should only be visible to the author + admins.
-- ============================================================================

-- Drop and recreate the authenticated-can-read policy on posts.
-- The existing policy name may vary; use IF EXISTS for safety.
DROP POLICY IF EXISTS "Authenticated users can read posts" ON public.posts;
DROP POLICY IF EXISTS "Anyone can read posts" ON public.posts;

CREATE POLICY "Authenticated users can read posts"
  ON public.posts FOR SELECT
  TO authenticated
  USING (
    moderation_status = 'approved'
    OR user_id = auth.uid()
    OR public.is_current_user_admin()
  );

-- Same for post_comments
DROP POLICY IF EXISTS "Authenticated users can read comments" ON public.post_comments;

CREATE POLICY "Authenticated users can read comments"
  ON public.post_comments FOR SELECT
  TO authenticated
  USING (
    moderation_status = 'approved'
    OR user_id = auth.uid()
    OR public.is_current_user_admin()
  );

-- ============================================================================
-- 10. Admin RPCs
-- ============================================================================

-- ── resolve_flag ────────────────────────────────────────────
-- Marks a moderation flag as resolved with an admin note.
CREATE OR REPLACE FUNCTION public.resolve_flag(
  p_flag_id   UUID,
  p_resolution TEXT,
  p_note       TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE moderation_flags
  SET
    status      = 'resolved',
    resolved_by = auth.uid(),
    resolved_at = now(),
    resolution  = COALESCE(p_note, p_resolution)
  WHERE id = p_flag_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Flag not found: %', p_flag_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_flag(UUID, TEXT, TEXT) TO authenticated;

-- ── set_user_enforcement ────────────────────────────────────
-- Upserts user enforcement state and logs the action.
CREATE OR REPLACE FUNCTION public.set_user_enforcement(
  p_user_id        UUID,
  p_is_suspended   BOOLEAN DEFAULT FALSE,
  p_suspended_until TIMESTAMPTZ DEFAULT NULL,
  p_is_shadowbanned BOOLEAN DEFAULT FALSE,
  p_note           TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action enforcement_action_type;
  v_duration INTEGER;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Determine action type for the log
  IF p_is_suspended THEN
    v_action := 'suspend';
    IF p_suspended_until IS NOT NULL THEN
      v_duration := EXTRACT(EPOCH FROM (p_suspended_until - now())) / 3600;
    END IF;
  ELSIF p_is_shadowbanned THEN
    v_action := 'shadowban';
  ELSE
    -- Lifting enforcement — check what was previously set
    v_action := 'unsuspend';  -- default; will be overridden if shadowban was active
    IF EXISTS (
      SELECT 1 FROM user_enforcement
      WHERE user_id = p_user_id AND is_shadowbanned = TRUE
    ) THEN
      v_action := 'unshadowban';
    END IF;
  END IF;

  -- Upsert enforcement state
  INSERT INTO user_enforcement (user_id, is_suspended, suspended_until, is_shadowbanned, notes, updated_at)
  VALUES (p_user_id, p_is_suspended, p_suspended_until, p_is_shadowbanned, p_note, now())
  ON CONFLICT (user_id) DO UPDATE SET
    is_suspended    = EXCLUDED.is_suspended,
    suspended_until = EXCLUDED.suspended_until,
    is_shadowbanned = EXCLUDED.is_shadowbanned,
    notes           = EXCLUDED.notes,
    updated_at      = now();

  -- Log the action
  INSERT INTO moderation_actions (admin_id, user_id, action_type, duration_hours, reason)
  VALUES (auth.uid(), p_user_id, v_action, v_duration, p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_enforcement(UUID, BOOLEAN, TIMESTAMPTZ, BOOLEAN, TEXT) TO authenticated;

-- ── moderate_content ────────────────────────────────────────
-- Sets moderation status on a piece of content and creates a flag record.
CREATE OR REPLACE FUNCTION public.moderate_content(
  p_target_type TEXT,
  p_target_id   TEXT,
  p_action      content_moderation_status,
  p_reason      TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Update the content's moderation status
  IF p_target_type = 'post' THEN
    UPDATE posts
    SET moderation_status = p_action,
        moderation_reason = p_reason,
        moderated_at      = now(),
        moderated_by      = auth.uid()
    WHERE id = p_target_id::uuid;
  ELSIF p_target_type = 'comment' THEN
    UPDATE post_comments
    SET moderation_status = p_action,
        moderation_reason = p_reason,
        moderated_at      = now(),
        moderated_by      = auth.uid()
    WHERE id = p_target_id::uuid;
  ELSIF p_target_type = 'profile' THEN
    UPDATE profiles
    SET bio_moderation_status = p_action,
        bio_moderation_reason = p_reason
    WHERE id = p_target_id::uuid;
  ELSIF p_target_type = 'explore_item' THEN
    -- Map to existing review_status enum
    UPDATE explore_items
    SET review_status = CASE p_action
          WHEN 'approved'    THEN 'approved'::review_status
          WHEN 'quarantined' THEN 'quarantined'::review_status
          WHEN 'blocked'     THEN 'rejected'::review_status
        END,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_target_id::uuid;
  ELSE
    RAISE EXCEPTION 'Unknown target_type: %', p_target_type;
  END IF;

  -- Create a flag record for audit trail
  INSERT INTO moderation_flags (
    flagged_by, target_type, target_id,
    source, category, severity, action, reason, status, resolved_by, resolved_at
  ) VALUES (
    auth.uid(), p_target_type, p_target_id,
    'admin', 'other', 75, p_action::text::moderation_content_action, p_reason,
    'resolved', auth.uid(), now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.moderate_content(TEXT, TEXT, content_moderation_status, TEXT) TO authenticated;

-- ============================================================================
-- 11. Grants
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON public.moderation_flags TO authenticated;
GRANT SELECT, INSERT ON public.moderation_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_enforcement TO authenticated;

-- ============================================================================
-- 12. Verification queries (run manually to confirm correctness)
-- ============================================================================
-- See bottom of file for verification SQL.

/*
-- VERIFICATION: Run these as different roles to confirm RLS.

-- A) As a non-admin authenticated user:
--    Should return 0 rows:
SELECT count(*) FROM moderation_flags;      -- expect 0
SELECT count(*) FROM moderation_actions;    -- expect 0

--    Should return own enforcement row (or 0 if none):
SELECT * FROM user_enforcement WHERE user_id = auth.uid();

--    Can see their own moderation_status on their posts:
SELECT id, moderation_status FROM posts WHERE user_id = auth.uid();

-- B) As an admin user:
--    Should return all rows:
SELECT count(*) FROM moderation_flags;      -- expect ≥ 0
SELECT count(*) FROM moderation_actions;    -- expect ≥ 0
SELECT count(*) FROM user_enforcement;      -- expect ≥ 0

-- C) Admin-only RPCs fail for non-admin:
--    These should raise "Admin access required":
SELECT resolve_flag(gen_random_uuid(), 'test');
SELECT set_user_enforcement(gen_random_uuid());
SELECT moderate_content('post', gen_random_uuid()::text, 'blocked');

-- D) Quarantined posts hidden from non-authors:
--    Insert a quarantined post, then query as a different user — should not appear.
--    As admin: UPDATE posts SET moderation_status = 'quarantined' WHERE id = '<some_id>';
--    As other user: SELECT * FROM posts WHERE id = '<some_id>';  -- expect 0 rows
--    As author:     SELECT * FROM posts WHERE id = '<some_id>';  -- expect 1 row
*/

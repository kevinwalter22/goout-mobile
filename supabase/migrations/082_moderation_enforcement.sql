-- Migration 082: Moderation Enforcement
--
-- Adds enforcement infrastructure:
--   1. Shadowban triggers on posts + post_comments (auto-quarantine)
--   2. check_enforcement() RPC — returns current user's enforcement state
--   3. Rate limit RPCs for posts + comments (stricter for new accounts)
--   4. get_moderation_inbox() RPC — admin flag inbox
--   5. Report reason constraint update (add hate_speech, sexual_content)
--   6. RLS policy for user_report flag inserts

-- ============================================================================
-- 1. Shadowban triggers — auto-quarantine content from shadowbanned users
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_shadowban_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_enforcement
    WHERE user_id = NEW.user_id AND is_shadowbanned = TRUE
  ) THEN
    NEW.moderation_status := 'quarantined';
    NEW.moderation_reason := 'shadowbanned';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shadowban_posts
  BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shadowban_on_insert();

CREATE TRIGGER trg_shadowban_comments
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shadowban_on_insert();

-- ============================================================================
-- 2. check_enforcement() — returns caller's enforcement state
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_enforcement()
RETURNS TABLE(is_suspended BOOLEAN, suspended_until TIMESTAMPTZ, is_shadowbanned BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.is_suspended, e.suspended_until, e.is_shadowbanned
  FROM user_enforcement e
  WHERE e.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.check_enforcement() TO authenticated;

-- ============================================================================
-- 3. Rate limit RPCs — stricter for accounts < 24h old
-- ============================================================================

-- Uses check_rate_limit(uuid, text, int, int) from migration 073.

CREATE OR REPLACE FUNCTION public.check_post_rate_limit()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_at TIMESTAMPTZ;
BEGIN
  SELECT created_at INTO v_created_at FROM profiles WHERE id = auth.uid();
  IF v_created_at > NOW() - INTERVAL '24 hours' THEN
    -- New account: 5 posts per day
    PERFORM check_rate_limit(auth.uid(), 'post_create', 5, 86400);
  ELSE
    -- Normal: 50 posts per day
    PERFORM check_rate_limit(auth.uid(), 'post_create', 50, 86400);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_post_rate_limit() TO authenticated;

CREATE OR REPLACE FUNCTION public.check_comment_rate_limit()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_at TIMESTAMPTZ;
BEGIN
  SELECT created_at INTO v_created_at FROM profiles WHERE id = auth.uid();
  IF v_created_at > NOW() - INTERVAL '24 hours' THEN
    -- New account: 20 comments per day
    PERFORM check_rate_limit(auth.uid(), 'comment_create', 20, 86400);
  ELSE
    -- Normal: 200 comments per day
    PERFORM check_rate_limit(auth.uid(), 'comment_create', 200, 86400);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_comment_rate_limit() TO authenticated;

-- ============================================================================
-- 4. get_moderation_inbox() — admin-only flag inbox
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_moderation_inbox(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_target_type TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  created_at TIMESTAMPTZ,
  flagged_by UUID,
  target_type TEXT,
  target_id TEXT,
  source moderation_flag_source,
  category moderation_category,
  severity INTEGER,
  action moderation_content_action,
  reason TEXT,
  metadata JSONB,
  status TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    mf.id, mf.created_at, mf.flagged_by,
    mf.target_type, mf.target_id,
    mf.source, mf.category, mf.severity,
    mf.action, mf.reason, mf.metadata, mf.status
  FROM moderation_flags mf
  WHERE mf.status = 'open'
    AND (p_target_type IS NULL OR mf.target_type = p_target_type)
    AND (p_source IS NULL OR mf.source::text = p_source)
  ORDER BY mf.severity DESC, mf.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_moderation_inbox(INT, INT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 5. Update content_reports reason constraint
--    Add hate_speech + sexual_content; keep old values for historical rows
-- ============================================================================

ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_reason_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_reason_check
  CHECK (reason IN (
    'spam', 'harassment', 'hate_speech', 'sexual_content', 'other',
    'inappropriate_content', 'impersonation'
  ));

-- ============================================================================
-- 6. RLS: allow authenticated users to insert user_report flags
-- ============================================================================

CREATE POLICY "Users can insert user_report flags"
  ON public.moderation_flags FOR INSERT
  TO authenticated
  WITH CHECK (source = 'user_report' AND flagged_by = auth.uid());

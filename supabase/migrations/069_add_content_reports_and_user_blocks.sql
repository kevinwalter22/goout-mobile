-- Migration 069: Content Reports & User Blocks
-- Required by Apple for UGC apps: users must be able to report content and block users.

-- ============================================================================
-- 1. content_reports — users can report posts, comments, or users
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.content_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'user')),
  target_id   TEXT NOT NULL,  -- UUID of the post, comment, or user being reported
  reason      TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate_content', 'impersonation', 'other')),
  details     TEXT,           -- Optional free-text explanation
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin review queue (pending reports first)
CREATE INDEX idx_content_reports_status ON public.content_reports(status, created_at DESC);
-- Index so we can check "has this user already reported this target?"
CREATE INDEX idx_content_reports_dedup ON public.content_reports(reporter_id, target_type, target_id);

-- RLS
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- Users can create reports
CREATE POLICY "Users can create reports"
  ON public.content_reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Users can see their own reports
CREATE POLICY "Users can view own reports"
  ON public.content_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- Admins can view all reports
CREATE POLICY "Admins can view all reports"
  ON public.content_reports FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- Admins can update report status
CREATE POLICY "Admins can update reports"
  ON public.content_reports FOR UPDATE
  TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- ============================================================================
-- 2. user_blocks — users can block other users
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_blocks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)  -- can't block yourself
);

-- Index for looking up "who have I blocked?"
CREATE INDEX idx_user_blocks_blocker ON public.user_blocks(blocker_id);
-- Index for looking up "who has blocked me?" (used to hide content)
CREATE INDEX idx_user_blocks_blocked ON public.user_blocks(blocked_id);

-- RLS
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- Users can block others
CREATE POLICY "Users can block others"
  ON public.user_blocks FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

-- Users can see their own blocks
CREATE POLICY "Users can view own blocks"
  ON public.user_blocks FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

-- Users can unblock (delete their own blocks)
CREATE POLICY "Users can unblock"
  ON public.user_blocks FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

-- ============================================================================
-- 3. Helper RPC: get_blocked_user_ids
-- Returns the set of user IDs the current user has blocked.
-- Used client-side to filter feed, comments, etc.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_blocked_user_ids()
RETURNS SETOF UUID AS $$
  SELECT blocked_id FROM public.user_blocks WHERE blocker_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_blocked_user_ids() TO authenticated;

-- ============================================================================
-- 4. Grant access
-- ============================================================================
GRANT SELECT, INSERT ON public.content_reports TO authenticated;
GRANT UPDATE ON public.content_reports TO authenticated;  -- admin RLS restricts
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;

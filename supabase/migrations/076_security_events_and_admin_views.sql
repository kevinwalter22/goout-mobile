-- ============================================================================
-- 076: Security Events table + admin summary
-- Lightweight abuse/security monitoring for production.
-- ============================================================================

-- 1. security_events table
CREATE TABLE IF NOT EXISTS public.security_events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL    DEFAULT now(),
  user_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT        NOT NULL,
  severity   TEXT        NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  metadata   JSONB       NOT NULL DEFAULT '{}',
  ip_hash    TEXT                  -- SHA-256 of IP; raw IP never stored
);

-- Indexes for efficient querying
CREATE INDEX idx_security_events_created ON security_events (created_at DESC);
CREATE INDEX idx_security_events_type    ON security_events (event_type);
CREATE INDEX idx_security_events_sev     ON security_events (severity);
CREATE INDEX idx_security_events_user    ON security_events (user_id);

COMMENT ON TABLE  security_events IS 'Audit log for security-relevant actions. No raw PII stored.';
COMMENT ON COLUMN security_events.ip_hash IS 'SHA-256 hash of client IP (if available). Raw IP is never stored.';

-- 2. RLS
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert events tied to their own user_id
CREATE POLICY "Users can insert own security events"
  ON security_events FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Admins can read all events
CREATE POLICY "Admins can read all security events"
  ON security_events FOR SELECT
  TO authenticated
  USING (public.is_current_user_admin());

-- Service role has full access (server-side logging)
CREATE POLICY "Service role full access on security_events"
  ON security_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. RPC: log_security_event (SECURITY DEFINER so rate-limited callers can insert)
CREATE OR REPLACE FUNCTION log_security_event(
  p_event_type TEXT,
  p_severity   TEXT,
  p_metadata   JSONB DEFAULT '{}'
)
RETURNS VOID AS $$
BEGIN
  IF p_severity NOT IN ('low', 'medium', 'high', 'critical') THEN
    RAISE EXCEPTION 'Invalid severity: %', p_severity;
  END IF;

  INSERT INTO security_events (user_id, event_type, severity, metadata)
  VALUES (auth.uid(), p_event_type, p_severity, p_metadata);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION log_security_event(TEXT, TEXT, JSONB) TO authenticated;

-- 4. Admin summary function
CREATE OR REPLACE FUNCTION get_security_event_summary(
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE(
  event_date   DATE,
  event_type   TEXT,
  severity     TEXT,
  event_count  BIGINT,
  unique_users BIGINT
) AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    (se.created_at AT TIME ZONE 'UTC')::DATE AS event_date,
    se.event_type,
    se.severity,
    COUNT(*)              AS event_count,
    COUNT(DISTINCT se.user_id) AS unique_users
  FROM security_events se
  WHERE se.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, 4 DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_security_event_summary(INTEGER) TO authenticated;

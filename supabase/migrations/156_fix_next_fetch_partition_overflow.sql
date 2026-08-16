-- 156_fix_next_fetch_partition_overflow.sql
--
-- ROOT CAUSE of the ~2-month API-ingestion blackout (Jun–Aug 2026):
-- next_fetch_partition's exponential-backoff clause computed
--   fetch_interval_minutes * POWER(2, consecutive_errors) * INTERVAL '1 minute'
-- and only THEN capped it with LEAST(..., INTERVAL '24 hours'). Because both
-- arguments of LEAST are evaluated before the cap applies, a partition with a
-- large consecutive_errors overflows the interval type (POWER(2, 27) ≈ 1.3e8;
-- times the interval blows past Postgres's ±178M-year / int64-microsecond range)
-- and the WHOLE selection query aborts with "22008: interval out of range".
--
-- A dead Yelp partition (api_yelp has no ingest function → failed every pick →
-- consecutive_errors climbed to 27) tripped this mid-June. Once the query throws,
-- the fetch-coordinator can never select ANY partition again — so Ticketmaster,
-- PredictHQ, and every partition-driven source silently froze at once.
--
-- FIX: compute the backoff window entirely in NUMERIC minutes (never as an
-- interval), cap the exponent at 12 (2^12 = 4096) AND the total at 1440 minutes
-- (24h), then compare against minutes-since-fetch. No interval arithmetic on the
-- unbounded value → no overflow, for any consecutive_errors. Behaviour is
-- otherwise identical to the original intent (retry backoff, capped at 24h).

CREATE OR REPLACE FUNCTION public.next_fetch_partition(p_source_type text DEFAULT NULL::text)
 RETURNS TABLE(partition_id uuid, source_id uuid, source_name text, source_type text, partition_label text, config_json jsonb, minutes_since_fetch double precision)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    fp.id AS partition_id,
    fp.source_id,
    es.name AS source_name,
    es.type::TEXT AS source_type,
    fp.partition_label,
    COALESCE(es.config_json, '{}'::JSONB) || fp.config_json AS config_json,
    CASE
      WHEN fp.last_fetched_at IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (NOW() - fp.last_fetched_at)) / 60.0)::FLOAT8
      ELSE NULL
    END AS minutes_since_fetch
  FROM fetch_partitions fp
  JOIN event_sources es ON es.id = fp.source_id
  WHERE fp.is_enabled = TRUE
    AND es.is_enabled = TRUE
    AND (
      fp.last_fetched_at IS NULL
      OR (NOW() - fp.last_fetched_at) > (fp.fetch_interval_minutes * INTERVAL '1 minute')
    )
    -- Overflow-safe exponential backoff: all math in minutes-as-numeric, capped
    -- before it can ever become an out-of-range interval.
    AND (
      fp.consecutive_errors = 0
      OR fp.last_fetched_at IS NULL
      OR (EXTRACT(EPOCH FROM (NOW() - fp.last_fetched_at)) / 60.0) > LEAST(
        fp.fetch_interval_minutes::double precision * POWER(2, LEAST(fp.consecutive_errors, 12)),
        1440.0  -- hard 24h cap, in minutes
      )
    )
    AND (p_source_type IS NULL OR es.type::TEXT = p_source_type)
  ORDER BY
    fp.last_fetched_at ASC NULLS FIRST,
    fp.priority DESC,
    fp.last_fetched_at ASC
  LIMIT 1
  FOR UPDATE OF fp SKIP LOCKED;
END;
$function$;

-- Durably retire the partition that triggered the overflow: api_yelp has no ingest
-- function in the fetch-coordinator's SOURCE_FUNCTION_MAP, so it fails every pick and
-- accumulates consecutive_errors forever. Disable it across environments (idempotent).
-- With the overflow fixed above this is belt-and-suspenders, but it keeps a dead source
-- out of the live queue.
UPDATE public.fetch_partitions p
SET is_enabled = FALSE, consecutive_errors = 0
FROM public.event_sources es
WHERE es.id = p.source_id
  AND es.type = 'api_yelp'
  AND p.is_enabled = TRUE;

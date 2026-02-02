# Eventbrite Integration — Deprecated

## Summary

Eventbrite **removed public location-based event discovery** from their API in February 2020. The `/v3/events/search/` endpoint that our ingestion function relied on returns HTTP 404.

There is **no replacement endpoint** for searching events by geographic location.

## Timeline

| Date | Event |
|------|-------|
| Dec 2019 | Eventbrite announced deprecation of `/v3/events/search/` |
| Feb 2020 | Endpoint fully removed (returns 404) |
| Jan 2026 | Wave 2 built ingestion function (W2-1) — endpoint already gone |
| Feb 2026 | Wave 3 Phase 0 — disabled integration cleanly |

## What Was Disabled

1. **Edge Function `ingest-eventbrite`** — rewritten as safe no-op. Logs `status: "disabled"` to `pipeline_health_log` without making any network calls.
2. **DB source row** — `event_sources.is_enabled = false` for `type = 'api_eventbrite'` (migration 036).
3. **Fetch partitions** — disabled for Eventbrite source.
4. **Normalization jobs** — any queued Eventbrite jobs marked as failed.

## What Was Preserved

- **Source adapter** (`_shared/source-adapters/eventbrite.ts`) — mapping code for Eventbrite event JSON → `explore_items` schema. Harmless and potentially reusable.
- **Adapter registry entry** (`_shared/source-adapters/index.ts`) — `api_eventbrite` mapping still registered.
- **Coordinator mapping** (`fetch-coordinator/index.ts`) — `api_eventbrite: "ingest-eventbrite"` still in map. The DB disable prevents it from ever being picked.
- **DB enum value** — `api_eventbrite` remains in `event_source_type` enum (migration 017). Enums should not have values removed.

## We Will NOT Scrape Eventbrite

Eventbrite's Terms of Service prohibit scraping. We respect this and will not implement web scraping or any workaround to extract event data from their website.

## Future: Curated Organizer Ingest (Optional)

Eventbrite still supports these endpoints:

- `GET /v3/organizations/{org_id}/events/` — list events for a specific organizer
- `GET /v3/venues/{venue_id}/events/` — list events at a specific venue

If we identify specific Potsdam-area organizers on Eventbrite, we could:

1. Re-enable the source: `UPDATE event_sources SET is_enabled = true WHERE type = 'api_eventbrite';`
2. Add `organization_ids` to `config_json`
3. Rewrite `ingest-eventbrite` to iterate over configured org IDs
4. The existing adapter and normalizer would work without changes

This requires no code changes to the pipeline infrastructure — only the ingestion function and source config.

## Rollback

To re-enable Eventbrite (only after implementing organizer-based ingest):

```sql
UPDATE event_sources SET is_enabled = true WHERE type = 'api_eventbrite';
UPDATE fetch_partitions SET is_enabled = true
  WHERE source_id IN (SELECT id FROM event_sources WHERE type = 'api_eventbrite');
```

## References

- [Eventbrite API deprecation notice (GitHub)](https://github.com/Automattic/eventbrite-api/issues/83)
- [Eventbrite API Reference](https://www.eventbrite.com/platform/api)
- [Eventbrite API Developers Community](https://groups.google.com/g/eventbrite-api)

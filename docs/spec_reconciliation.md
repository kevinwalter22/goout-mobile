# Spec Reconciliation: Intelligence Engine vs. As-Built

> Compares the 7-layer Intelligence Engine spec against the actual implementation.
> Traffic light: BUILT / PARTIAL / STUB / NOT STARTED

---

## Layer-by-Layer Comparison

### Layer 1: Discovery Layer

**Spec vision**: Autonomous source discovery - find every possible source of activity data for a region. Seed expansion, search engine mining, social listening, user reports.

| Spec Feature | Status | Implementation |
|-------------|--------|----------------|
| Source registry table | BUILT | `event_sources` table with name, type, config_json, fetch_interval, last_fetch_at |
| Source type taxonomy | PARTIAL | 7 enum types defined (curated_csv, api_ticketmaster, api_predicthq, api_eventbrite, api_yelp, api_google_places, manual). Only 2 populated: curated_csv + api_ticketmaster |
| Source reliability scoring | NOT STARTED | Spec calls for `reliability_score` (0-1). Not in schema |
| Source health monitoring | STUB | `is_enabled` flag exists. `get_ingestion_stats()` returns counts per source. No automated health checks |
| Freshness scheduling | BUILT | `fetch_interval_minutes` + `last_fetch_at` + `source_needs_fetch()` + `get_sources_due_for_fetch()` |
| Seed expansion / crawling | NOT STARTED | No automated discovery of new sources |
| Search engine mining | NOT STARTED | No programmatic source finding |
| Social listening | NOT STARTED | No social signal monitoring |
| User-reported sources | NOT STARTED | No UI for source submission |
| Geographic coverage metadata | NOT STARTED | Spec has `geographic_coverage.regions`. DB has `config_json` with lat/lng defaults but no formal coverage model |
| Scrape strategy per source | PARTIAL | Adapter pattern exists (`source-adapters/`), but only Ticketmaster implemented. No HTML scraping, PDF extraction, or social API adapters |

**Gap summary**: The source registry table is well-designed but only has 2 sources. Discovery is entirely manual. The spec's vision of autonomous source-finding is not yet implemented.

---

### Layer 2: Extraction Layer

**Spec vision**: Pull raw data from discovered sources via source-specific strategies (REST APIs, HTML scraping, Playwright, PDFs, vision models). Log extraction confidence per field.

| Spec Feature | Status | Implementation |
|-------------|--------|----------------|
| Raw data storage | BUILT | `event_ingest_raw` with `raw_json` (JSONB), `raw_hash` (SHA256), `status`, `fetched_at` |
| Source-specific adapters | PARTIAL | Adapter registry pattern in `_shared/source-adapters/`. Only `ticketmaster.ts` implemented |
| API extraction | BUILT | Ticketmaster Discovery API v2 - paginated, rate-limited, deduplication via hash |
| HTML scraping | NOT STARTED | No Cheerio/Playwright extraction |
| PDF extraction | NOT STARTED | No PDF processing |
| Image/flyer extraction | NOT STARTED | No vision model extraction |
| Social post extraction | NOT STARTED | No social platform integration |
| Email newsletter parsing | NOT STARTED | No IMAP ingestion |
| Per-field confidence scores | NOT STARTED | Spec wants `{value, confidence, source_element}` per field. Implementation stores flat raw JSON |
| LLM-assisted extraction | NOT STARTED | Spec describes LLM extraction prompts. Not implemented at extraction layer (LLM used at enrichment layer instead) |
| Extraction metadata | PARTIAL | `raw_hash` for change detection. No `extraction_duration_ms`, `fields_missing`, `overall_confidence` |
| Provenance tracking | PARTIAL | `source_id` + `external_id` tracked. No per-field source element tracking |

**Gap summary**: Ticketmaster API extraction is solid. The adapter pattern is extensible. But extraction is limited to a single API source. HTML scraping, PDFs, social, and email are all absent. Per-field confidence scoring is not implemented.

---

### Layer 3: Validation Layer

**Spec vision**: Cross-reference data across sources, verify temporal/geographic consistency, detect duplicates, flag stale data.

| Spec Feature | Status | Implementation |
|-------------|--------|----------------|
| Temporal validation | PARTIAL | `starts_at` checked in queries. No automated "has this event passed?" cleanup |
| Geographic validation | PARTIAL | Lat/lng stored and used for distance filtering. No "do coords match address?" verification |
| Cross-source validation | NOT STARTED | No multi-source confirmation |
| Duplicate detection | PARTIAL | `UNIQUE(source_id, external_id)` prevents intra-source duplicates. No cross-source fuzzy dedup |
| Semantic validation | NOT STARTED | No "does description match activity type?" checks |
| Freshness detection | STUB | `source_needs_fetch()` checks interval. No stale-item detection or expiration |
| Confidence scoring | NOT STARTED | No per-item confidence score. Spec wants 0.0-1.0 threshold-based serving |
| Validation checks table | NOT STARTED | Spec defines `validations` table. Not implemented |
| Stale/expired lifecycle | NOT STARTED | Items are never marked stale or expired |

**Gap summary**: This is the least-implemented layer. There is no formal validation pipeline. Deduplication is only within a single source. The confidence threshold principle (the core philosophy of the spec) is entirely absent.

---

### Layer 4: Resolution Layer

**Spec vision**: Autonomously fill data gaps through email, SMS, phone outreach. Parse responses, update records, escalate to humans.

| Spec Feature | Status | Implementation |
|-------------|--------|----------------|
| Resolution queue | NOT STARTED | Spec defines `resolution_queue` table. Not implemented |
| Email outreach | NOT STARTED | No SendGrid/Postmark integration |
| SMS outreach | NOT STARTED | No Twilio integration |
| AI voice calls | NOT STARTED | No Vapi/Bland.ai integration |
| Response parsing | NOT STARTED | No response ingestion |
| Outreach log | NOT STARTED | Spec defines `outreach_log` table. Not implemented |
| Human escalation | NOT STARTED | No manual review queue |
| Organizer registry | NOT STARTED | Spec defines `organizers` table. Not implemented |

**Gap summary**: Entirely unbuilt. This is the spec's most ambitious layer (automated business outreach). Reasonable to defer - high complexity, legal considerations.

---

### Layer 5: Enrichment Layer

**Spec vision**: Add flourishing scores, difficulty assessment, gear/skill prerequisites, supporting services, accessibility, weather sensitivity. Transform raw data into "actionable intelligence."

| Spec Feature | Status | Implementation |
|-------------|--------|----------------|
| LLM enrichment pipeline | BUILT | Queue-based (`enrichment_queue`), claim/complete pattern, batch worker + single-item function |
| LLM provider abstraction | BUILT | `llm-provider.ts` - Anthropic/OpenAI with factory pattern |
| Hook line generation | BUILT | LLM generates 10-20 word compelling descriptions |
| Tag assignment | BUILT | 55-tag taxonomy, validated against whitelist |
| Availability extraction | BUILT | Structured `availability_json` with type, days, times, seasons, next_occurrence, recurrence, confidence |
| Price bucket inference | BUILT | LLM infers from context, validated against enum |
| Flourishing dimension scoring | NOT STARTED | Spec wants agency/growth/connection/meaning/engagement (0-10 each). Not in schema |
| Difficulty assessment | NOT STARTED | Spec wants physical_intensity, technical_skill, risk_level. Only `effort` enum (low/medium/high) exists |
| Prerequisite mapping | NOT STARTED | Spec wants gear required + rental options, skills required + learning resources. Not implemented |
| Supporting service linking | NOT STARTED | Spec wants nearby food, lodging, emergency. Not in schema |
| Accessibility assessment | NOT STARTED | Spec wants wheelchair, mobility, visual, hearing, family, dog. Not implemented |
| Weather sensitivity | NOT STARTED | Spec wants cancellation conditions, ideal conditions. Not implemented |
| Gear provider registry | NOT STARTED | Spec defines `gear_providers` table. Not implemented |

**Gap summary**: The LLM enrichment pipeline is the strongest implemented piece. Hook lines, tags, availability, and price are all working. But the spec's deep enrichment (flourishing scores, prerequisites, supporting services, accessibility) is entirely absent. The current enrichment is ~20% of the spec's vision for this layer.

---

### Layer 6: Planning Layer

**Spec vision**: Assemble multi-activity itineraries, optimize for logistics/energy/flourishing balance, handle bookings, create contingency plans.

| Spec Feature | Status | Implementation |
|-------------|--------|----------------|
| Trip planning engine | NOT STARTED | Spec defines `trips` table with daily_itineraries, packing_list, contingencies. Not implemented |
| Multi-activity itineraries | NOT STARTED | No itinerary generation |
| Schedule optimization | NOT STARTED | No travel time / energy curve optimization |
| Booking coordination | NOT STARTED | No booking integration |
| Contingency planning | NOT STARTED | No weather-based alternatives |
| Packing list generation | NOT STARTED | No gear/clothing recommendation |
| Personalization | NOT STARTED | No user flourishing profile matching |

**Gap summary**: Entirely unbuilt. This is a Phase 4 (weeks 15-18) feature in the spec.

---

### Layer 7: Orchestration Layer

**Spec vision**: Workflow state machine, cross-layer coordination, error handling with retry policies, monitoring/alerting, data consistency.

| Spec Feature | Status | Implementation |
|-------------|--------|----------------|
| Activity lifecycle state machine | PARTIAL | Items go through: ingested -> normalized -> enriched. But no VALIDATING, NEEDS_RESOLVE, STALE, EXPIRED states |
| Job queues | BUILT | Two queue tables with claim/complete pattern (normalization + enrichment) |
| Atomic job claiming | BUILT | `FOR UPDATE SKIP LOCKED` pattern for concurrent workers |
| Retry with backoff | PARTIAL | `attempts` + `max_attempts` tracked. No exponential delay logic in DB (workers add 200ms between items) |
| pg_cron scheduling | BUILT | 4 scheduled jobs (ingest, normalize, enrich, cleanup) |
| Error logging | PARTIAL | `last_error` on queue jobs. No structured error taxonomy |
| Monitoring dashboard | NOT STARTED | `get_ingestion_stats()` exists but no Grafana/Prometheus integration |
| Alerting | NOT STARTED | No PagerDuty/Opsgenie integration |
| Cross-layer communication | BUILT | DB triggers (auto-queue normalization on raw insert), RPC calls between functions |
| Temporal.io workflows | NOT STARTED | Spec recommends Temporal.io. Using pg_cron + Edge Functions instead |

**Gap summary**: Basic orchestration works (queues, scheduling, triggers). Missing the advanced lifecycle states, monitoring, and alerting.

---

## Summary Scorecard

| Layer | Spec Scope | Built | Score |
|-------|-----------|-------|-------|
| 1. Discovery | Find all sources autonomously | Source registry table + 2 sources | 15% |
| 2. Extraction | Multi-format extraction with confidence | Ticketmaster API only | 20% |
| 3. Validation | Cross-source verification, dedup, freshness | Intra-source dedup only | 5% |
| 4. Resolution | Autonomous outreach (email/SMS/phone) | Nothing | 0% |
| 5. Enrichment | Deep context (flourishing, gear, accessibility) | LLM pipeline for tags/availability/price/hooks | 35% |
| 6. Planning | Trip assembly and optimization | Nothing | 0% |
| 7. Orchestration | State machine, monitoring, alerting | Queues + scheduling + triggers | 30% |

**Overall**: ~15% of spec implemented by feature count, but the implemented 15% forms a working end-to-end pipeline from ingestion through enrichment to user-facing queries.

---

## What EXISTS but spec DOESN'T cover

The spec focuses on the data pipeline. These features exist in the app but are outside spec scope:

1. **Social layer**: Posts, reactions, comments, friendships - fully built
2. **Check-in system**: Dual-camera check-in with geolocation verification
3. **Gamification**: XP, streaks, priority scoring
4. **RSVP system**: Both legacy events and explore_items
5. **Postable Now**: Proximity + time-based "check in here now" system
6. **Filter/sort UI**: Config-driven filter chips, category mapping, distance sorting

---

## 3-Horizon Roadmap

### Horizon 1: Solidify Foundation (Weeks 1-4)
- Fix migration numbering conflict (two 023s)
- Add data staleness detection (mark items with past starts_at as expired)
- Add cross-source dedup (fuzzy matching on title + location + date)
- Add 2-3 more sources (Eventbrite, Google Places, local rec department)
- Add basic confidence scoring to explore_items

### Horizon 2: Quality & Intelligence (Weeks 5-10)
- Build validation pipeline (temporal, geographic, semantic checks)
- Upgrade enrichment to include difficulty/effort assessment
- Add basic flourishing dimension scoring
- Add weather sensitivity flags
- Build monitoring dashboard (Supabase logs + basic metrics)

### Horizon 3: Autonomy & Planning (Weeks 11-18)
- Email-based resolution outreach for missing data
- Trip planning MVP (single-day itinerary generation)
- Prerequisite/gear dependency mapping
- Supporting service linking (nearby food, lodging)
- Multi-region expansion

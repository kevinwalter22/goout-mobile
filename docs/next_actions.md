# Next Actions: Concrete Tasks Ordered by ROI

> 20 tasks ordered by impact/effort ratio. Each includes files to touch and a rough scope indicator.

---

## Tier 1: Quick Wins (High Impact, Low Effort)

### 1. Fix duplicate migration numbering
- **Problem**: Two files named `023_*.sql`. Will cause deployment errors.
- **Action**: Rename `023_upgrade_enrichment_pipeline.sql` to `027_upgrade_enrichment_pipeline.sql`
- **Files**: `supabase/migrations/023_upgrade_enrichment_pipeline.sql`
- **Scope**: 1 file rename

### 2. Add stale/expired item detection
- **Problem**: Past events remain in explore_items forever. "This Weekend" filter may return events from months ago.
- **Action**: Add scheduled function or migration that sets a `status` column. Items with `starts_at < NOW() - INTERVAL '1 day'` and `kind = 'event'` marked `expired`. Exclude expired from queries.
- **Files**: New migration, `src/lib/exploreQuery.ts` (add `.neq('status', 'expired')` or equivalent)
- **Scope**: 1 migration + 1 query file

### 3. Add tag-based filtering to query builder
- **Problem**: Quick filters like "Outdoors" and "Live Music" use tag-to-category mapping, but tags are not directly queried. Items tagged `live_music` in the "Nightlife" category won't match the "Arts & Culture" category mapping.
- **Action**: When quick filter has `tags[]`, query `explore_items` where `tags && ARRAY['live_music', 'concert']` (overlap operator) instead of mapping to categories.
- **Files**: `src/lib/exploreQuery.ts`, `supabase/migrations/022_add_availability_filter_function.sql` (add tag parameter to `filter_explore_items`)
- **Scope**: 1 migration + 1 query file

### 4. Add search to explore tab
- **Problem**: No text search. Users can't find items by name.
- **Action**: Add search bar to explore.tsx. Use Supabase `.ilike('title', `%${query}%`)` or PostgreSQL full-text search.
- **Files**: `app/(tabs)/explore.tsx`, `src/lib/exploreQuery.ts`
- **Scope**: 2 files

### 5. Add source adapter for Eventbrite
- **Problem**: Only Ticketmaster events. Missing community events, workshops, classes.
- **Action**: Create `_shared/source-adapters/eventbrite.ts`, add `api_eventbrite` to source registry, create `ingest-eventbrite` Edge Function.
- **Files**: New adapter file, new Edge Function, new migration seed row
- **Scope**: 3-4 files, follows Ticketmaster pattern

---

## Tier 2: Medium Effort, High Value

### 6. Add confidence scoring to explore_items
- **Problem**: The spec's core philosophy (confidence thresholds) is entirely absent. All items treated equally regardless of data quality.
- **Action**: Add `confidence_score DECIMAL` column. Compute: +0.2 for having description, +0.2 for tags, +0.2 for availability_json, +0.2 for lat/lng, +0.2 for price_bucket != unknown. Update in `apply_enrichment()`.
- **Files**: New migration, update `apply_enrichment()`, optionally filter low-confidence items in queries
- **Scope**: 1 migration + 1 function update

### 7. Upgrade enrichment prompt to include difficulty/effort
- **Problem**: `effort` column is always "low" (hardcoded in Ticketmaster adapter). Curated items have varying effort but it's static.
- **Action**: Add effort inference to enrichment prompt. Map LLM response to `effort` column.
- **Files**: `_shared/enrichment-schema.ts` (prompt + validation), `apply_enrichment()` migration
- **Scope**: 2 files + 1 migration

### 8. Add Google Places / Yelp source for activities
- **Problem**: Activities (restaurants, bars, trails) are all curated CSV data. No automated refresh.
- **Action**: Create adapter for Google Places API (or Yelp Fusion API) for the Potsdam area. Focus on categories: restaurants, bars, breweries, outdoor recreation.
- **Files**: New adapter, new Edge Function, new migration seed
- **Scope**: 3-4 files

### 9. Add "friends going" badge to explore list
- **Problem**: RSVP data exists (`explore_item_rsvps`) but the explore list doesn't show friend attendance counts.
- **Action**: Join `explore_item_rsvps` with `friendships` in explore query. Show badge "2 friends going" on list items.
- **Files**: `app/(tabs)/explore.tsx`, `src/lib/exploreQuery.ts` (or separate hook)
- **Scope**: 2-3 files

### 10. Add image URLs to explore_items
- **Problem**: No images on explore items. Ticketmaster provides images but they're not extracted during normalization.
- **Action**: Add `image_url TEXT` column. Extract best image from Ticketmaster raw JSON in adapter. Show in explore list.
- **Files**: New migration, `_shared/source-adapters/ticketmaster.ts`, `app/(tabs)/explore.tsx`
- **Scope**: 3 files + 1 migration

---

## Tier 3: Strategic Investments

### 11. Build basic validation pipeline
- **Problem**: No data quality checks. Geocoding errors, stale events, impossible dates all served to users.
- **Action**: Create `validate-explore-items` Edge Function that runs daily:
  - Check `starts_at` is in future (for events)
  - Check lat/lng is within expected region (e.g., within 100mi of Potsdam)
  - Check title is not empty/generic
  - Set `confidence_score` based on checks passed
- **Files**: New Edge Function, new pg_cron job
- **Scope**: 1 Edge Function + 1 migration

### 12. Add cross-source deduplication
- **Problem**: If two sources list the same event (e.g., Ticketmaster + Eventbrite), two explore_items are created.
- **Action**: After normalization, check for existing items with similar title + date + location (fuzzy match). Merge by keeping highest-quality fields.
- **Files**: New function in `normalize-raw-events/index.ts` or separate dedup Edge Function
- **Scope**: 1-2 files, moderate complexity

### 13. Add enrichment for flourishing dimensions
- **Problem**: The spec's 5 flourishing dimensions (agency, growth, connection, meaning, engagement) are not scored.
- **Action**: Add `flourishing_scores JSONB` column. Extend enrichment prompt to score 0-10 on each dimension. Store in explore_items.
- **Files**: New migration, `_shared/enrichment-schema.ts`, `apply_enrichment()` update
- **Scope**: 3 files, re-enrichment run needed

### 14. Add weather-aware filtering
- **Problem**: Outdoor activities shown regardless of weather. "Outdoors" filter on a rainy day shows hiking trails.
- **Action**: Add `weather_sensitive BOOLEAN` to explore_items (enrichment-inferred). When weather is bad, de-prioritize weather-sensitive items or show disclaimer.
- **Files**: New migration, enrichment prompt update, query builder update, optional weather API integration
- **Scope**: 3-4 files + external API

### 15. Build monitoring dashboard
- **Problem**: No visibility into pipeline health. If Ticketmaster ingestion fails, no one knows.
- **Action**: Create admin page or use `get_ingestion_stats()` to build a simple status view. Track: items per source, enrichment queue depth, failed jobs, last fetch times.
- **Files**: New admin screen or external dashboard (Supabase Dashboard SQL editor works)
- **Scope**: 1-2 files or external tool

---

## Tier 4: Future Vision

### 16. Add local rec department scraper (HTML)
- **Problem**: Community events (parks & rec, library, university) are only in curated CSV.
- **Action**: Build HTML scraping adapter using Cheerio. Start with one source (e.g., Potsdam Recreation). Requires: new adapter type, Playwright or fetch + Cheerio, field extraction.
- **Scope**: New adapter + Edge Function, moderate complexity

### 17. Add email-based resolution outreach
- **Problem**: Missing data (hours, pricing, confirmation) is never resolved.
- **Action**: Build resolution queue table. Identify items with low confidence. Send templated emails via SendGrid to organizers. Parse responses.
- **Scope**: New tables, Edge Function, SendGrid integration - significant effort

### 18. Add basic trip planning / itinerary
- **Problem**: Users browse individual items but can't plan multi-activity experiences.
- **Action**: MVP: "Build a day" feature - select items, auto-sort by time/distance, generate shareable itinerary.
- **Scope**: New screen, new logic, moderate-to-high effort

### 19. Multi-region support
- **Problem**: Hardcoded to Potsdam, NY (44.6697, -74.9814). Ticketmaster uses these defaults.
- **Action**: Add region configuration. Allow users to set their region. Source configs reference region center/radius.
- **Scope**: Configuration + UI + query changes, moderate effort

### 20. Add user-submitted sources/activities
- **Problem**: Users can't contribute activities they know about.
- **Action**: Add "Suggest an activity" form. Creates explore_item with `source_type = 'user_submitted'`, low confidence. Queue for moderation.
- **Scope**: New screen + migration + moderation flow

---

## Recommended Next Wave

The 5 highest-ROI tasks to tackle next, in order:

1. **Fix migration numbering** (#1) - Prevents deployment issues
2. **Add stale/expired detection** (#2) - Prevents serving outdated events
3. **Add tag-based filtering** (#3) - Makes existing enrichment data (tags) actually useful in queries
4. **Add confidence scoring** (#6) - Foundation for the spec's core philosophy
5. **Add Eventbrite source** (#5) - Doubles event coverage with minimal effort (follows existing pattern)

After those 5, the next wave should focus on:
- Image URLs (#10) - visual impact in the UI
- Friends going badges (#9) - social proof drives engagement
- Basic validation (#11) - data quality matters as sources multiply
- Flourishing scores (#13) - differentiates Euda from generic event apps

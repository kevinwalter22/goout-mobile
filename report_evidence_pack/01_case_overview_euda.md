# Case Overview: Euda App

**Supports report sections: A (Innovation novelty), B (Value creation)**

---

## 1. Product Overview

**Euda** is a social event-discovery and real-world coordination app for iOS and Android. It helps users in their 18–30 demographic find events and activities nearby, see which friends are attending, capture shared experiences via dual-camera photo posts, and build and maintain a social graph of people they go out with.

The app's core value proposition is **frictionless real-world social coordination** — reducing the friction between "what is happening near me tonight?" and "who from my network is going?" into a single, feed-driven experience. Unlike purely content-discovery apps (Eventbrite, Luma), Euda's primary unit of value is the social layer: RSVPs are visible to friends, check-ins signal presence, and posts are temporally anchored to events.

**Target users:** Urban and campus-based young adults (18–30); initially targeting college campus communities and dense urban neighborhoods where social spontaneity is highest.

**Platforms:** iOS (primary), Android, with a web presence for email verification and deep link resolution (`links.euda.live`).

---

## 2. Feature Inventory

| Feature | Description | Primary Evidence |
|---------|-------------|-----------------|
| Explore feed | Scrollable feed of events + activities nearby, filterable by type/tags, sorted by a 9-signal recommender | `src/lib/scoring.ts`, `src/lib/exploreQuery.ts`, migrations 017–030 |
| 9-signal recommender | Scores each item on distance, time match, weather suitability, friends going, tag affinity, type affinity, context intent, quality score, community feedback | `src/lib/scoring.ts`, `src/config/recommenderConfig.ts`, migration 058 |
| Map view | Interactive map of nearby events and activities | `src/components/ExploreMapView.tsx` |
| Grouped explore feed | Items grouped by category (e.g., "Music Tonight," "Outdoor Activities") with carousels | `src/lib/groupingEngine.ts`, `src/config/groupTaxonomy.ts` |
| Dual-camera photo posts | BeReal-style simultaneous front+rear camera capture anchored to events | `app/post/camera.tsx`, migration 009, Phase 5 commit `1cf526c` |
| Event RSVP | Users signal intent to attend an explore item | migration 019, `src/hooks/useExploreItemRSVP.ts` |
| Check-in with geofencing | Users confirm presence at a venue; verified against GPS proximity | `src/utils/location.ts`, `app/event/[id].tsx` |
| Friends system | Bidirectional friend graph; friend requests, acceptance, blocking | migration 011, 013, `src/hooks/useFriendship.ts` |
| Friend-scoped feed | See which friends RSVPed or checked in to events | Phase 7 commit `e472aa7`, migration 060 |
| Reactions + comments | Emoji reactions and threaded comments on posts | migration 010, Phase 6 commit `fd9643e` |
| Data ingestion pipeline | Automated ingestion from Google Places, PredictHQ events, and web collectors; normalizes into unified `explore_items` schema | migrations 037, 087, 038–039; edge functions `ingest-google-places`, `ingest-predicthq`, `ingest-web-collector` |
| LLM enrichment | AI-generated descriptions, tag classification, operating hours parsing for ingested items | `supabase/functions/enrich-explore-item/index.ts`, migration 027, 085 |
| Push notifications | Event reminders and friend-request alerts via APNs/FCM | migration 084, `src/lib/notifications.ts`, edge function `send-notification` |
| Content moderation | LLM text moderation + image moderation for user-generated content | `src/lib/moderation/textModeration.ts`, `supabase/functions/moderate-image/index.ts`, migrations 078–082 |
| Admin dashboard | Moderation inbox, review queue, suppression tools, quality audit | `app/settings/admin-*.tsx` |
| Content reporting | Users report listings or posts; bridges to admin moderation inbox | migration 069, 107; `src/hooks/useContentReport.ts` |
| User blocking | Block prevents content visibility and interaction | migration 069, `src/hooks/useBlockUser.ts` |
| User-created events | Authenticated users can create and publish their own events | migration 056, `src/hooks/useCreateEvent.ts` |
| Contact sync | Phone contact matching via SHA-256 hashed numbers for friend discovery | migration 061, 072; `src/hooks/useContactSync.ts` |
| Analytics + security logging | Structured analytics events and security audit trail to DB | `src/lib/analyticsLogger.ts`, `src/lib/securityEvents.ts`, migrations 066, 076 |
| Rate limiting | DB-level rate limiter on all write RPCs | migration 073 |
| Feature flags | DB-controlled kill switches for every major feature | migration 067, `src/hooks/useFeatureFlags.ts` |
| Error boundary + crash reporting | Branded fallback UI + Sentry session replay | `app/_layout.tsx`, `src/lib/sentry.ts` |

---

## 3. What Would Have Required a Traditional Team

To build the same scope with a conventional software development team, the following roles would be required:

| Role | Responsibility | Coverage in Euda |
|------|---------------|-----------------|
| Mobile engineer (senior) | React Native UI, navigation, camera, maps, push notifications | 37 screens, `app/**/*.tsx` |
| Backend engineer (senior) | Supabase schema, 108 migrations, 20 edge functions, RPCs, RLS | `supabase/` |
| ML / data engineer | Recommender engine (9 signals), enrichment pipeline, quality scoring | `src/lib/scoring.ts`, `supabase/functions/enrich-*` |
| DevOps / platform engineer | CI/CD, EAS builds, Supabase deploy, secrets management | `.github/workflows/`, `eas.json` |
| Security reviewer | RLS audit, rate limiting, RPC ownership, secrets hygiene | migrations 070–076 |
| QA engineer | Test coverage, device testing, preflight scans | `preflight-tests/`, `security-tests/` |

**Estimated traditional delivery:**
- Team: 4–6 full-time engineers
- Timeline: 6–9 months to equivalent feature scope
- Cost (US market): $400K–$900K in loaded engineering salary

**Actual delivery with agentic coding:**
- Team: 1 founder
- Timeline: 38 calendar days
- Cost: ~1 founder's time + Claude API compute costs (estimated $200–800 in API usage)

**Compression ratio:** Approximately **15–30× in calendar time**; cost compression is even larger given no salary multiplier for agent-generated work.

---

## 4. Why Agentic Coding Matters Here

The Euda codebase is not a simple CRUD app. It requires simultaneous competency across:

- **Distributed systems**: 20 Deno-based edge functions with shared schemas, retry logic, and external API calls
- **Database engineering**: 108 PostgreSQL migrations, row-level security policies, materialized views, pg_cron, security-definer RPCs
- **Mobile engineering**: Expo/React Native with camera, location, haptics, push notifications, deep linking
- **ML/ranking**: A weighted scoring engine with 9 orthogonal signals, feature flags, and a materialized aggregation layer
- **Security**: Rate limiting, ownership assertions, storage bucket policies, secret management, audit trails

No single engineer possesses deep expertise in all five domains. A traditional team would require specialists. An agentic system that can switch context across all five domains — and maintain architectural consistency through memory files and conventions — compresses this to a single orchestration layer.

The clearest evidence: the Wave 2 recommender system (7 distinct data-pipeline features) was implemented in a single day (January 29, 2026), evidenced by 8 commits spanning `feat(W2-1)` through `feat(W2-7)` between 19:00 and 19:35 EST. This represents roughly 3–4 weeks of traditional sprint work completed in hours.

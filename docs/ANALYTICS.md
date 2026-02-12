# Analytics — Launch KPI Events

Minimal event tracking for Euda launch KPIs.

---

## Overview

| Storage | Events | Logger |
|---------|--------|--------|
| `analytics_events` table | App-level events (signup, explore open, contacts sync) | `src/lib/analyticsLogger.ts` |
| `user_item_events` table | Explore-item interactions (open, rsvp, post, share) | `src/lib/interactionLogger.ts` |

Both loggers are **fire-and-forget**: they never block UI and never throw.

---

## Event Definitions

### App-level events (`analytics_events`)

| Event Name | Fires When | Metadata | Source File |
|---|---|---|---|
| `signup_complete` | User finishes registration | — | `src/contexts/AuthContext.tsx` |
| `explore_open` | Explore tab mounts | — | `app/(tabs)/explore.tsx` |
| `post_started` | User taps Check In & passes location check | `{ itemKind }` | `app/event/[id].tsx` |
| `contacts_sync_started` | User taps "Find Friends" sync button | — | `app/settings/find-contacts.tsx` |
| `contacts_sync_completed` | Contact sync finishes (success or fail) | `{ matchCount }` | `app/settings/find-contacts.tsx` |

### Explore-item interactions (`user_item_events`)

These are logged by the existing `logInteraction()` and also update user affinity scores.

| Event Type | Maps to KPI | Fires When | Source File |
|---|---|---|---|
| `open_detail` | explore_item_open | User taps an explore card | `app/(tabs)/explore.tsx` |
| `rsvp` | rsvp | User toggles "I'm Going" | `src/hooks/useExploreItemRSVP.ts` |
| `check_in_post` | post_success | Post is saved to DB | `app/checkin/camera.tsx` |
| `share` | share_clicked | User shares an item (share sheet opened) | `app/event/[id].tsx` |

### Not yet implemented

| Event Name | When to add |
|---|---|
| `onboarding_complete` | When a distinct onboarding flow is added (currently signup = onboarding) |

---

## Schema

```sql
-- Migration: 066_add_analytics_events.sql
CREATE TABLE analytics_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name  text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**RLS**: Users can INSERT their own rows only. No SELECT for authenticated users — analytics data is read via service_role (dashboard queries).

---

## Querying (Dashboard)

Use a service-role client or Supabase SQL editor:

```sql
-- Signups per day
SELECT date_trunc('day', created_at) AS day, count(*)
FROM analytics_events
WHERE event_name = 'signup_complete'
GROUP BY 1 ORDER BY 1;

-- Funnel: explore_open → post_started → post_success
SELECT event_name, count(DISTINCT user_id)
FROM (
  SELECT user_id, 'explore_open' AS event_name FROM analytics_events WHERE event_name = 'explore_open'
  UNION ALL
  SELECT user_id, 'post_started' FROM analytics_events WHERE event_name = 'post_started'
  UNION ALL
  SELECT p_user_id, 'post_success' FROM user_item_events WHERE event_type = 'check_in_post'
) t
GROUP BY event_name;

-- Contact sync conversion
SELECT event_name, count(*)
FROM analytics_events
WHERE event_name IN ('contacts_sync_started', 'contacts_sync_completed')
GROUP BY event_name;
```

---

## Privacy

- **No PII** is stored in analytics events — only user IDs and event names.
- Contact sync logs `matchCount` (integer) — never phone numbers, hashes, or contact names.
- `metadata` fields contain only non-sensitive operational data (item kind, counts).

---

## Adding New Events

1. Add the event name to the `AnalyticsEventName` union type in `src/lib/analyticsLogger.ts`.
2. Call `logAnalyticsEvent(userId, "your_event")` at the appropriate location.
3. Update this document.

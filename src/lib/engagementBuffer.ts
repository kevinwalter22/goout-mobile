/**
 * engagementBuffer — in-memory event buffer + sampling + AsyncStorage
 * persistence + replay on launch.
 *
 * Public surface:
 *   - logEngagement(event)    fire-and-forget; buffers + samples
 *   - flushEngagement()       force a flush (used on app background)
 *   - replayPersistedEvents() replay any events left on disk from a prior
 *                              crash/force-quit (call once on app launch)
 *
 * Flush triggers:
 *   - 50 events buffered
 *   - 15 seconds since last flush
 *   - explicit flushEngagement() (e.g. app background)
 *
 * Sampling rules (impressions only; conversion + intermediate funnel events
 * are always logged):
 *   - 100% for first 10 sessions (cold start)
 *   - 100% if user previously engaged with this item (engaged-items set is
 *     populated in-process; lost on relaunch which is fine — cold-start
 *     coverage handles the same-day re-launch case)
 *   - 25% random sample otherwise
 *
 * Client-side dedup: same (explore_item_id, event_type='impression') within
 * 5 minutes is dropped. impression_extended is treated separately.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { getSessionCount } from "./sessionId";

const PERSIST_KEY = "@euda_engagement_buffer_v1";
const FLUSH_INTERVAL_MS = 15_000;
const FLUSH_SIZE = 50;
const HARD_CAP = 200;
const DEDUP_WINDOW_MS = 5 * 60 * 1000;
const COLD_START_SESSION_THRESHOLD = 10;
const IMPRESSION_SAMPLE_RATE = 0.25;

// Event types — must match the CHECK constraint on engagement_log.event_type.
export type EngagementEventType =
  | "impression"
  | "impression_extended"
  | "tap"
  | "save"
  | "unsave"
  | "rsvp"
  | "unrsvp"
  | "share"
  | "dismiss"
  | "scroll_past";
// "post_at_event" is reserved for the server-side trigger; clients never log it.

export interface EngagementEvent {
  user_id: string;
  explore_item_id: string | null;
  event_type: EngagementEventType;
  occurred_at: string; // ISO
  session_id: string;
  feed_context: string; // e.g. "explore_list", "explore_cards", "explore_map", "event_detail"
  rank_position?: number;
  duration_ms?: number;
  ranking_signals?: unknown;
  user_location?: { lat: number; lng: number } | null;
  social_context?: { friends_going_count?: number; friends_created?: boolean } | null;
  item_snapshot?: { title?: string; category?: string; town?: string; kind?: string };
}

// In-memory state
let buffer: EngagementEvent[] = [];
let engagedItemIds = new Set<string>(); // items the user has engaged with in this app instance
let lastImpressionAt = new Map<string, number>(); // key = `${item_id}|${event_type}` → unix ms
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEngagement();
  }, FLUSH_INTERVAL_MS);
}

async function shouldSampleImpression(event: EngagementEvent): Promise<boolean> {
  // Always 100% for non-impression events; never sample conversion intermediates
  if (event.event_type !== "impression" && event.event_type !== "impression_extended") {
    return true;
  }
  // 100% if previously engaged with this item this session
  if (event.explore_item_id && engagedItemIds.has(event.explore_item_id)) {
    return true;
  }
  // 100% for cold-start sessions
  const sessionCount = await getSessionCount();
  if (sessionCount <= COLD_START_SESSION_THRESHOLD) {
    return true;
  }
  // 25% random thereafter
  return Math.random() < IMPRESSION_SAMPLE_RATE;
}

function dedupKey(event: EngagementEvent): string | null {
  if (event.event_type !== "impression" && event.event_type !== "impression_extended") {
    return null;
  }
  if (!event.explore_item_id) return null;
  return `${event.explore_item_id}|${event.event_type}`;
}

/**
 * Buffer an event. Applies sampling + 5-min dedup. Fire-and-forget.
 */
export async function logEngagement(event: EngagementEvent): Promise<void> {
  // Dedup window
  const key = dedupKey(event);
  if (key) {
    const last = lastImpressionAt.get(key);
    const now = Date.now();
    if (last && now - last < DEDUP_WINDOW_MS) {
      return;
    }
    lastImpressionAt.set(key, now);
  }

  // Sampling
  if (!(await shouldSampleImpression(event))) {
    return;
  }

  // Track engagement for the engaged-items set (any non-impression action)
  if (
    event.explore_item_id &&
    event.event_type !== "impression" &&
    event.event_type !== "impression_extended" &&
    event.event_type !== "scroll_past"
  ) {
    engagedItemIds.add(event.explore_item_id);
  }

  buffer.push(event);

  if (buffer.length >= HARD_CAP) {
    // Drop oldest to avoid unbounded growth on a long offline session.
    buffer = buffer.slice(-HARD_CAP);
  }

  if (buffer.length >= FLUSH_SIZE) {
    void flushEngagement();
  } else {
    scheduleFlush();
  }
}

/**
 * Flush buffered events to the server. Called by size/time triggers or on
 * app background. Non-blocking; failures persist to AsyncStorage for replay.
 */
export async function flushEngagement(): Promise<void> {
  if (flushInFlight) return;
  if (buffer.length === 0) return;

  const batch = buffer.slice(0, FLUSH_SIZE);
  buffer = buffer.slice(batch.length);
  flushInFlight = true;

  try {
    const { error } = await supabase.functions.invoke("log-engagement", {
      body: { events: batch },
    });
    if (error) {
      // Persist for retry on next launch
      await persistFailedBatch(batch);
    }
  } catch {
    await persistFailedBatch(batch);
  } finally {
    flushInFlight = false;
    // If there's more queued, keep draining
    if (buffer.length >= FLUSH_SIZE) {
      void flushEngagement();
    } else if (buffer.length > 0) {
      scheduleFlush();
    }
  }
}

async function persistFailedBatch(batch: EngagementEvent[]): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(PERSIST_KEY);
    const prior: EngagementEvent[] = existing ? JSON.parse(existing) : [];
    // Cap the persisted queue at 500 to avoid unbounded growth across many
    // failed flushes — engagement signal is high-volume; old impressions
    // lose marginal value fast.
    const combined = [...prior, ...batch].slice(-500);
    await AsyncStorage.setItem(PERSIST_KEY, JSON.stringify(combined));
  } catch {
    // Out of options — drop. The in-memory buffer has already advanced.
  }
}

/**
 * Replay events that were persisted on a prior failed flush. Call once at
 * app launch (after user is authenticated).
 */
export async function replayPersistedEvents(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const events = JSON.parse(raw) as EngagementEvent[];
    if (!Array.isArray(events) || events.length === 0) {
      await AsyncStorage.removeItem(PERSIST_KEY);
      return;
    }
    // Drop events older than 24h — the server endpoint rejects them anyway.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const fresh = events.filter((e) => new Date(e.occurred_at).getTime() >= cutoff);
    if (fresh.length === 0) {
      await AsyncStorage.removeItem(PERSIST_KEY);
      return;
    }
    // Push back into the buffer and clear the persisted store. If the
    // flush fails again, it'll be re-persisted.
    buffer = [...fresh, ...buffer];
    await AsyncStorage.removeItem(PERSIST_KEY);
    void flushEngagement();
  } catch {
    // Non-fatal
  }
}

/** Test-only: reset in-process state. Does not touch AsyncStorage. */
export function _resetForTests(): void {
  buffer = [];
  engagedItemIds = new Set();
  lastImpressionAt = new Map();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

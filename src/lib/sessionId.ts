/**
 * Session id — a UUID minted on app launch (or on first call after a long
 * idle gap) and threaded through engagement_log so the funnel attribution
 * can group impressions/taps/saves/rsvps that came from the same browse.
 *
 * Lifecycle:
 *   - First call after launch: mint a fresh UUID, persist to AsyncStorage.
 *   - Subsequent calls: return the cached id.
 *   - App background → resume after >30 min idle: mint a new session.
 *
 * The 30-min idle threshold matches the common analytics convention; same
 * tab + 30 min later is a new browse. Engagement_log groups by session_id
 * for "did this session convert" analysis.
 *
 * Also tracks lifetime session count for the cold-start sampling rule
 * (100% impressions for the user's first 10 sessions, 25% thereafter).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

const STORAGE_KEY = "@euda_engagement_session";
const SESSION_COUNT_KEY = "@euda_engagement_session_count";
const IDLE_RESET_MS = 30 * 60 * 1000;

interface PersistedSession {
  id: string;
  lastTouchedAt: number;
}

let cached: PersistedSession | null = null;
let cachedCount: number | null = null;

async function loadFromStorage(): Promise<PersistedSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

async function persist(session: PersistedSession): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Non-fatal; in-memory state still works
  }
}

async function bumpSessionCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_COUNT_KEY);
    const current = raw ? parseInt(raw, 10) : 0;
    const next = current + 1;
    await AsyncStorage.setItem(SESSION_COUNT_KEY, String(next));
    cachedCount = next;
    return next;
  } catch {
    cachedCount = (cachedCount ?? 0) + 1;
    return cachedCount;
  }
}

/**
 * Return the current session_id. Lazy-mints on first call; resets if the
 * app has been idle for more than IDLE_RESET_MS since the last touch.
 */
export async function getSessionId(): Promise<string> {
  const now = Date.now();

  if (cached && now - cached.lastTouchedAt < IDLE_RESET_MS) {
    cached.lastTouchedAt = now;
    await persist(cached);
    return cached.id;
  }

  const persisted = await loadFromStorage();
  if (persisted && now - persisted.lastTouchedAt < IDLE_RESET_MS) {
    cached = { id: persisted.id, lastTouchedAt: now };
    await persist(cached);
    return cached.id;
  }

  // Mint a fresh session
  const id = Crypto.randomUUID();
  cached = { id, lastTouchedAt: now };
  await persist(cached);
  await bumpSessionCount();
  return id;
}

/**
 * Lifetime distinct sessions for this install. Used by the sampling rule
 * to give the first 10 sessions full impression coverage.
 */
export async function getSessionCount(): Promise<number> {
  if (cachedCount != null) return cachedCount;
  try {
    const raw = await AsyncStorage.getItem(SESSION_COUNT_KEY);
    cachedCount = raw ? parseInt(raw, 10) : 0;
    return cachedCount;
  } catch {
    return 0;
  }
}

/** Test-only: clear cached state (does not touch AsyncStorage). */
export function _resetCacheForTests(): void {
  cached = null;
  cachedCount = null;
}

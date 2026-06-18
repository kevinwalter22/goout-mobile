/**
 * useEngagementTracking — viewport visibility tracker for the explore feed.
 *
 * Wires into FlatList.onViewableItemsChanged and emits engagement_log events:
 *   - 500ms continuously visible            → "impression"
 *   - 3000ms continuously visible           → "impression_extended"
 *   - Item visible but never engaged at
 *     session close                          → "scroll_past" (caller invokes
 *                                              flushScrollPasts on unmount)
 *
 * The hook is "dumb" — it doesn't know about the items beyond their id +
 * rank position. The caller supplies a `resolveItem(id)` callback so the
 * hook can capture ranking_signals and item_snapshot at the moment of
 * impression (don't re-fetch later; the data drifts).
 *
 * Designed for FlatList's onViewableItemsChanged + a ViewabilityConfig with
 * itemVisiblePercentThreshold: 50 + minimumViewTime: 0. We do the dwell
 * timing ourselves so that we get both 500ms (impression) and 3000ms
 * (impression_extended) without two separate FlatList configs.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ViewToken } from "react-native";
import { logEngagement, type EngagementEvent } from "../lib/engagementBuffer";

const IMPRESSION_MS = 500;
const IMPRESSION_EXTENDED_MS = 3000;

interface VisibleEntry {
  itemId: string;
  rankPosition: number;
  visibleSince: number;
  impressionLogged: boolean;
  extendedLogged: boolean;
}

export interface ResolvedItemContext {
  ranking_signals?: unknown;
  social_context?: { friends_going_count?: number; friends_created?: boolean } | null;
  item_snapshot?: { title?: string; category?: string; town?: string; kind?: string };
}

interface Options {
  userId: string | undefined;
  sessionId: string | null;
  feedContext: string; // "explore_list", "explore_cards", etc.
  userLocation?: { lat: number; lng: number } | null;
  resolveItem: (itemId: string) => ResolvedItemContext | null;
}

export function useEngagementTracking(opts: Options) {
  const { userId, sessionId, feedContext, userLocation, resolveItem } = opts;
  const visibleRef = useRef<Map<string, VisibleEntry>>(new Map());
  const seenItemIdsRef = useRef<Set<string>>(new Set());
  const engagedItemIdsRef = useRef<Set<string>>(new Set());
  const dwellTimersRef = useRef<Map<string, ReturnType<typeof setInterval> | null>>(new Map());

  // Snapshot opts in a ref so the onViewableItemsChanged callback identity
  // stays stable (FlatList complains if the prop changes between renders).
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const emit = useCallback(
    (
      itemId: string,
      eventType: EngagementEvent["event_type"],
      rankPosition: number,
      durationMs?: number,
    ) => {
      const cur = optsRef.current;
      if (!cur.userId || !cur.sessionId) return;
      const ctx = cur.resolveItem(itemId);
      void logEngagement({
        user_id: cur.userId,
        explore_item_id: itemId,
        event_type: eventType,
        occurred_at: new Date().toISOString(),
        session_id: cur.sessionId,
        feed_context: cur.feedContext,
        rank_position: rankPosition,
        duration_ms: durationMs,
        ranking_signals: ctx?.ranking_signals,
        user_location: cur.userLocation ?? null,
        social_context: ctx?.social_context ?? null,
        item_snapshot: ctx?.item_snapshot,
      });
    },
    [],
  );

  const checkDwell = useCallback(() => {
    const now = Date.now();
    visibleRef.current.forEach((entry, itemId) => {
      const elapsed = now - entry.visibleSince;
      if (!entry.impressionLogged && elapsed >= IMPRESSION_MS) {
        entry.impressionLogged = true;
        emit(itemId, "impression", entry.rankPosition, IMPRESSION_MS);
        seenItemIdsRef.current.add(itemId);
      }
      if (!entry.extendedLogged && elapsed >= IMPRESSION_EXTENDED_MS) {
        entry.extendedLogged = true;
        emit(itemId, "impression_extended", entry.rankPosition, IMPRESSION_EXTENDED_MS);
      }
    });
  }, [emit]);

  // Single shared poll for dwell checking. Avoid one interval per item.
  useEffect(() => {
    const interval = setInterval(checkDwell, 250);
    return () => clearInterval(interval);
  }, [checkDwell]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const now = Date.now();
      const stillVisible = new Set<string>();

      for (const v of viewableItems) {
        // Skip non-item rows (group headers, overflow headers, etc.).
        // The caller's keyExtractor should produce stable item ids; if a
        // viewable token's key doesn't look like an item id, ignore.
        const item: any = v.item;
        const itemId: string | undefined =
          item?.id ?? item?.item?.id; // ScoredItem vs nested wrappers
        if (!itemId || typeof itemId !== "string") continue;

        stillVisible.add(itemId);
        const existing = visibleRef.current.get(itemId);
        if (!existing) {
          visibleRef.current.set(itemId, {
            itemId,
            rankPosition: v.index ?? -1,
            visibleSince: now,
            impressionLogged: false,
            extendedLogged: false,
          });
        }
      }

      // Drop entries no longer visible — but if they were never logged as
      // an impression (i.e. visible <500ms), don't log anything.
      visibleRef.current.forEach((_, itemId) => {
        if (!stillVisible.has(itemId)) {
          visibleRef.current.delete(itemId);
        }
      });
    },
    [],
  );

  // Static viewabilityConfig identity (FlatList re-instantiates the
  // observer if this prop changes between renders).
  const viewabilityConfig = useMemo(
    () => ({
      itemVisiblePercentThreshold: 50,
      minimumViewTime: 0, // we time it ourselves
      waitForInteraction: false,
    }),
    [],
  );

  /**
   * Mark an item as "user took an action" (tap, save, rsvp). Items in this
   * set are excluded from the scroll_past emission at session close.
   */
  const markEngaged = useCallback((itemId: string) => {
    engagedItemIdsRef.current.add(itemId);
  }, []);

  /**
   * Emit a scroll_past event for every item that was impression-logged but
   * never engaged with. Call from a useEffect cleanup or when the user
   * navigates away from the feed.
   */
  const flushScrollPasts = useCallback(() => {
    const cur = optsRef.current;
    const userId = cur.userId;
    const sessionId = cur.sessionId;
    if (!userId || !sessionId) return;
    seenItemIdsRef.current.forEach((itemId) => {
      if (engagedItemIdsRef.current.has(itemId)) return;
      const ctx = cur.resolveItem(itemId);
      void logEngagement({
        user_id: userId,
        explore_item_id: itemId,
        event_type: "scroll_past",
        occurred_at: new Date().toISOString(),
        session_id: sessionId,
        feed_context: cur.feedContext,
        ranking_signals: ctx?.ranking_signals,
        user_location: cur.userLocation ?? null,
        social_context: ctx?.social_context ?? null,
        item_snapshot: ctx?.item_snapshot,
      });
    });
    seenItemIdsRef.current = new Set();
    engagedItemIdsRef.current = new Set();
  }, []);

  return {
    onViewableItemsChanged,
    viewabilityConfig,
    markEngaged,
    flushScrollPasts,
  };
}

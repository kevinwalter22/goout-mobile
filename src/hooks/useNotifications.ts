import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  target_route: string | null;
  reference_id: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
  actor_avatar_url?: string | null;
};

/**
 * The in-app notification CENTER (mig 191). Reads the user's own notification rows (RLS-scoped),
 * hydrates actor avatars, and exposes read-state management via the mark_notifications_read RPC.
 */
export function useNotifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    const { data, error } = await (supabase as any)
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      setLoading(false);
      return;
    }
    const rows = (data || []) as NotificationRow[];

    // Hydrate actor avatars in one batch.
    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[])];
    let avatarById = new Map<string, string | null>();
    if (actorIds.length > 0) {
      const { data: profs } = await supabase
        .from("public_profiles")
        .select("id, avatar_url")
        .in("id", actorIds);
      avatarById = new Map((profs || []).map((p: any) => [p.id, p.avatar_url]));
    }
    setItems(rows.map((r) => ({ ...r, actor_avatar_url: r.actor_id ? avatarById.get(r.actor_id) ?? null : null })));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const unreadCount = items.filter((i) => !i.read_at).length;

  const markRead = useCallback(async (ids: string[]) => {
    // Optimistic
    setItems((prev) => prev.map((i) => (ids.includes(i.id) && !i.read_at ? { ...i, read_at: new Date().toISOString() } : i)));
    await (supabase.rpc as any)("mark_notifications_read", { p_ids: ids });
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((i) => (i.read_at ? i : { ...i, read_at: new Date().toISOString() })));
    await (supabase.rpc as any)("mark_notifications_read", { p_ids: null });
  }, []);

  return { items, loading, unreadCount, refresh: load, markRead, markAllRead };
}

/**
 * Lightweight unread-count for the feed-header bell badge (avoids loading the full list).
 */
export function useUnreadNotificationCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0);
      return;
    }
    const { count: c } = await (supabase as any)
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    setCount(c || 0);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { count, refresh };
}
